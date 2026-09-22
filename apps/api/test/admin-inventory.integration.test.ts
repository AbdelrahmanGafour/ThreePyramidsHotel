import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { generateBookingReference } from '../src/modules/reservations/booking-reference';

// Exercises the five T02 inventory endpoints over real HTTP against a real
// PostgreSQL database: the real app, the real session guard, the real service
// transactions, the real repository SQL and the real constraints. Nothing is
// mocked.
//
// It creates its own admin account, room types, physical rooms and
// reservations with identifiers unique to this run, and removes exactly those
// afterwards. No other data is read for assertions or deleted.
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
const slugPrefix = `itest-inv-${runId}`;

const admin = {
  email: `itest-inv-${runId}@example.com`,
  displayName: `Inventory Admin ${runId}`,
  password: `fixture-password-${runId}`,
};

/** Room-type slugs, one per scenario so no test depends on another's state. */
const slugs = {
  clean: `${slugPrefix}-clean`,
  empty: `${slugPrefix}-empty`,
  listing: `${slugPrefix}-listing`,
  archived: `${slugPrefix}-archived`,
  capPending: `${slugPrefix}-cap-pending`,
  capConfirmed: `${slugPrefix}-cap-confirmed`,
  capProgress: `${slugPrefix}-cap-progress`,
  capCancelled: `${slugPrefix}-cap-cancelled`,
  capPast: `${slugPrefix}-cap-past`,
  capFits: `${slugPrefix}-cap-fits`,
  deact: `${slugPrefix}-deact`,
  renames: `${slugPrefix}-renames`,
} as const;

/** Room numbers are capped at 20 characters, so these stay short. */
const room = (prefix: string) => `${prefix}-${runId}`;

const roomTypeIds: Record<string, string> = {};

type JsonResponse = {
  status: number;
  json: { data?: any; error?: { code: string; message: string } };
};

const NOT_AUTHENTICATED = { error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' } };
const INVALID_SLUG = { error: { code: 'INVALID_ROOM_TYPE_SLUG', message: 'Invalid room type slug' } };
const ROOM_TYPE_NOT_FOUND = { error: { code: 'ROOM_TYPE_NOT_FOUND', message: 'Room type not found' } };
const INVALID_CREATE = {
  error: { code: 'INVALID_ROOM_TYPE_CREATE', message: 'Invalid room type creation request' },
};
const SLUG_TAKEN = {
  error: { code: 'ROOM_TYPE_SLUG_TAKEN', message: 'Room type reference is already in use' },
};
const INVALID_CAPACITY = {
  error: { code: 'INVALID_ROOM_TYPE_CAPACITY', message: 'Invalid room type capacity' },
};
const CAPACITY_CONFLICT = {
  error: {
    code: 'ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS',
    message: 'Room type capacity conflicts with existing upcoming reservations',
  },
};
const INVALID_ROOM_CREATE = {
  error: { code: 'INVALID_ROOM_CREATE', message: 'Invalid room creation request' },
};
const INVALID_ROOM_NUMBER = { error: { code: 'INVALID_ROOM_NUMBER', message: 'Invalid room number' } };
const INVALID_ROOM_UPDATE = { error: { code: 'INVALID_ROOM_UPDATE', message: 'Invalid room update' } };
const ROOM_NOT_FOUND = { error: { code: 'ROOM_NOT_FOUND', message: 'Room not found' } };
const ROOM_NUMBER_TAKEN = {
  error: { code: 'ROOM_NUMBER_TAKEN', message: 'Room number is already in use' },
};
const ROOM_HAS_FUTURE_RESERVATIONS = {
  error: { code: 'ROOM_HAS_FUTURE_RESERVATIONS', message: 'Room has upcoming reservations' },
};

async function request(
  path: string,
  init: RequestInit,
  headers: Record<string, string>,
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...init.headers, ...headers } });

  return { status: response.status, json: await response.json().catch(() => ({})) };
}

// Three helpers rather than one with an optional cookie: an omitted argument is
// indistinguishable from an explicit `undefined`, so a default would silently
// turn "send no cookie" into "send the valid session".

/** Sends this suite's real signed-in session. */
const asAdmin = (path: string, init: RequestInit = {}) => request(path, init, { Cookie: sessionCookie });
/** Sends no Cookie header at all — the anonymous case. */
const withoutCookie = (path: string, init: RequestInit = {}) => request(path, init, {});

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const typePath = (slug: string) => `/api/v1/admin/room-types/${encodeURIComponent(slug)}`;
const roomsPath = (slug: string) => `${typePath(slug)}/rooms`;
const capacityPath = (slug: string) => `${typePath(slug)}/capacity`;
const roomPath = (roomNumber: string) => `/api/v1/admin/rooms/${encodeURIComponent(roomNumber)}`;

const postRoomType = (body: unknown) => asAdmin('/api/v1/admin/room-types', json('POST', body));
const patchCapacity = (slug: string, body: unknown) => asAdmin(capacityPath(slug), json('PATCH', body));
const postRoom = (slug: string, body: unknown) => asAdmin(roomsPath(slug), json('POST', body));
const patchRoom = (roomNumber: string, body: unknown) => asAdmin(roomPath(roomNumber), json('PATCH', body));

async function insertRoomType(slug: string, capacity: number, isActive = true): Promise<string> {
  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, $3, '1500.00', $4, 0)
     RETURNING id`,
    [slug, `Fixture ${slug}`, capacity, isActive],
  );

  const row = rows[0];
  assert.ok(row, `failed to insert fixture room type ${slug}`);
  roomTypeIds[slug] = row.id;

  return row.id;
}

async function insertRoom(roomTypeId: string, roomNumber: string, isActive = true): Promise<string> {
  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO rooms (room_type_id, room_number, is_active) VALUES ($1, $2, $3) RETURNING id`,
    [roomTypeId, roomNumber, isActive],
  );

  const row = rows[0];
  assert.ok(row, `failed to insert fixture room ${roomNumber}`);

  return row.id;
}

/**
 * Inserts one reservation with dates relative to CURRENT_DATE, so "upcoming"
 * and "past" stay true whenever the suite runs. Each reservation gets its own
 * physical room, so the exclusion constraint never interferes.
 */
async function insertReservation(input: {
  roomTypeId: string;
  roomId: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  checkInOffset: number;
  checkOutOffset: number;
  adults: number;
  children: number;
}): Promise<void> {
  await dbPool.query(
    `INSERT INTO reservations (
       booking_reference, room_type_id, room_id,
       guest_first_name, guest_last_name, guest_email, guest_phone, guest_country,
       adults, children, check_in, check_out,
       status, currency, nightly_rate_snapshot, total_amount, special_requests
     )
     VALUES ($1, $2, $3, 'Amelia', 'Hartwell', $4, '+201000000000', 'Egypt',
             -- ::int is required: an untyped parameter leaves PostgreSQL
             -- unable to choose between date + integer and date + interval.
             $5, $6, CURRENT_DATE + $7::int, CURRENT_DATE + $8::int,
             $9, 'EGP', '1500.00', '3000.00', NULL)`,
    [
      generateBookingReference(),
      input.roomTypeId,
      input.roomId,
      `guest-${runId}@example.com`,
      input.adults,
      input.children,
      input.checkInOffset,
      input.checkOutOffset,
      input.status,
    ],
  );
}

async function readRoomType(slug: string) {
  const { rows } = await dbPool.query<{
    id: string;
    slug: string;
    name: string;
    capacity: number;
    base_nightly_rate: string;
    is_active: boolean;
    sort_order: number;
    updated_at: Date;
  }>(
    `SELECT id, slug, name, capacity, base_nightly_rate::text AS base_nightly_rate,
            is_active, sort_order, updated_at
       FROM room_types WHERE slug = $1`,
    [slug],
  );

  return rows[0];
}

async function readRoom(roomNumber: string) {
  const { rows } = await dbPool.query<{
    id: string;
    room_type_id: string;
    room_number: string;
    is_active: boolean;
  }>(`SELECT id, room_type_id, room_number, is_active FROM rooms WHERE room_number = $1`, [roomNumber]);

  return rows[0];
}

const countRoomsFor = async (slug: string): Promise<number> => {
  const { rows } = await dbPool.query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM rooms WHERE room_type_id = $1::bigint',
    [roomTypeIds[slug]],
  );

  return rows[0]!.n;
};

/** An ISO instant that round-trips exactly, as the API contract promises. */
const isInstant = (value: unknown): boolean =>
  typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString() === value;

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
    `INSERT INTO admin_users (email, display_name, password_hash, is_active) VALUES ($1, $2, $3, true)`,
    [admin.email, admin.displayName, await hashPassword(admin.password)],
  );

  await insertRoomType(slugs.clean, 4);
  await insertRoomType(slugs.empty, 2);
  await insertRoomType(slugs.archived, 2, false);
  await insertRoomType(slugs.renames, 2);

  // Listing fixture: deliberately inserted out of order, and one inactive, so
  // the ordering and the "inactive rooms are included" rules are both real.
  const listingId = await insertRoomType(slugs.listing, 2);
  await insertRoom(listingId, room('L3'), true);
  await insertRoom(listingId, room('L1'), true);
  await insertRoom(listingId, room('L2'), false);

  // Capacity scenarios: one room type each, capacity 4, one room, one
  // reservation for a party of 5 except where noted.
  const capacityFixtures: [string, 'pending' | 'confirmed' | 'cancelled', number, number, number][] = [
    // slug, status, checkInOffset, checkOutOffset, totalGuests
    [slugs.capPending, 'pending', 30, 33, 5],
    [slugs.capConfirmed, 'confirmed', 30, 33, 5],
    // Checked in yesterday, leaving in two days: still an obligation.
    [slugs.capProgress, 'confirmed', -1, 2, 5],
    [slugs.capCancelled, 'cancelled', 30, 33, 5],
    // Checked out today: check_out is not > CURRENT_DATE, so it is past.
    [slugs.capPast, 'confirmed', -2, 0, 5],
    // A party that still fits under the lowered capacity.
    [slugs.capFits, 'confirmed', 30, 33, 2],
  ];

  let k = 1;
  for (const [slug, status, checkIn, checkOut, guests] of capacityFixtures) {
    const typeId = await insertRoomType(slug, 4);
    const roomId = await insertRoom(typeId, room(`K${k}`), true);
    k += 1;

    await insertReservation({
      roomTypeId: typeId,
      roomId,
      status,
      checkInOffset: checkIn,
      checkOutOffset: checkOut,
      adults: guests,
      children: 0,
    });
  }

  // Deactivation scenarios: one room type, one room per case.
  const deactId = await insertRoomType(slugs.deact, 4);
  const deactFixtures: [string, 'pending' | 'confirmed' | 'cancelled' | null, number, number][] = [
    ['G1', 'pending', 30, 33],
    ['G2', 'confirmed', 30, 33],
    ['G3', 'confirmed', -1, 2],
    ['G4', 'cancelled', 30, 33],
    ['G5', 'confirmed', -2, 0],
    ['G6', null, 0, 0],
    ['G7', null, 0, 0],
  ];

  for (const [prefix, status, checkIn, checkOut] of deactFixtures) {
    const roomId = await insertRoom(deactId, room(prefix), true);

    if (status) {
      await insertReservation({
        roomTypeId: deactId,
        roomId,
        status,
        checkInOffset: checkIn,
        checkOutOffset: checkOut,
        adults: 2,
        children: 0,
      });
    }
  }

  // Rename fixtures.
  await insertRoom(roomTypeIds[slugs.renames]!, room('N1'), true);
  await insertRoom(roomTypeIds[slugs.renames]!, room('N2'), true);
  await insertRoom(roomTypeIds[slugs.renames]!, room('N3'), true);
  await insertRoom(roomTypeIds[slugs.renames]!, room('N4'), true);

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
    const like = `${slugPrefix}-%`;

    // Dependency-safe order, scoped to this run's unique slug prefix. Room
    // types created through the API during the suite are covered too, because
    // they carry the same prefix.
    await dbPool.query(
      'DELETE FROM reservations WHERE room_type_id IN (SELECT id FROM room_types WHERE slug LIKE $1)',
      [like],
    );
    await dbPool.query('DELETE FROM rooms WHERE room_type_id IN (SELECT id FROM room_types WHERE slug LIKE $1)', [
      like,
    ]);
    await dbPool.query('DELETE FROM room_types WHERE slug LIKE $1', [like]);
    await dbPool.query(
      'DELETE FROM admin_sessions WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = $1)',
      [admin.email],
    );
    await dbPool.query('DELETE FROM admin_users WHERE email = $1', [admin.email]);

    const { rows } = await dbPool.query<{ types: number; rooms: number; admins: number }>(
      `SELECT (SELECT COUNT(*) FROM room_types WHERE slug LIKE $1)::int AS types,
              (SELECT COUNT(*) FROM rooms WHERE room_number LIKE $2)::int AS rooms,
              (SELECT COUNT(*) FROM admin_users WHERE email = $3)::int AS admins`,
      [like, `%${runId}`, admin.email],
    );

    assert.deepEqual(rows[0], { types: 0, rooms: 0, admins: 0 }, 'fixtures were not fully removed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDatabasePool();
  }
});

describe('POST /api/v1/admin/room-types', () => {
  it('creates an inactive draft and returns the full detail contract', async () => {
    const slug = `${slugPrefix}-created`;
    const response = await postRoomType({
      slug,
      name: '  Garden Suite  ',
      capacity: 3,
      baseNightlyRate: '2400.50',
      shortDescription: '  A quiet upper floor.  ',
      bedType: 'King',
      bedCount: 2,
      sizeSqm: '42.50',
      view: 'Plateau',
    });

    assert.equal(response.status, 201);

    const data = response.json.data;
    assert.equal(data.slug, slug);
    assert.equal(data.name, 'Garden Suite', 'text is trimmed before storage');
    assert.equal(data.capacity, 3);
    assert.equal(data.baseNightlyRate, '2400.50');
    assert.equal(typeof data.baseNightlyRate, 'string', 'money stays an exact decimal string');
    assert.equal(data.currency, 'EGP');
    assert.equal(data.isActive, false, 'creation always yields a draft');
    assert.equal(data.roomCount, 0, 'no physical room is created');
    assert.equal(data.sortOrder, 0, 'sortOrder defaults to 0 when omitted');
    assert.equal(data.shortDescription, 'A quiet upper floor.');
    assert.equal(data.description, null, 'omitted nullable fields are null');
    assert.equal(data.bedType, 'King');
    assert.equal(data.bedCount, 2);
    assert.equal(data.sizeSqm, '42.50');
    assert.equal(data.view, 'Plateau');
    assert.ok(isInstant(data.createdAt), 'createdAt is a canonical ISO instant');
    assert.ok(isInstant(data.updatedAt), 'updatedAt is a canonical ISO instant');
  });

  it('exposes no internal identifier', async () => {
    const slug = `${slugPrefix}-noids`;
    const response = await postRoomType({ slug, name: 'No Ids', capacity: 2, baseNightlyRate: '100.00' });

    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(response.json.data).sort(), [
      'baseNightlyRate',
      'bedCount',
      'bedType',
      'capacity',
      'createdAt',
      'currency',
      'description',
      'isActive',
      'name',
      'roomCount',
      'shortDescription',
      'sizeSqm',
      'slug',
      'sortOrder',
      'updatedAt',
      'view',
    ]);
  });

  it('writes exactly one inactive row and no physical rooms', async () => {
    const slug = `${slugPrefix}-dbstate`;
    await postRoomType({ slug, name: 'DB State', capacity: 2, baseNightlyRate: '500.00' });

    const { rows } = await dbPool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM room_types WHERE slug = $1',
      [slug],
    );
    assert.equal(rows[0]!.n, 1, 'exactly one room_types row');

    const stored = await readRoomType(slug);
    assert.equal(stored!.is_active, false, 'is_active is false in PostgreSQL');

    const { rows: roomRows } = await dbPool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM rooms WHERE room_type_id = $1::bigint',
      [stored!.id],
    );
    assert.equal(roomRows[0]!.n, 0, 'zero physical rooms created');
  });

  it('accepts a zero nightly rate', async () => {
    const slug = `${slugPrefix}-freerate`;
    const response = await postRoomType({ slug, name: 'On Request', capacity: 2, baseNightlyRate: '0.00' });

    assert.equal(response.status, 201);
    assert.equal(response.json.data.baseNightlyRate, '0.00');
  });

  describe('rejects an invalid body', () => {
    const cases: [string, unknown][] = [
      ['a missing name', { slug: `${slugPrefix}-x1`, capacity: 2, baseNightlyRate: '100.00' }],
      ['an uppercase slug', { slug: `${slugPrefix}-BAD`, name: 'X', capacity: 2, baseNightlyRate: '100.00' }],
      ['a caller-supplied isActive', {
        slug: `${slugPrefix}-x2`,
        name: 'X',
        capacity: 2,
        baseNightlyRate: '100.00',
        isActive: true,
      }],
      ['a capacity past the integer column', {
        slug: `${slugPrefix}-x3`,
        name: 'X',
        capacity: 2147483648,
        baseNightlyRate: '100.00',
      }],
      ['a numeric rate', { slug: `${slugPrefix}-x4`, name: 'X', capacity: 2, baseNightlyRate: 100 }],
      ['an unknown key', {
        slug: `${slugPrefix}-x5`,
        name: 'X',
        capacity: 2,
        baseNightlyRate: '100.00',
        roomCount: 3,
      }],
    ];

    for (const [label, body] of cases) {
      it(label, async () => {
        const response = await postRoomType(body);

        assert.equal(response.status, 400);
        assert.deepEqual(response.json, INVALID_CREATE);
      });
    }

    it('writes nothing when the body is refused', async () => {
      await postRoomType({ slug: `${slugPrefix}-x6`, name: '', capacity: 2, baseNightlyRate: '100.00' });

      const { rows } = await dbPool.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM room_types WHERE slug = $1',
        [`${slugPrefix}-x6`],
      );
      assert.equal(rows[0]!.n, 0);
    });
  });

  it('refuses a duplicate slug with the locked conflict, leaking no constraint name', async () => {
    const response = await postRoomType({
      slug: slugs.clean,
      name: 'Duplicate',
      capacity: 2,
      baseNightlyRate: '100.00',
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.json, SLUG_TAKEN);
    assert.deepEqual(Object.keys(response.json.error!).sort(), ['code', 'message']);

    const serialised = JSON.stringify(response.json);
    assert.doesNotMatch(serialised, /room_types_slug_key|23505|constraint|duplicate key/i);
  });
});

describe('PATCH /api/v1/admin/room-types/:slug/capacity', () => {
  it('raises capacity and returns the full detail', async () => {
    const before = await readRoomType(slugs.clean);
    const response = await patchCapacity(slugs.clean, { capacity: 6 });

    assert.equal(response.status, 200);
    assert.equal(response.json.data.capacity, 6);
    assert.equal(response.json.data.slug, slugs.clean);
    assert.equal(response.json.data.isActive, true, 'status is untouched');
    assert.equal(response.json.data.baseNightlyRate, '1500.00', 'pricing is untouched');

    const after = await readRoomType(slugs.clean);
    assert.equal(after!.capacity, 6);
    assert.ok(after!.updated_at > before!.updated_at, 'updatedAt advances');
    assert.equal(after!.slug, before!.slug);
    assert.equal(after!.name, before!.name);
    assert.equal(after!.is_active, before!.is_active);
  });

  it('accepts a same-value request', async () => {
    const response = await patchCapacity(slugs.clean, { capacity: 6 });

    assert.equal(response.status, 200);
    assert.equal(response.json.data.capacity, 6);
  });

  it('lowers capacity when nothing conflicts', async () => {
    const response = await patchCapacity(slugs.clean, { capacity: 2 });

    assert.equal(response.status, 200);
    assert.equal(response.json.data.capacity, 2);
    assert.equal((await readRoomType(slugs.clean))!.capacity, 2);
  });

  it('returns 404 for a canonical slug with no row', async () => {
    const response = await patchCapacity(`${slugPrefix}-missing`, { capacity: 2 });

    assert.equal(response.status, 404);
    assert.deepEqual(response.json, ROOM_TYPE_NOT_FOUND);
  });

  it('returns 400 for a malformed slug, before the body matters', async () => {
    const response = await patchCapacity('NOT-CANONICAL', { capacity: 0 });

    assert.equal(response.status, 400);
    assert.deepEqual(response.json, INVALID_SLUG);
  });

  describe('rejects an invalid capacity body', () => {
    for (const [label, body] of [
      ['zero', { capacity: 0 }],
      ['negative', { capacity: -1 }],
      ['fractional', { capacity: 2.5 }],
      ['a string', { capacity: '2' }],
      ['past the integer column', { capacity: 2147483648 }],
      ['an empty object', {}],
      ['an extra key', { capacity: 2, reason: 'refurbishment' }],
    ] as const) {
      it(label, async () => {
        const response = await patchCapacity(slugs.clean, body);

        assert.equal(response.status, 400);
        assert.deepEqual(response.json, INVALID_CAPACITY);
      });
    }
  });

  describe('the conflict rule, against real reservations', () => {
    // Each room type below carries exactly one reservation for a party of 5,
    // except capFits. Lowering capacity to 2 is the request under test.
    const blocks: [string, string][] = [
      [slugs.capPending, 'a future pending stay'],
      [slugs.capConfirmed, 'a future confirmed stay'],
      [slugs.capProgress, 'a stay checked in but not yet checked out'],
    ];

    for (const [slug, label] of blocks) {
      it(`blocks a decrease below ${label}`, async () => {
        const response = await patchCapacity(slug, { capacity: 2 });

        assert.equal(response.status, 409);
        assert.deepEqual(response.json, CAPACITY_CONFLICT);
        assert.equal((await readRoomType(slug))!.capacity, 4, 'capacity is unchanged in PostgreSQL');
      });
    }

    const allows: [string, string][] = [
      [slugs.capCancelled, 'a cancelled stay'],
      [slugs.capPast, 'a stay that has already checked out'],
      [slugs.capFits, 'a party that still fits'],
    ];

    for (const [slug, label] of allows) {
      it(`allows a decrease despite ${label}`, async () => {
        const response = await patchCapacity(slug, { capacity: 2 });

        assert.equal(response.status, 200);
        assert.equal(response.json.data.capacity, 2);
        assert.equal((await readRoomType(slug))!.capacity, 2);
      });
    }

    it('carries no count, reference, date or guest data in the refusal', async () => {
      const response = await patchCapacity(slugs.capPending, { capacity: 1 });

      assert.equal(response.status, 409);
      assert.deepEqual(Object.keys(response.json).sort(), ['error']);
      assert.deepEqual(Object.keys(response.json.error!).sort(), ['code', 'message']);
      assert.doesNotMatch(JSON.stringify(response.json), /\d|TPH-|Amelia|Hartwell|@example/);
    });

    it('never rewrites the guest counts on an existing reservation', async () => {
      const { rows: before } = await dbPool.query<{ adults: number; children: number }>(
        'SELECT adults, children FROM reservations WHERE room_type_id = $1::bigint',
        [roomTypeIds[slugs.capPending]],
      );

      await patchCapacity(slugs.capPending, { capacity: 2 });

      const { rows: after } = await dbPool.query<{ adults: number; children: number }>(
        'SELECT adults, children FROM reservations WHERE room_type_id = $1::bigint',
        [roomTypeIds[slugs.capPending]],
      );

      assert.deepEqual(after, before, 'the party a guest booked is never edited');
    });
  });
});

describe('GET /api/v1/admin/room-types/:slug/rooms', () => {
  it('returns an empty list for a room type with no rooms', async () => {
    const response = await asAdmin(roomsPath(slugs.empty));

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, { data: { rooms: [] } });
  });

  it('returns active and inactive rooms alike, ordered by room number', async () => {
    const response = await asAdmin(roomsPath(slugs.listing));

    assert.equal(response.status, 200);
    assert.deepEqual(
      response.json.data.rooms.map((entry: any) => [entry.roomNumber, entry.isActive]),
      [
        [room('L1'), true],
        [room('L2'), false],
        [room('L3'), true],
      ],
      'ordered by room_number ASC, with the inactive room included',
    );
  });

  it('returns exactly the four contracted fields, with no identifiers', async () => {
    const response = await asAdmin(roomsPath(slugs.listing));

    for (const entry of response.json.data.rooms) {
      assert.deepEqual(Object.keys(entry).sort(), ['createdAt', 'isActive', 'roomNumber', 'updatedAt']);
      assert.ok(isInstant(entry.createdAt));
      assert.ok(isInstant(entry.updatedAt));
    }
  });

  it('returns 404 for a canonical slug with no row', async () => {
    const response = await asAdmin(roomsPath(`${slugPrefix}-missing`));

    assert.equal(response.status, 404);
    assert.deepEqual(response.json, ROOM_TYPE_NOT_FOUND);
  });

  it('returns 400 for a malformed slug', async () => {
    const response = await asAdmin(roomsPath('NOT-CANONICAL'));

    assert.equal(response.status, 400);
    assert.deepEqual(response.json, INVALID_SLUG);
  });
});

describe('POST /api/v1/admin/room-types/:slug/rooms', () => {
  it('creates an active room, trimmed and case-preserved', async () => {
    const number = room('P1');
    const response = await postRoom(slugs.empty, { roomNumber: `  ${number}  ` });

    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(response.json.data).sort(), [
      'createdAt',
      'isActive',
      'roomNumber',
      'updatedAt',
    ]);
    assert.equal(response.json.data.roomNumber, number, 'trimmed before storage');
    assert.equal(response.json.data.isActive, true, 'a new room is in service');

    const stored = await readRoom(number);
    assert.ok(stored, 'the room exists in PostgreSQL');
    assert.equal(stored!.room_number, number);
    assert.equal(stored!.room_type_id, roomTypeIds[slugs.empty], 'belongs to the requested room type');
  });

  it('preserves mixed case exactly', async () => {
    const number = `Ph-${runId}`;
    const response = await postRoom(slugs.empty, { roomNumber: number });

    assert.equal(response.status, 201);
    assert.equal(response.json.data.roomNumber, number);
    assert.equal((await readRoom(number))!.room_number, number);
  });

  it('does not activate an archived room type', async () => {
    const number = room('AR');
    const response = await postRoom(slugs.archived, { roomNumber: number });

    assert.equal(response.status, 201);
    assert.equal((await readRoomType(slugs.archived))!.is_active, false, 'the room type stays archived');
  });

  it('returns 404 and creates nothing for an unknown room type', async () => {
    const number = room('NX');
    const response = await postRoom(`${slugPrefix}-missing`, { roomNumber: number });

    assert.equal(response.status, 404);
    assert.deepEqual(response.json, ROOM_TYPE_NOT_FOUND);
    assert.equal(await readRoom(number), undefined, 'no room row was created');
  });

  describe('rejects an invalid create body', () => {
    for (const [label, body] of [
      ['an empty object', {}],
      ['a forbidden delimiter', { roomNumber: `D/${runId}` }],
      ['a percent', { roomNumber: `D%${runId}` }],
      ['over twenty characters', { roomNumber: 'A'.repeat(21) }],
      ['whitespace only', { roomNumber: '   ' }],
      ['a number', { roomNumber: 101 }],
      ['an unknown key', { roomNumber: room('ZZ'), isActive: true }],
    ] as const) {
      it(label, async () => {
        const response = await postRoom(slugs.empty, body);

        assert.equal(response.status, 400);
        assert.deepEqual(response.json, INVALID_ROOM_CREATE, 'a create body is never INVALID_ROOM_NUMBER');
      });
    }
  });

  describe('uniqueness is enforced by PostgreSQL', () => {
    it('refuses an exact duplicate', async () => {
      const before = await countRoomsFor(slugs.listing);
      const response = await postRoom(slugs.listing, { roomNumber: room('L1') });

      assert.equal(response.status, 409);
      assert.deepEqual(response.json, ROOM_NUMBER_TAKEN);
      assert.equal(await countRoomsFor(slugs.listing), before, 'no second room exists');
    });

    it('refuses a case-only duplicate, proving rooms_room_number_lower_key', async () => {
      const before = await countRoomsFor(slugs.listing);
      const collision = room('L1').toLowerCase();

      assert.notEqual(collision, room('L1'), 'the fixture must differ only by case');

      const response = await postRoom(slugs.listing, { roomNumber: collision });

      assert.equal(response.status, 409);
      assert.deepEqual(response.json, ROOM_NUMBER_TAKEN);
      assert.equal(await countRoomsFor(slugs.listing), before, 'no second room exists');
      assert.equal((await readRoom(room('L1')))!.room_number, room('L1'), 'the original is unchanged');
    });

    it('leaks no constraint name or SQLSTATE', async () => {
      const response = await postRoom(slugs.listing, { roomNumber: room('L1') });

      assert.doesNotMatch(
        JSON.stringify(response.json),
        /rooms_room_number|lower_key|23505|constraint|duplicate key/i,
      );
    });
  });
});

describe('PATCH /api/v1/admin/rooms/:roomNumber', () => {
  describe('rename', () => {
    it('renames, answers with the new number, and stores it', async () => {
      const from = room('N1');
      const to = `Re-${runId}`;

      const response = await patchRoom(from, { roomNumber: to });

      assert.equal(response.status, 200);
      assert.equal(response.json.data.roomNumber, to, 'the response carries the NEW number');
      assert.equal((await readRoom(to))!.room_number, to, 'case is preserved in PostgreSQL');
      assert.equal(await readRoom(from), undefined, 'the old number no longer exists');
    });

    it('no longer resolves the old identifier, and does resolve the new one', async () => {
      const stale = await patchRoom(room('N1'), { isActive: true });
      assert.equal(stale.status, 404);
      assert.deepEqual(stale.json, ROOM_NOT_FOUND);

      const fresh = await patchRoom(`Re-${runId}`, { isActive: true });
      assert.equal(fresh.status, 200);
      assert.equal(fresh.json.data.roomNumber, `Re-${runId}`);
    });
  });

  describe('status', () => {
    it('deactivates a room with no blocking reservation', async () => {
      const response = await patchRoom(room('G6'), { isActive: false });

      assert.equal(response.status, 200);
      assert.equal(response.json.data.isActive, false);
      assert.equal((await readRoom(room('G6')))!.is_active, false);
    });

    it('reactivates it again', async () => {
      const response = await patchRoom(room('G6'), { isActive: true });

      assert.equal(response.status, 200);
      assert.equal(response.json.data.isActive, true);
    });

    it('accepts isActive:true on an already-active room', async () => {
      const response = await patchRoom(room('G6'), { isActive: true });

      assert.equal(response.status, 200);
      assert.equal(response.json.data.isActive, true);
    });

    it('accepts isActive:false on an already-inactive room', async () => {
      await patchRoom(room('G7'), { isActive: false });
      const response = await patchRoom(room('G7'), { isActive: false });

      assert.equal(response.status, 200, 'no same-state conflict exists');
      assert.equal(response.json.data.isActive, false);
    });
  });

  describe('combined update', () => {
    it('renames and deactivates atomically', async () => {
      const to = `Cd-${runId}`;
      const response = await patchRoom(room('N2'), { roomNumber: to, isActive: false });

      assert.equal(response.status, 200);
      assert.equal(response.json.data.roomNumber, to);
      assert.equal(response.json.data.isActive, false);

      const stored = await readRoom(to);
      assert.equal(stored!.is_active, false);
      assert.equal(await readRoom(room('N2')), undefined);
    });

    it('renames and activates atomically', async () => {
      const to = `Ca-${runId}`;
      const response = await patchRoom(`Cd-${runId}`, { roomNumber: to, isActive: true });

      assert.equal(response.status, 200);
      assert.equal(response.json.data.roomNumber, to);
      assert.equal(response.json.data.isActive, true);
      assert.equal((await readRoom(to))!.is_active, true);
    });
  });

  describe('route and body error ownership', () => {
    it('answers INVALID_ROOM_NUMBER for a padded route identifier', async () => {
      const response = await patchRoom(` ${room('N3')} `, { isActive: true });

      assert.equal(response.status, 400);
      assert.deepEqual(response.json, INVALID_ROOM_NUMBER);
    });

    it('answers INVALID_ROOM_NUMBER for a forbidden character in the route', async () => {
      const response = await patchRoom(`D/${runId}`, { isActive: true });

      assert.equal(response.status, 400);
      assert.deepEqual(response.json, INVALID_ROOM_NUMBER);
    });

    it('answers INVALID_ROOM_UPDATE for a malformed replacement number', async () => {
      const response = await patchRoom(room('N3'), { roomNumber: `D/${runId}` });

      assert.equal(response.status, 400);
      assert.deepEqual(response.json, INVALID_ROOM_UPDATE, 'the body owns its own contract');
    });

    it('answers INVALID_ROOM_UPDATE for an empty body', async () => {
      const response = await patchRoom(room('N3'), {});

      assert.equal(response.status, 400);
      assert.deepEqual(response.json, INVALID_ROOM_UPDATE);
    });

    it('answers INVALID_ROOM_UPDATE for a non-boolean status', async () => {
      const response = await patchRoom(room('N3'), { isActive: 'true' });

      assert.equal(response.status, 400);
      assert.deepEqual(response.json, INVALID_ROOM_UPDATE);
    });

    it('answers 404 for a well-formed but unknown room number', async () => {
      const response = await patchRoom(`Zz-${runId}`, { isActive: true });

      assert.equal(response.status, 404);
      assert.deepEqual(response.json, ROOM_NOT_FOUND);
    });
  });

  describe('rename uniqueness', () => {
    it('refuses an exact duplicate and leaves the row unchanged', async () => {
      const response = await patchRoom(room('N3'), { roomNumber: room('N4') });

      assert.equal(response.status, 409);
      assert.deepEqual(response.json, ROOM_NUMBER_TAKEN);

      const stored = await readRoom(room('N3'));
      assert.ok(stored, 'the room kept its old number');
      assert.equal(stored!.is_active, true);
    });

    it('refuses a case-only duplicate', async () => {
      const response = await patchRoom(room('N3'), { roomNumber: room('N4').toLowerCase() });

      assert.equal(response.status, 409);
      assert.deepEqual(response.json, ROOM_NUMBER_TAKEN);
      assert.ok(await readRoom(room('N3')), 'the room kept its old number');
    });
  });
});

describe('physical-room deactivation safety, against real reservations', () => {
  const blocks: [string, string][] = [
    ['G1', 'a future pending stay'],
    ['G2', 'a future confirmed stay'],
    ['G3', 'a stay checked in but not yet checked out'],
  ];

  for (const [prefix, label] of blocks) {
    it(`blocks deactivation with ${label}`, async () => {
      const response = await patchRoom(room(prefix), { isActive: false });

      assert.equal(response.status, 409);
      assert.deepEqual(response.json, ROOM_HAS_FUTURE_RESERVATIONS);
      assert.equal((await readRoom(room(prefix)))!.is_active, true, 'the room remains active');
    });
  }

  const allows: [string, string][] = [
    ['G4', 'a cancelled stay'],
    ['G5', 'a stay that has already checked out'],
  ];

  for (const [prefix, label] of allows) {
    it(`allows deactivation despite ${label}`, async () => {
      const response = await patchRoom(room(prefix), { isActive: false });

      assert.equal(response.status, 200);
      assert.equal(response.json.data.isActive, false);
      assert.equal((await readRoom(room(prefix)))!.is_active, false);
    });
  }

  it('carries no reference, date, guest or count in the refusal', async () => {
    const response = await patchRoom(room('G1'), { isActive: false });

    assert.deepEqual(Object.keys(response.json.error!).sort(), ['code', 'message']);
    assert.doesNotMatch(JSON.stringify(response.json), /\d|TPH-|Amelia|Hartwell|@example/);
  });

  it('applies neither half of a rename + deactivate when the deactivation is blocked', async () => {
    const from = room('G2');
    const to = `Bd-${runId}`;

    const response = await patchRoom(from, { roomNumber: to, isActive: false });

    assert.equal(response.status, 409);
    assert.deepEqual(response.json, ROOM_HAS_FUTURE_RESERVATIONS);

    const stored = await readRoom(from);
    assert.ok(stored, 'the room kept its old number');
    assert.equal(stored!.is_active, true, 'and is still active');
    assert.equal(await readRoom(to), undefined, 'the new number was never written');
  });
});

describe('combined-update atomicity on a database conflict', () => {
  it('rolls back the whole transaction when the rename half collides by case only', async () => {
    // No reservation blocker on this room, so the deactivation would have been
    // allowed on its own. The rename is what fails, inside the same statement.
    const from = room('G6');
    const collision = room('G7').toLowerCase();

    assert.equal((await readRoom(from))!.is_active, true, 'the room starts active');
    assert.notEqual(collision, room('G7'), 'the collision must differ only by case');

    const response = await patchRoom(from, { roomNumber: collision, isActive: false });

    assert.equal(response.status, 409);
    assert.deepEqual(response.json, ROOM_NUMBER_TAKEN);

    const stored = await readRoom(from);
    assert.ok(stored, 'room A kept its old room number');
    assert.equal(stored!.room_number, from);
    assert.equal(stored!.is_active, true, 'room A is still active — the deactivation rolled back too');
  });
});

describe('authentication wins over every other judgement', () => {
  const cases: [string, string, RequestInit][] = [
    ['POST', '/api/v1/admin/room-types', json('POST', { slug: 'x', name: 'X', capacity: 2, baseNightlyRate: '1.00' })],
    ['PATCH', capacityPath('NOT-CANONICAL'), json('PATCH', { capacity: 0 })],
    ['GET', roomsPath(`${slugPrefix}-missing`), {}],
    ['POST', roomsPath('NOT-CANONICAL'), json('POST', { nope: true })],
    ['PATCH', roomPath(` ${room('N4')} `), json('PATCH', {})],
  ];

  for (const [method, path, init] of cases) {
    it(`${method} ${path} answers 401 with no session`, async () => {
      const response = await withoutCookie(path, init);

      assert.equal(response.status, 401);
      assert.deepEqual(response.json, NOT_AUTHENTICATED);
    });
  }

  it('answers identically whether the target exists or not', async () => {
    const existing = await withoutCookie(roomsPath(slugs.listing));
    const missing = await withoutCookie(roomsPath(`${slugPrefix}-missing`));

    assert.deepEqual(existing, missing);
  });
});
