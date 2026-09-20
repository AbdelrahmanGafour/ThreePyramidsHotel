import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

// Exercises GET /api/v1/admin/reservations over real HTTP against a real
// PostgreSQL database: the real app, the real session guard, the real
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
}): Promise<Fixture> {
  const bookingReference = `ITAR-${randomUUID().slice(0, 12).toUpperCase()}`;

  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO reservations (
       booking_reference, room_type_id, room_id,
       guest_first_name, guest_last_name, guest_email, guest_phone, guest_country,
       adults, children, check_in, check_out,
       status, currency, nightly_rate_snapshot, total_amount, special_requests, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, '+201000000000', 'Egypt',
             2, 0, $7::date, $8::date, $9, 'EGP', $10, $11, 'Late arrival', $12::timestamptz)
     RETURNING id`,
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
      input.createdAt,
    ],
  );

  const row = rows[0];
  assert.ok(row, `failed to insert fixture reservation ${bookingReference}`);

  return { bookingReference, id: row.id };
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

  const { rows: roomTypeRows } = await dbPool.query<{ id: string }>(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, $3, $4, true, 0)
     RETURNING id`,
    [fixture.slug, fixture.name, fixture.capacity, fixture.nightlyRate],
  );

  const createdRoomType = roomTypeRows[0];
  assert.ok(createdRoomType, 'failed to create the fixture room type');
  roomTypeId = createdRoomType.id;

  const { rows: roomRows } = await dbPool.query<{ id: string }>(
    `INSERT INTO rooms (room_type_id, room_number, is_active)
     VALUES ($1, $2, true), ($1, $3, true), ($1, $4, true)
     RETURNING id`,
    [roomTypeId, ...fixture.roomNumbers],
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
  reservations.cancelled = await insertReservation({
    roomIndex: 2,
    checkIn: '2099-01-10',
    checkOut: '2099-01-12',
    status: 'cancelled',
    createdAt: created.tied,
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
      `SELECT (SELECT COUNT(*) FROM reservations WHERE room_type_id = $1)::int AS reservations,
              (SELECT COUNT(*) FROM rooms WHERE room_type_id = $1)::int AS rooms,
              (SELECT COUNT(*) FROM room_types WHERE id = $1)::int AS room_types,
              (SELECT COUNT(*) FROM admin_users WHERE email = $2)::int AS admins`,
      [roomTypeId, admin.email],
    );

    assert.deepEqual(
      rows[0],
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
      const { rows } = await dbPool.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM reservations');

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
