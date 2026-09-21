import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { generateBookingReference } from '../src/modules/reservations/booking-reference';

// Exercises PATCH /api/v1/admin/reservations/:bookingReference/status over real
// HTTP against a real PostgreSQL database: the real app, the real session
// guard, the real transaction. Nothing is mocked.
//
// It keeps its own admin account, room type and rooms, separate from the read
// suite's, because every test here mutates a reservation and shared fixtures
// would make the two files depend on each other's order.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');
type PasswordModule = typeof import('../src/modules/admin-auth/admin-auth.password.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let hashPassword: PasswordModule['hashPassword'];

let server: Server;
let baseUrl: string;
let sessionCookie = '';

const runId = randomUUID().slice(0, 8);

const admin = {
  email: `itest-patch-${runId}@example.com`,
  displayName: `Status Admin ${runId}`,
  password: `fixture-password-${runId}`,
};

const fixture = {
  slug: `itest-patch-${runId}`,
  name: `Status HTTP Room ${runId}`,
  nightlyRate: '1234.50',
  totalAmount: '2469.00',
  roomNumbers: [`IT-PA-${runId}-1`, `IT-PA-${runId}-2`],
};

let roomTypeId: string;
let roomIds: string[] = [];

const DAY_MS = 86_400_000;
/** 2099-05-01, far beyond anything real and fixed so runs are identical. */
const STAY_BASE_UTC = Date.UTC(2099, 4, 1);
let stayOffset = 0;

const toCalendarDay = (instant: number) => new Date(instant).toISOString().slice(0, 10);

/** The next unused one-night stay, derived by real date arithmetic. */
function nextStay(): { checkIn: string; checkOut: string } {
  const checkIn = STAY_BASE_UTC + stayOffset * DAY_MS;
  stayOffset += 2;

  return { checkIn: toCalendarDay(checkIn), checkOut: toCalendarDay(checkIn + DAY_MS) };
}

type PatchResponse = {
  status: number;
  json: {
    data?: Record<string, any>;
    error?: { code: string; message: string };
  };
};

const NOT_AUTHENTICATED = { error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' } };
const INVALID_BOOKING_REFERENCE = {
  error: { code: 'INVALID_BOOKING_REFERENCE', message: 'Invalid booking reference' },
};
const INVALID_RESERVATION_STATUS = {
  error: { code: 'INVALID_RESERVATION_STATUS', message: 'Invalid reservation status' },
};
const INVALID_STATUS_TRANSITION = {
  error: { code: 'INVALID_STATUS_TRANSITION', message: 'Reservation status transition is not allowed' },
};
const RESERVATION_NOT_FOUND = { error: { code: 'RESERVATION_NOT_FOUND', message: 'Reservation not found' } };

/** Sends a body exactly as given, so malformed JSON reaches Express unchanged. */
async function patchRaw(
  reference: string,
  rawBody: string,
  headers: Record<string, string>,
): Promise<PatchResponse> {
  const response = await fetch(
    `${baseUrl}/api/v1/admin/reservations/${encodeURIComponent(reference)}/status`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: rawBody },
  );

  return { status: response.status, json: await response.json() };
}

// Three helpers rather than one with an optional cookie: an omitted argument is
// indistinguishable from an explicit `undefined`, so a default would silently
// turn "send no cookie" into "send the valid session".

/** Sends this suite's real signed-in session. */
const patchAsAdmin = (reference: string, body: unknown) =>
  patchRaw(reference, JSON.stringify(body), { Cookie: sessionCookie });
/** Sends exactly the given Cookie header, whatever it is. */
const patchWithCookie = (reference: string, body: unknown, cookie: string) =>
  patchRaw(reference, JSON.stringify(body), { Cookie: cookie });
/** Sends no Cookie header at all — the anonymous case. */
const patchWithoutCookie = (reference: string, body: unknown) =>
  patchRaw(reference, JSON.stringify(body), {});

async function insertReservation(status: 'pending' | 'confirmed' | 'cancelled', roomIndex = 0): Promise<string> {
  const bookingReference = generateBookingReference();
  const { checkIn, checkOut } = nextStay();

  await dbPool.query(
    `INSERT INTO reservations (
       booking_reference, room_type_id, room_id,
       guest_first_name, guest_last_name, guest_email, guest_phone, guest_country,
       adults, children, check_in, check_out,
       status, currency, nightly_rate_snapshot, total_amount, special_requests
     )
     VALUES ($1, $2, $3, 'Amelia', 'Hartwell', $4, '+201000000000', 'Egypt',
             2, 0, $5::date, $6::date, $7, 'EGP', $8, $9, 'Late arrival')`,
    [
      bookingReference,
      roomTypeId,
      roomIds[roomIndex],
      `guest-${runId}@example.com`,
      checkIn,
      checkOut,
      status,
      fixture.nightlyRate,
      fixture.totalAmount,
    ],
  );

  return bookingReference;
}

async function readStoredStatus(bookingReference: string): Promise<{ status: string; updated_at: Date }> {
  const { rows } = await dbPool.query<{ status: string; updated_at: Date }>(
    'SELECT status, updated_at FROM reservations WHERE booking_reference = $1',
    [bookingReference],
  );

  const row = rows[0];
  assert.ok(row, `fixture reservation ${bookingReference} is missing`);

  return row;
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  ({ hashPassword } = await import('../src/modules/admin-auth/admin-auth.password.js'));

  const { createApp } = await import('../src/app.js');
  const app = createApp();

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await dbPool.query(
    `INSERT INTO admin_users (email, display_name, password_hash, is_active)
     VALUES ($1, $2, $3, true)`,
    [admin.email, admin.displayName, await hashPassword(admin.password)],
  );

  const { rows: roomTypeRows } = await dbPool.query<{ id: string }>(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, 2, $3, true, 0)
     RETURNING id`,
    [fixture.slug, fixture.name, fixture.nightlyRate],
  );

  const createdRoomType = roomTypeRows[0];
  assert.ok(createdRoomType, 'failed to create the fixture room type');
  roomTypeId = createdRoomType.id;

  const { rows: roomRows } = await dbPool.query<{ id: string }>(
    `INSERT INTO rooms (room_type_id, room_number, is_active)
     VALUES ($1, $2, true), ($1, $3, true)
     RETURNING id`,
    [roomTypeId, ...fixture.roomNumbers],
  );

  roomIds = roomRows.map((row) => row.id);
  assert.equal(roomIds.length, 2, 'expected exactly two fixture rooms');

  // The cookie under test comes from a real login, not a hand-made row.
  const loginResponse = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: admin.password }),
  });

  assert.equal(loginResponse.status, 200, 'fixture login failed');
  const setCookie = loginResponse.headers.getSetCookie().find((value) => value.startsWith('tph_admin_session='));
  assert.ok(setCookie, 'fixture login returned no session cookie');
  // Only the name=value pair is kept, and the token itself is never logged.
  sessionCookie = setCookie.split(';')[0]!;
});

after(async () => {
  try {
    await dbPool.query('DELETE FROM reservations WHERE room_type_id = $1', [roomTypeId]);
    await dbPool.query('DELETE FROM rooms WHERE room_type_id = $1', [roomTypeId]);
    await dbPool.query('DELETE FROM room_types WHERE id = $1', [roomTypeId]);
    await dbPool.query(
      `DELETE FROM admin_sessions
        WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = $1)`,
      [admin.email],
    );
    await dbPool.query('DELETE FROM admin_users WHERE email = $1', [admin.email]);

    const { rows } = await dbPool.query<{ reservations: number; rooms: number; admins: number }>(
      `SELECT (SELECT COUNT(*) FROM reservations WHERE room_type_id = $1)::int AS reservations,
              (SELECT COUNT(*) FROM rooms WHERE room_type_id = $1)::int AS rooms,
              (SELECT COUNT(*) FROM admin_users WHERE email = $2)::int AS admins`,
      [roomTypeId, admin.email],
    );

    assert.deepEqual(rows[0], { reservations: 0, rooms: 0, admins: 0 }, 'fixtures were not fully removed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDatabasePool();
  }
});

describe('PATCH /api/v1/admin/reservations/:bookingReference/status', () => {
  describe('authentication', () => {
    it('refuses a request with no session cookie', async () => {
      const reference = await insertReservation('pending');

      const response = await patchWithoutCookie(reference, { status: 'confirmed' });

      assert.equal(response.status, 401);
      assert.deepEqual(response.json, NOT_AUTHENTICATED);
      assert.equal((await readStoredStatus(reference)).status, 'pending', 'nothing may have changed');
    });

    it('refuses an unrelated or malformed cookie identically', async () => {
      const reference = await insertReservation('pending');

      for (const cookie of ['theme=dark', 'tph_admin_session=', 'tph_admin_session=not-a-token']) {
        const response = await patchWithCookie(reference, { status: 'confirmed' }, cookie);

        assert.equal(response.status, 401, `expected 401 for ${cookie.split('=')[0]}`);
        assert.deepEqual(response.json, NOT_AUTHENTICATED);
      }

      assert.equal((await readStoredStatus(reference)).status, 'pending');
    });

    it('decides authentication before anything else about the request', async () => {
      // A malformed reference, an unknown reservation, an invalid body and a
      // forbidden transition must all look the same to an anonymous caller.
      const cancelled = await insertReservation('cancelled');

      const cases = [
        await patchWithoutCookie('not-a-reference', { status: 'confirmed' }),
        await patchWithoutCookie(generateBookingReference(), { status: 'confirmed' }),
        await patchWithoutCookie(cancelled, { status: 'pending' }),
        await patchWithoutCookie(cancelled, { status: 'confirmed' }),
      ];

      for (const response of cases) {
        assert.equal(response.status, 401);
        assert.deepEqual(response.json, NOT_AUTHENTICATED);
      }
    });

    it('refuses a revoked session', async () => {
      const reference = await insertReservation('pending');
      const throwaway = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: admin.email, password: admin.password }),
      });
      const cookie = throwaway.headers
        .getSetCookie()
        .find((value) => value.startsWith('tph_admin_session='))!
        .split(';')[0]!;

      await fetch(`${baseUrl}/api/v1/admin/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });

      const response = await patchWithCookie(reference, { status: 'confirmed' }, cookie);

      assert.equal(response.status, 401);
      assert.deepEqual(response.json, NOT_AUTHENTICATED);
      assert.equal((await readStoredStatus(reference)).status, 'pending');
    });
  });

  describe('rejects a malformed booking reference', () => {
    const malformed = [
      'not-a-reference',
      'tph-a2b3c4d5e6f7',
      'ABC-A2B3C4D5E6F7',
      'TPH-A2B3C4D5E6F',
      'TPH-A2B3C4D5E6F0',
      ' TPH-A2B3C4D5E6F7',
    ];

    for (const reference of malformed) {
      it(`with 400 for ${JSON.stringify(reference)}`, async () => {
        const response = await patchAsAdmin(reference, { status: 'confirmed' });

        assert.equal(response.status, 400);
        assert.deepEqual(response.json, INVALID_BOOKING_REFERENCE);
      });
    }

    it('without reflecting the rejected reference', async () => {
      const response = await patchAsAdmin('TPH-a2b3c4d5e6f7', { status: 'confirmed' });

      assert.ok(!JSON.stringify(response.json).includes('a2b3c4d5'), 'the input must not be reflected');
    });

    it('before looking at the body, when both are malformed', async () => {
      // A fixed order means one deterministic answer rather than whichever
      // check happened to run first.
      const response = await patchAsAdmin('not-a-reference', { status: 'pending' });

      assert.deepEqual(response.json, INVALID_BOOKING_REFERENCE);
    });
  });

  // Two layers refuse a bad body, and which one answers depends on whether the
  // JSON parser accepts the value at all.
  //
  // `express.json()` runs app-wide before routing in strict mode, so a
  // top-level JSON primitive — a bare string, a number, `null` — never reaches
  // a route and comes back as the global INVALID_JSON. Objects and arrays do
  // parse, so they reach this endpoint's own validator and come back as
  // INVALID_RESERVATION_STATUS.
  //
  // The validator refuses primitives too; that is proven directly in
  // admin-reservations.status.test.ts, where it is called without a parser in
  // front of it. Over HTTP it simply never gets the chance.
  describe('rejects an invalid body at the route', () => {
    const invalid: [string, unknown][] = [
      ['pending', { status: 'pending' }],
      ['a missing status', {}],
      ['the wrong key', { state: 'confirmed' }],
      ['a null status', { status: null }],
      ['a numeric status', { status: 1 }],
      ['a boolean status', { status: true }],
      ['an array status', { status: ['confirmed'] }],
      // An array is valid top-level JSON, so this one does reach the validator.
      ['an array body', ['confirmed']],
      ['uppercase', { status: 'CONFIRMED' }],
      ['mixed case', { status: 'Cancelled' }],
      ['leading whitespace', { status: ' confirmed' }],
      ['trailing whitespace', { status: 'cancelled ' }],
      ['an unknown status', { status: 'declined' }],
      ['an American spelling', { status: 'canceled' }],
    ];

    for (const [label, body] of invalid) {
      it(`with 400 for ${label}`, async () => {
        const reference = await insertReservation('pending');

        const response = await patchAsAdmin(reference, body);

        assert.equal(response.status, 400, `expected 400 for ${label}`);
        assert.deepEqual(response.json, INVALID_RESERVATION_STATUS);
        assert.equal((await readStoredStatus(reference)).status, 'pending', 'nothing may have changed');
      });
    }

  });

  describe('rejects an unparseable body at the JSON parser', () => {
    const INVALID_JSON = { error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' } };

    it('with the existing global contract for truncated JSON', async () => {
      const reference = await insertReservation('pending');

      const response = await patchRaw(reference, '{"status":', { Cookie: sessionCookie });

      assert.equal(response.status, 400);
      assert.deepEqual(response.json, INVALID_JSON);
      assert.equal((await readStoredStatus(reference)).status, 'pending');
    });

    // Strict-mode express.json() accepts only an object or an array at the top
    // level, so these are refused before routing — the endpoint's validator is
    // never reached, and the answer is the parser's, not this route's.
    const primitives: [string, string][] = [
      ['a bare JSON string', '"confirmed"'],
      ['a JSON null', 'null'],
      ['a JSON number', '42'],
      ['a JSON boolean', 'true'],
    ];

    for (const [label, rawBody] of primitives) {
      it(`with the same contract for ${label}`, async () => {
        const reference = await insertReservation('pending');

        const response = await patchRaw(reference, rawBody, { Cookie: sessionCookie });

        assert.equal(response.status, 400, `expected 400 for ${label}`);
        assert.deepEqual(response.json, INVALID_JSON);
        assert.equal((await readStoredStatus(reference)).status, 'pending', 'nothing may have changed');
      });
    }
  });

  describe('reports an unknown reservation', () => {
    it('with 404 for a canonical reference nobody booked', async () => {
      const response = await patchAsAdmin(generateBookingReference(), { status: 'confirmed' });

      assert.equal(response.status, 404);
      assert.deepEqual(response.json, RESERVATION_NOT_FOUND);
    });

    it('keeping 404, 400 and 409 apart', async () => {
      const cancelled = await insertReservation('cancelled');

      const unknown = await patchAsAdmin(generateBookingReference(), { status: 'confirmed' });
      const malformed = await patchAsAdmin('tph-a2b3c4d5e6f7', { status: 'confirmed' });
      const forbidden = await patchAsAdmin(cancelled, { status: 'confirmed' });

      assert.equal(unknown.status, 404);
      assert.equal(malformed.status, 400);
      assert.equal(forbidden.status, 409);
    });
  });

  describe('applies a permitted transition', () => {
    const permitted: ['pending' | 'confirmed', 'confirmed' | 'cancelled'][] = [
      ['pending', 'confirmed'],
      ['pending', 'cancelled'],
      ['confirmed', 'cancelled'],
    ];

    for (const [from, to] of permitted) {
      it(`${from} -> ${to} returns 200 and persists`, async () => {
        const reference = await insertReservation(from);

        const response = await patchAsAdmin(reference, { status: to });

        assert.equal(response.status, 200);
        assert.equal(response.json.data!.status, to);
        assert.equal((await readStoredStatus(reference)).status, to, 'the change must be committed');
      });
    }

    it('returns exactly the three contract fields, wrapped once in data', async () => {
      const reference = await insertReservation('pending');

      const response = await patchAsAdmin(reference, { status: 'confirmed' });
      const data = response.json.data!;

      assert.deepEqual(Object.keys(response.json), ['data']);
      assert.deepEqual(Object.keys(data).sort(), ['bookingReference', 'status', 'updatedAt']);
      assert.equal(data.bookingReference, reference);
      assert.equal(data.status, 'confirmed');
      assert.match(data.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('carrying no internal, detail-only or previous-state field', async () => {
      const reference = await insertReservation('pending');

      const data = (await patchAsAdmin(reference, { status: 'cancelled' })).json.data!;

      for (const field of [
        'id',
        'roomId',
        'roomTypeId',
        'room',
        'roomNumber',
        'guest',
        'guestEmail',
        'pricing',
        'totalAmount',
        'previousStatus',
        'createdAt',
        'stay',
      ]) {
        assert.ok(!(field in data), `${field} must not appear in the response`);
      }
    });

    it('is visible immediately through the detail endpoint', async () => {
      const reference = await insertReservation('pending');

      await patchAsAdmin(reference, { status: 'confirmed' });

      const detail = await fetch(`${baseUrl}/api/v1/admin/reservations/${reference}`, {
        headers: { Cookie: sessionCookie },
      });
      const body = (await detail.json()) as { data: { status: string } };

      assert.equal(detail.status, 200);
      assert.equal(body.data.status, 'confirmed');
    });
  });

  describe('refuses a forbidden transition', () => {
    const forbidden: ['confirmed' | 'cancelled', 'confirmed' | 'cancelled'][] = [
      ['confirmed', 'confirmed'],
      ['cancelled', 'cancelled'],
      ['cancelled', 'confirmed'],
    ];

    for (const [from, to] of forbidden) {
      it(`${from} -> ${to} returns 409 and changes nothing`, async () => {
        const reference = await insertReservation(from);
        const before = await readStoredStatus(reference);

        const response = await patchAsAdmin(reference, { status: to });

        assert.equal(response.status, 409);
        assert.deepEqual(response.json, INVALID_STATUS_TRANSITION);

        const after = await readStoredStatus(reference);
        assert.equal(after.status, from, 'the status must not change');
        assert.equal(
          after.updated_at.getTime(),
          before.updated_at.getTime(),
          'a refused transition must not touch updated_at',
        );
      });
    }

    it('says nothing about the reservation or the statuses involved', async () => {
      const reference = await insertReservation('cancelled');

      const response = await patchAsAdmin(reference, { status: 'confirmed' });
      const body = JSON.stringify(response.json);

      for (const leak of [reference, 'cancelled', 'confirmed', 'TPH-']) {
        assert.ok(!body.includes(leak), `the 409 body must not mention ${leak}`);
      }
    });
  });

  // The repository-level concurrency matrix is proven in
  // admin-reservations.status.integration.test.ts. This is the one HTTP-level
  // check that the guarantee survives the route.
  it('lets exactly one of two simultaneous confirms win over HTTP', async () => {
    const reference = await insertReservation('pending');

    const [first, second] = await Promise.all([
      patchAsAdmin(reference, { status: 'confirmed' }),
      patchAsAdmin(reference, { status: 'confirmed' }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409], 'one request must win and the other must conflict');
    assert.equal((await readStoredStatus(reference)).status, 'confirmed');
  });

  it('leaves the read endpoints and auth untouched', async () => {
    const list = await fetch(`${baseUrl}/api/v1/admin/reservations?limit=1`, {
      headers: { Cookie: sessionCookie },
    });
    const session = await fetch(`${baseUrl}/api/v1/admin/auth/session`, {
      headers: { Cookie: sessionCookie },
    });

    assert.equal(list.status, 200);
    assert.equal(session.status, 200);
  });
});
