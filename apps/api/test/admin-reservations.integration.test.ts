import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { insertedId, toNumbers } from './support/core-sql';
// Safe to import statically: the booking-reference module reaches nothing but
// node:crypto, unlike the src modules below that require DATABASE_URL on load.
import { generateBookingReference } from '../src/modules/reservations/booking-reference';

// Exercises GET /api/v1/admin/reservations over real HTTP against a real
// MySQL database: the real app, the real session guard, the real
// repository SQL and its room_types join. Nothing is mocked.
//
// It creates its own admin account, room type, rooms and reservations with
// identifiers unique to this run, and removes exactly those afterwards. No
// other data is read for assertions or deleted.
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
  email: `itest-adminres-${runId}@example.com`,
  displayName: `Reservations Admin ${runId}`,
  password: `fixture-password-${runId}`,
};

const fixture = {
  slug: `itest-adminres-${runId}`,
  name: `Admin Reservations Room ${runId}`,
  capacity: 2,
  nightlyRate: '1234.50',
  totalAmount: '2469.00',
  guestFirstName: 'Amelia',
  guestLastName: 'Hartwell',
  guestEmail: `guest-${runId}@example.com`,
  guestPhone: '+201000000000',
  guestCountry: 'Egypt',
  roomNumbers: [`IT-AR-${runId}-1`, `IT-AR-${runId}-2`, `IT-AR-${runId}-3`],
};

type AdminReservationRow = {
  bookingReference: string;
  guestName: string;
  guestEmail: string;
  roomType: { slug: string; name: string };
  checkIn: string;
  checkOut: string;
  status: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
};

type ListResponse = {
  status: number;
  json: {
    data?: { reservations: AdminReservationRow[]; pagination: { limit: number; offset: number; total: number } };
    error?: { code: string; message: string };
  };
};

let roomTypeId: string;
let roomIds: string[] = [];

/**
 * Fixture reservations are stamped far in the future on purpose.
 *
 * The endpoint lists every reservation, so a shared database may hold rows this
 * suite did not create. Dating these beyond anything real keeps them at the top
 * of `created_at DESC` deterministically, without deleting or depending on
 * anyone else's data. Two of them share a created_at so the `id DESC`
 * tie-breaker is genuinely exercised.
 */
const created = {
  oldest: '2099-01-01T09:00:00Z',
  middle: '2099-01-02T09:00:00Z',
  tied: '2099-01-03T09:00:00Z',
};

type Fixture = { bookingReference: string; id: string };

async function insertReservation(input: {
  roomIndex: number;
  checkIn: string;
  checkOut: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: string;
  specialRequests?: string | null;
}): Promise<Fixture> {
  // Real references, from the same generator production uses: the detail
  // endpoint only accepts the canonical format, and a fixture that could not
  // exist in production would prove nothing about looking one up.
  const bookingReference = generateBookingReference();

  const inserted = await dbPool.query(
    `INSERT INTO reservations (
       booking_reference, room_type_id, room_id,
       guest_first_name, guest_last_name, guest_email, guest_phone, guest_country,
       adults, children, check_in, check_out,
       status, currency, nightly_rate_snapshot, total_amount, special_requests, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $13, $14,
             2, 0, $7, $8, $9, 'EGP', $10, $11, $15, $12)`,
    [
      bookingReference,
      roomTypeId,
      roomIds[input.roomIndex],
      fixture.guestFirstName,
      fixture.guestLastName,
      fixture.guestEmail,
      input.checkIn,
      input.checkOut,
      input.status,
      fixture.nightlyRate,
      fixture.totalAmount,
      new Date(input.createdAt),
      fixture.guestPhone,
      fixture.guestCountry,
      input.specialRequests === undefined ? 'Late arrival' : input.specialRequests,
    ],
  );

  return { bookingReference, id: insertedId(inserted) };
}

async function requestReservations(query: string, headers: Record<string, string>): Promise<ListResponse> {
  const response = await fetch(`${baseUrl}/api/v1/admin/reservations${query}`, { headers });

  return { status: response.status, json: await response.json() };
}

// Three separate helpers rather than one with an optional cookie. An omitted
// argument is indistinguishable from an explicit `undefined` in JavaScript, so
// a defaulted cookie parameter would silently turn "send no cookie" into "send
// the valid session" — the caller's intent has to be in the name.

/** Sends this suite's real signed-in session. */
async function listReservationsAsAdmin(query = ''): Promise<ListResponse> {
  return requestReservations(query, { Cookie: sessionCookie });
}

/** Sends exactly the given Cookie header, whatever it is. */
async function listReservationsWithCookie(cookie: string, query = ''): Promise<ListResponse> {
  return requestReservations(query, { Cookie: cookie });
}

/** Sends no Cookie header at all — the anonymous case. */
async function listReservationsWithoutCookie(query = ''): Promise<ListResponse> {
  return requestReservations(query, {});
}

/** The rows this suite created, in the order the endpoint returned them. */
function ownRows(rows: AdminReservationRow[]): string[] {
  const own = new Set(Object.values(reservations).map((entry) => entry.bookingReference));

  return rows.map((row) => row.bookingReference).filter((reference) => own.has(reference));
}

function requireData(response: ListResponse) {
  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(response.json)}`);
  assert.ok(response.json.data, 'expected a data envelope');

  return response.json.data;
}

const reservations: Record<'pending' | 'confirmed' | 'cancelled' | 'tiebreak', Fixture> = {
  pending: { bookingReference: '', id: '' },
  confirmed: { bookingReference: '', id: '' },
  cancelled: { bookingReference: '', id: '' },
  tiebreak: { bookingReference: '', id: '' },
};

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

  const createdRoomType = await dbPool.query(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, $3, $4, true, 0)`,
    [fixture.slug, fixture.name, fixture.capacity, fixture.nightlyRate],
  );

  roomTypeId = insertedId(createdRoomType);

  await dbPool.query(
    `INSERT INTO rooms (room_type_id, room_number, is_active)
     VALUES ($1, $2, true), ($1, $3, true), ($1, $4, true)`,
    [roomTypeId, ...fixture.roomNumbers],
  );

  const { rows: roomRows } = await dbPool.query<{ id: string }>(
    'SELECT id FROM rooms WHERE room_type_id = $1 ORDER BY id',
    [roomTypeId],
  );

  roomIds = roomRows.map((row) => row.id);
  assert.equal(roomIds.length, 3, 'expected exactly three fixture rooms');

  // Distinct rooms and dates: pending and confirmed stays consume inventory, so
  // overlapping them on one room would hit the exclusion constraint.
  reservations.pending = await insertReservation({
    roomIndex: 0,
    checkIn: '2099-01-10',
    checkOut: '2099-01-12',
    status: 'pending',
    createdAt: created.oldest,
  });
  reservations.confirmed = await insertReservation({
    roomIndex: 1,
    checkIn: '2099-01-10',
    checkOut: '2099-01-12',
    status: 'confirmed',
    createdAt: created.middle,
  });
  // The one fixture with no special requests, so the detail contract's
  // `string | null` is exercised in both directions.
  reservations.cancelled = await insertReservation({
    roomIndex: 2,
    checkIn: '2099-01-10',
    checkOut: '2099-01-12',
    status: 'cancelled',
    createdAt: created.tied,
    specialRequests: null,
  });
  // Same created_at as `cancelled`, inserted after it, so a correct ORDER BY
  // must put this one first on the id tie-break alone.
  reservations.tiebreak = await insertReservation({
    roomIndex: 0,
    checkIn: '2099-02-10',
    checkOut: '2099-02-12',
    status: 'pending',
    createdAt: created.tied,
  });

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
    // FK-safe order, scoped to this run's fixtures only.
    await dbPool.query('DELETE FROM reservations WHERE room_type_id = $1', [roomTypeId]);
    await dbPool.query('DELETE FROM rooms WHERE room_type_id = $1', [roomTypeId]);
    await dbPool.query('DELETE FROM room_types WHERE id = $1', [roomTypeId]);
    await dbPool.query(
      `DELETE FROM admin_sessions
        WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = $1)`,
      [admin.email],
    );
    await dbPool.query('DELETE FROM admin_users WHERE email = $1', [admin.email]);

    const { rows } = await dbPool.query<{
      reservations: number;
      rooms: number;
      room_types: number;
      admins: number;
    }>(
      `SELECT (SELECT COUNT(*) FROM reservations WHERE room_type_id = $1) AS reservations,
              (SELECT COUNT(*) FROM rooms WHERE room_type_id = $1) AS rooms,
              (SELECT COUNT(*) FROM room_types WHERE id = $1) AS room_types,
              (SELECT COUNT(*) FROM admin_users WHERE email = $2) AS admins`,
      [roomTypeId, admin.email],
    );

    assert.deepEqual(
      rows[0] && toNumbers(rows[0]),
      { reservations: 0, rooms: 0, room_types: 0, admins: 0 },
      'fixtures were not fully removed',
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDatabasePool();
  }
});

describe('GET /api/v1/admin/reservations', () => {
  describe('authentication', () => {
    it('refuses a request with no session cookie', async () => {
      const response = await listReservationsWithoutCookie();

      assert.equal(response.status, 401);
      assert.deepEqual(response.json, {
        error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' },
      });
    });

    it('refuses an unrelated or malformed cookie identically', async () => {
      for (const cookie of ['theme=dark', 'tph_admin_session=', 'tph_admin_session=not-a-token']) {
        const response = await listReservationsWithCookie(cookie);

        assert.equal(response.status, 401, `expected 401 for ${cookie.split('=')[0]}`);
        assert.deepEqual(response.json, {
          error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' },
        });
      }
    });

    it('refuses a revoked session', async () => {
      const throwaway = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: admin.email, password: admin.password }),
      });
      const cookie = throwaway.headers
        .getSetCookie()
        .find((value) => value.startsWith('tph_admin_session='))!
        .split(';')[0]!;

      assert.equal(
        (await listReservationsWithCookie(cookie)).status,
        200,
        'the throwaway session should start valid',
      );

      await fetch(`${baseUrl}/api/v1/admin/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });

      const response = await listReservationsWithCookie(cookie);
      assert.equal(response.status, 401);
      assert.deepEqual(response.json, {
        error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' },
      });
    });
  });

  describe('pagination', () => {
    it('applies the default window to a bare request', async () => {
      const data = requireData(await listReservationsAsAdmin());

      assert.equal(data.pagination.limit, 25);
      assert.equal(data.pagination.offset, 0);
      assert.ok(data.reservations.length <= 25, 'a default page must not exceed the default limit');
      assert.ok(data.pagination.total >= 4, 'the total must include this run’s four fixtures');
    });

    it('honours a custom limit and offset', async () => {
      const first = requireData(await listReservationsAsAdmin('?limit=1&offset=0'));

      assert.deepEqual({ limit: first.pagination.limit, offset: first.pagination.offset }, { limit: 1, offset: 0 });
      assert.ok(first.reservations.length <= 1, 'limit=1 must return at most one row');

      const second = requireData(await listReservationsAsAdmin('?limit=1&offset=1'));

      assert.deepEqual({ limit: second.pagination.limit, offset: second.pagination.offset }, { limit: 1, offset: 1 });
      assert.notEqual(
        second.reservations[0]?.bookingReference,
        first.reservations[0]?.bookingReference,
        'the second page must not repeat the first row',
      );
    });

    it('accepts the boundary limits', async () => {
      assert.equal(requireData(await listReservationsAsAdmin('?limit=1')).pagination.limit, 1);
      assert.equal(requireData(await listReservationsAsAdmin('?limit=100')).pagination.limit, 100);
    });

    it('returns an empty page but the real total past the final row', async () => {
      const { pagination } = requireData(await listReservationsAsAdmin('?limit=1'));
      const beyond = requireData(await listReservationsAsAdmin(`?limit=25&offset=${pagination.total + 10}`));

      assert.deepEqual(beyond.reservations, [], 'an offset past the end must return no rows');
      // The point of counting separately: a windowed COUNT(*) OVER () would
      // have returned no row here, and with it no total at all.
      assert.equal(beyond.pagination.total, pagination.total);
      assert.ok(beyond.pagination.total >= 4);
    });

    it('reports the same total the database reports', async () => {
      const data = requireData(await listReservationsAsAdmin('?limit=1'));
      const { rows } = await dbPool.query<{ total: string }>('SELECT COUNT(*) AS total FROM reservations');

      assert.equal(String(data.pagination.total), rows[0]!.total);
    });
  });

  describe('rejects invalid pagination', () => {
    const invalid = ['?limit=0', '?limit=101', '?offset=-1', '?limit=2.5', '?limit=1&limit=2', '?limit=', '?offset=abc'];

    for (const query of invalid) {
      it(`with 400 INVALID_PAGINATION for ${query}`, async () => {
        const response = await listReservationsAsAdmin(query);

        assert.equal(response.status, 400);
        assert.deepEqual(response.json, {
          error: { code: 'INVALID_PAGINATION', message: 'Invalid pagination parameters' },
        });
      });
    }
  });

  describe('ordering', () => {
    it('returns newest first, breaking created_at ties by id descending', async () => {
      const data = requireData(await listReservationsAsAdmin('?limit=100'));
      const order = ownRows(data.reservations);

      assert.deepEqual(order, [
        // Same created_at as `cancelled`, but a higher id.
        reservations.tiebreak.bookingReference,
        reservations.cancelled.bookingReference,
        reservations.confirmed.bookingReference,
        reservations.pending.bookingReference,
      ]);

      assert.ok(
        BigInt(reservations.tiebreak.id) > BigInt(reservations.cancelled.id),
        'the tie-break fixture must have the higher id for this assertion to mean anything',
      );
    });

    it('keeps that order stable across pages', async () => {
      const whole = ownRows(requireData(await listReservationsAsAdmin('?limit=100')).reservations);
      const paged: string[] = [];

      for (let offset = 0; offset < 100; offset += 10) {
        paged.push(...ownRows(requireData(await listReservationsAsAdmin(`?limit=10&offset=${offset}`)).reservations));
      }

      assert.deepEqual(paged, whole, 'paging must neither repeat nor skip a reservation');
    });
  });

  describe('response shape', () => {
    async function findFixture(bookingReference: string): Promise<AdminReservationRow> {
      const data = requireData(await listReservationsAsAdmin('?limit=100'));
      const row = data.reservations.find((candidate) => candidate.bookingReference === bookingReference);

      assert.ok(row, `fixture ${bookingReference} missing from the list`);

      return row;
    }

    it('returns exactly the list contract and nothing else', async () => {
      const row = await findFixture(reservations.pending.bookingReference);

      assert.deepEqual(row, {
        bookingReference: reservations.pending.bookingReference,
        guestName: `${fixture.guestFirstName} ${fixture.guestLastName}`,
        guestEmail: fixture.guestEmail,
        roomType: { slug: fixture.slug, name: fixture.name },
        checkIn: '2099-01-10',
        checkOut: '2099-01-12',
        status: 'pending',
        totalAmount: fixture.totalAmount,
        currency: 'EGP',
        createdAt: new Date(created.oldest).toISOString(),
      });

      assert.deepEqual(Object.keys(row).sort(), [
        'bookingReference',
        'checkIn',
        'checkOut',
        'createdAt',
        'currency',
        'guestEmail',
        'guestName',
        'roomType',
        'status',
        'totalAmount',
      ]);
      assert.deepEqual(Object.keys(row.roomType).sort(), ['name', 'slug']);
    });

    it('omits every detail-only and internal field', async () => {
      const row = await findFixture(reservations.pending.bookingReference);
      const absent = [
        'id',
        'reservationId',
        'roomId',
        'roomNumber',
        'roomTypeId',
        'guestPhone',
        'guestCountry',
        'guestFirstName',
        'guestLastName',
        'specialRequests',
        'nightlyRate',
        'nightlyRateSnapshot',
        'adults',
        'children',
        'nights',
        'updatedAt',
      ];

      for (const field of absent) {
        assert.ok(!(field in row), `${field} must not appear in the list contract`);
      }

      // The fixture stores a special request and a phone number, so their
      // absence above is the query's doing, not empty data.
      const { rows } = await dbPool.query<{ special_requests: string | null }>(
        'SELECT special_requests FROM reservations WHERE booking_reference = $1',
        [reservations.pending.bookingReference],
      );
      assert.equal(rows[0]!.special_requests, 'Late arrival');
    });

    it('keeps money an exact decimal string, never a number', async () => {
      const row = await findFixture(reservations.pending.bookingReference);

      assert.equal(typeof row.totalAmount, 'string');
      assert.equal(row.totalAmount, '2469.00');
      assert.equal(row.currency, 'EGP');
    });

    it('returns stay dates as plain calendar days', async () => {
      const row = await findFixture(reservations.tiebreak.bookingReference);

      assert.match(row.checkIn, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(row.checkOut, /^\d{4}-\d{2}-\d{2}$/);
      // The exact stored days, unshifted by any timezone conversion.
      assert.equal(row.checkIn, '2099-02-10');
      assert.equal(row.checkOut, '2099-02-12');
    });

    it('returns createdAt as an ISO 8601 instant', async () => {
      const row = await findFixture(reservations.confirmed.bookingReference);

      assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.equal(row.createdAt, new Date(created.middle).toISOString());
    });

    it('serializes all three reservation statuses', async () => {
      for (const [status, entry] of [
        ['pending', reservations.pending],
        ['confirmed', reservations.confirmed],
        ['cancelled', reservations.cancelled],
      ] as const) {
        assert.equal((await findFixture(entry.bookingReference)).status, status);
      }
    });

    it('joins the room type rather than exposing its id', async () => {
      const row = await findFixture(reservations.confirmed.bookingReference);

      assert.deepEqual(row.roomType, { slug: fixture.slug, name: fixture.name });
    });
  });
});

// --- GET /api/v1/admin/reservations/:bookingReference -----------------------

type DetailResponse = {
  status: number;
  json: {
    data?: Record<string, any>;
    error?: { code: string; message: string };
  };
};

async function requestDetail(reference: string, headers: Record<string, string>): Promise<DetailResponse> {
  const response = await fetch(`${baseUrl}/api/v1/admin/reservations/${encodeURIComponent(reference)}`, {
    headers,
  });

  return { status: response.status, json: await response.json() };
}

/** Sends this suite's real signed-in session. */
const detailAsAdmin = (reference: string) => requestDetail(reference, { Cookie: sessionCookie });
/** Sends exactly the given Cookie header, whatever it is. */
const detailWithCookie = (reference: string, cookie: string) => requestDetail(reference, { Cookie: cookie });
/** Sends no Cookie header at all — the anonymous case. */
const detailWithoutCookie = (reference: string) => requestDetail(reference, {});

const NOT_AUTHENTICATED = { error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' } };
const INVALID_BOOKING_REFERENCE = {
  error: { code: 'INVALID_BOOKING_REFERENCE', message: 'Invalid booking reference' },
};
const RESERVATION_NOT_FOUND = {
  error: { code: 'RESERVATION_NOT_FOUND', message: 'Reservation not found' },
};

describe('GET /api/v1/admin/reservations/:bookingReference', () => {
  describe('authentication', () => {
    it('refuses a request with no session cookie', async () => {
      const response = await detailWithoutCookie(reservations.pending.bookingReference);

      assert.equal(response.status, 401);
      assert.deepEqual(response.json, NOT_AUTHENTICATED);
    });

    it('refuses an unrelated or malformed cookie identically', async () => {
      for (const cookie of ['theme=dark', 'tph_admin_session=', 'tph_admin_session=not-a-token']) {
        const response = await detailWithCookie(reservations.pending.bookingReference, cookie);

        assert.equal(response.status, 401, `expected 401 for ${cookie.split('=')[0]}`);
        assert.deepEqual(response.json, NOT_AUTHENTICATED);
      }
    });

    it('refuses before deciding whether the reservation exists', async () => {
      // An unauthenticated caller must not be able to tell a real reference
      // from an invented one by the status it returns.
      const unknown = await detailWithoutCookie(generateBookingReference());
      const malformed = await detailWithoutCookie('not-a-reference');

      assert.equal(unknown.status, 401);
      assert.equal(malformed.status, 401);
      assert.deepEqual(unknown.json, NOT_AUTHENTICATED);
      assert.deepEqual(malformed.json, NOT_AUTHENTICATED);
    });

    it('refuses a revoked session', async () => {
      const throwaway = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: admin.email, password: admin.password }),
      });
      const cookie = throwaway.headers
        .getSetCookie()
        .find((value) => value.startsWith('tph_admin_session='))!
        .split(';')[0]!;

      assert.equal(
        (await detailWithCookie(reservations.pending.bookingReference, cookie)).status,
        200,
        'the throwaway session should start valid',
      );

      await fetch(`${baseUrl}/api/v1/admin/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });

      const response = await detailWithCookie(reservations.pending.bookingReference, cookie);
      assert.equal(response.status, 401);
      assert.deepEqual(response.json, NOT_AUTHENTICATED);
    });
  });

  describe('rejects a malformed booking reference', () => {
    const canonical = 'TPH-A2B3C4D5E6F7';
    const malformed: [string, string][] = [
      ['lowercase', canonical.toLowerCase()],
      ['a lowercase token', 'TPH-a2b3c4d5e6f7'],
      ['a wrong prefix', 'ABC-A2B3C4D5E6F7'],
      ['no prefix', 'A2B3C4D5E6F7'],
      ['leading whitespace', ` ${canonical}`],
      ['trailing whitespace', `${canonical} `],
      ['a token that is too short', 'TPH-A2B3C4D5E6F'],
      ['a token that is too long', 'TPH-A2B3C4D5E6F7G'],
      ['an excluded character', 'TPH-A2B3C4D5E6F0'],
      ['an injection attempt', 'TPH-A2B3C4D5E6F7 OR 1=1'],
    ];

    for (const [label, reference] of malformed) {
      it(`with 400 for ${label}`, async () => {
        const response = await detailAsAdmin(reference);

        assert.equal(response.status, 400, `expected 400 for ${label}`);
        assert.deepEqual(response.json, INVALID_BOOKING_REFERENCE);
      });
    }

    it('without echoing the rejected reference back', async () => {
      const response = await detailAsAdmin('TPH-a2b3c4d5e6f7');

      assert.ok(!JSON.stringify(response.json).includes('a2b3c4d5'), 'the input must not be reflected');
    });
  });

  describe('reports an unknown reservation', () => {
    it('with 404 for a canonical reference nobody booked', async () => {
      const response = await detailAsAdmin(generateBookingReference());

      assert.equal(response.status, 404);
      assert.deepEqual(response.json, RESERVATION_NOT_FOUND);
    });

    it('with 404 rather than 400, keeping the two answers apart', async () => {
      const unknown = await detailAsAdmin(generateBookingReference());
      const malformed = await detailAsAdmin('tph-a2b3c4d5e6f7');

      assert.equal(unknown.status, 404);
      assert.equal(malformed.status, 400);
    });
  });

  describe('returns the reservation', () => {
    it('with exactly the detail contract', async () => {
      const response = await detailAsAdmin(reservations.pending.bookingReference);

      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.json), ['data']);
      assert.deepEqual(response.json.data, {
        bookingReference: reservations.pending.bookingReference,
        status: 'pending',
        guest: {
          firstName: fixture.guestFirstName,
          lastName: fixture.guestLastName,
          email: fixture.guestEmail,
          phone: fixture.guestPhone,
          country: fixture.guestCountry,
        },
        stay: {
          checkIn: '2099-01-10',
          checkOut: '2099-01-12',
          // The real DATE subtraction: 12 - 10 = 2.
          nights: 2,
          adults: 2,
          children: 0,
        },
        roomType: { slug: fixture.slug, name: fixture.name },
        room: { number: fixture.roomNumbers[0] },
        pricing: {
          nightlyRate: fixture.nightlyRate,
          totalAmount: fixture.totalAmount,
          currency: 'EGP',
        },
        specialRequests: 'Late arrival',
        createdAt: new Date(created.oldest).toISOString(),
      });
    });

    it('including the physical room number, which the list never exposes', async () => {
      const detail = (await detailAsAdmin(reservations.pending.bookingReference)).json.data!;

      assert.equal(detail.room.number, fixture.roomNumbers[0]);
      assert.deepEqual(Object.keys(detail.room), ['number']);

      const listRow = requireData(await listReservationsAsAdmin('?limit=100')).reservations.find(
        (row) => row.bookingReference === reservations.pending.bookingReference,
      );
      assert.ok(listRow, 'the fixture must also appear in the list');
      assert.ok(!('room' in listRow), 'the list must not gain a room field');
    });

    it('omitting every internal identifier', async () => {
      const detail = (await detailAsAdmin(reservations.pending.bookingReference)).json.data!;

      for (const field of ['id', 'reservationId', 'roomId', 'roomTypeId', 'updatedAt']) {
        assert.ok(!(field in detail), `${field} must not appear in the detail contract`);
      }
      assert.ok(!('id' in detail.roomType), 'the room type carries slug and name only');
    });

    it('with money as exact strings in EGP', async () => {
      const { pricing } = (await detailAsAdmin(reservations.pending.bookingReference)).json.data!;

      assert.equal(typeof pricing.nightlyRate, 'string');
      assert.equal(typeof pricing.totalAmount, 'string');
      assert.equal(pricing.nightlyRate, fixture.nightlyRate);
      assert.equal(pricing.totalAmount, fixture.totalAmount);
      assert.equal(pricing.currency, 'EGP');
    });

    it('with calendar dates, real nights and an ISO instant', async () => {
      const { stay, createdAt } = (await detailAsAdmin(reservations.tiebreak.bookingReference)).json.data!;

      assert.match(stay.checkIn, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(stay.checkOut, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(stay.checkIn, '2099-02-10');
      assert.equal(stay.checkOut, '2099-02-12');
      assert.equal(stay.nights, 2);
      assert.match(createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.equal(createdAt, new Date(created.tied).toISOString());
    });

    it('with special requests as text when the guest left some', async () => {
      const detail = (await detailAsAdmin(reservations.confirmed.bookingReference)).json.data!;

      assert.equal(detail.specialRequests, 'Late arrival');
    });

    it('with special requests null when the guest left none', async () => {
      const detail = (await detailAsAdmin(reservations.cancelled.bookingReference)).json.data!;

      assert.equal(detail.specialRequests, null);
    });

    it('for every status the schema allows', async () => {
      for (const [status, entry] of [
        ['pending', reservations.pending],
        ['confirmed', reservations.confirmed],
        ['cancelled', reservations.cancelled],
      ] as const) {
        const response = await detailAsAdmin(entry.bookingReference);

        assert.equal(response.status, 200, `expected 200 for the ${status} fixture`);
        assert.equal(response.json.data!.status, status);
      }
    });
  });
});
