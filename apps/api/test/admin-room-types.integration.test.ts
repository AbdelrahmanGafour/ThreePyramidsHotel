import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { insertedId, toNumbers } from './support/core-sql';
import { generateBookingReference } from '../src/modules/reservations/booking-reference';

// Exercises the admin room-type endpoints over real HTTP against a real
// MySQL database: the real app, the real session guard, the real
// repository SQL. Nothing is mocked.
//
// It creates its own admin account, room types, physical rooms and one
// reservation with identifiers unique to this run, and removes exactly those
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

const admin = {
  email: `itest-rt-${runId}@example.com`,
  displayName: `Room Types Admin ${runId}`,
  password: `fixture-password-${runId}`,
};

/**
 * Four room types, each answering one question:
 *   priced    the ordinary case, and the one the reservation is booked against
 *   nulls     every nullable column empty
 *   empty     a room type with no physical rooms at all
 *   archived  is_active = false, which the public catalogue hides
 */
const slugs = {
  priced: `itest-rt-${runId}-priced`,
  nulls: `itest-rt-${runId}-nulls`,
  empty: `itest-rt-${runId}-empty`,
  archived: `itest-rt-${runId}-archived`,
} as const;

const roomTypeIds: Record<string, string> = {};

type JsonResponse = {
  status: number;
  json: {
    data?: any;
    error?: { code: string; message: string };
  };
};

const NOT_AUTHENTICATED = { error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' } };
const INVALID_SLUG = { error: { code: 'INVALID_ROOM_TYPE_SLUG', message: 'Invalid room type slug' } };
const INVALID_UPDATE = { error: { code: 'INVALID_ROOM_TYPE_UPDATE', message: 'Invalid room type update' } };
const NOT_FOUND = { error: { code: 'ROOM_TYPE_NOT_FOUND', message: 'Room type not found' } };

async function request(
  path: string,
  init: RequestInit,
  headers: Record<string, string>,
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...init.headers, ...headers } });

  return { status: response.status, json: await response.json() };
}

// Three helpers rather than one with an optional cookie: an omitted argument is
// indistinguishable from an explicit `undefined`, so a default would silently
// turn "send no cookie" into "send the valid session".

/** Sends this suite's real signed-in session. */
const asAdmin = (path: string, init: RequestInit = {}) =>
  request(path, init, { Cookie: sessionCookie });
/** Sends exactly the given Cookie header, whatever it is. */
const withCookie = (path: string, cookie: string, init: RequestInit = {}) =>
  request(path, init, { Cookie: cookie });
/** Sends no Cookie header at all — the anonymous case. */
const withoutCookie = (path: string, init: RequestInit = {}) => request(path, init, {});

const patchAsAdmin = (slug: string, body: unknown) =>
  asAdmin(`/api/v1/admin/room-types/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const detailAsAdmin = (slug: string) => asAdmin(`/api/v1/admin/room-types/${encodeURIComponent(slug)}`);

async function insertRoomType(input: {
  slug: string;
  name: string;
  capacity: number;
  baseNightlyRate: string;
  sortOrder: number;
  isActive?: boolean;
  nullable?: boolean;
}): Promise<string> {
  const inserted = await dbPool.query(
    `INSERT INTO room_types (
       slug, name, short_description, description, capacity,
       bed_type, bed_count, size_sqm, view, base_nightly_rate, is_active, sort_order
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      input.slug,
      input.name,
      input.nullable ? null : 'A short description.',
      input.nullable ? null : 'A longer description.',
      input.capacity,
      input.nullable ? null : 'King bed',
      input.nullable ? null : 1,
      input.nullable ? null : '42.00',
      input.nullable ? null : 'Courtyard view',
      input.baseNightlyRate,
      input.isActive ?? true,
      input.sortOrder,
    ],
  );

  const id = insertedId(inserted);
  roomTypeIds[input.slug] = id;

  return id;
}

async function insertRoom(roomTypeId: string, roomNumber: string, isActive = true): Promise<string> {
  const inserted = await dbPool.query(
    `INSERT INTO rooms (room_type_id, room_number, is_active) VALUES ($1, $2, $3)`,
    [roomTypeId, roomNumber, isActive],
  );

  return insertedId(inserted);
}

async function readRoomType(slug: string) {
  const { rows } = await dbPool.query<{
    name: string;
    base_nightly_rate: string;
    capacity: number;
    is_active: boolean;
    slug: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT slug, name, base_nightly_rate AS base_nightly_rate, capacity, is_active, created_at, updated_at
       FROM room_types WHERE slug = $1`,
    [slug],
  );

  const row = rows[0];
  assert.ok(row, `fixture room type ${slug} is missing`);

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
    `INSERT INTO admin_users (email, display_name, password_hash, is_active) VALUES ($1, $2, $3, true)`,
    [admin.email, admin.displayName, await hashPassword(admin.password)],
  );

  const pricedId = await insertRoomType({
    slug: slugs.priced,
    name: `Priced ${runId}`,
    capacity: 2,
    baseNightlyRate: '1500.00',
    sortOrder: 1,
  });
  await insertRoomType({
    slug: slugs.nulls,
    name: `Nulls ${runId}`,
    capacity: 3,
    baseNightlyRate: '999.99',
    sortOrder: 2,
    nullable: true,
  });
  await insertRoomType({
    slug: slugs.empty,
    name: `Empty ${runId}`,
    capacity: 2,
    baseNightlyRate: '100.00',
    sortOrder: 3,
  });
  const archivedId = await insertRoomType({
    slug: slugs.archived,
    name: `Archived ${runId}`,
    capacity: 2,
    baseNightlyRate: '250.00',
    sortOrder: 4,
    isActive: false,
  });

  // One active and one INACTIVE room: roomCount is a physical-inventory fact,
  // so both must be counted.
  const pricedRoom = await insertRoom(pricedId, `IT-RT-${runId}-1`, true);
  await insertRoom(pricedId, `IT-RT-${runId}-2`, false);
  await insertRoom(roomTypeIds[slugs.nulls]!, `IT-RT-${runId}-3`, true);
  await insertRoom(archivedId, `IT-RT-${runId}-4`, true);
  // `empty` deliberately gets no rooms at all.

  // A real reservation against the priced type, so the historical-pricing
  // proof below has genuine snapshot values to compare.
  await dbPool.query(
    `INSERT INTO reservations (
       booking_reference, room_type_id, room_id,
       guest_first_name, guest_last_name, guest_email, guest_phone, guest_country,
       adults, children, check_in, check_out,
       status, currency, nightly_rate_snapshot, total_amount, special_requests
     )
     VALUES ($1, $2, $3, 'Amelia', 'Hartwell', $4, '+201000000000', 'Egypt',
             2, 0, '2099-06-01', '2099-06-03', 'pending', 'EGP', $5, $6, NULL)`,
    [generateBookingReference(), pricedId, pricedRoom, `guest-${runId}@example.com`, '1500.00', '3000.00'],
  );

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
    const ids = Object.values(roomTypeIds);

    await dbPool.query('DELETE FROM reservations WHERE room_type_id IN ($1)', [ids]);
    await dbPool.query('DELETE FROM rooms WHERE room_type_id IN ($1)', [ids]);
    await dbPool.query('DELETE FROM room_types WHERE id IN ($1)', [ids]);
    await dbPool.query(
      `DELETE FROM admin_sessions WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = $1)`,
      [admin.email],
    );
    await dbPool.query('DELETE FROM admin_users WHERE email = $1', [admin.email]);

    const { rows } = await dbPool.query<{ reservations: number; rooms: number; types: number; admins: number }>(
      `SELECT (SELECT COUNT(*) FROM reservations WHERE room_type_id IN ($1)) AS reservations,
              (SELECT COUNT(*) FROM rooms WHERE room_type_id IN ($1)) AS rooms,
              (SELECT COUNT(*) FROM room_types WHERE id IN ($1)) AS types,
              (SELECT COUNT(*) FROM admin_users WHERE email = $2) AS admins`,
      [ids, admin.email],
    );

    assert.deepEqual(
      rows[0] && toNumbers(rows[0]),
      { reservations: 0, rooms: 0, types: 0, admins: 0 },
      'fixtures were not fully removed',
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDatabasePool();
  }
});

describe('GET /api/v1/admin/room-types', () => {
  it('returns every room type, including inactive ones', async () => {
    const response = await asAdmin('/api/v1/admin/room-types');

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.json), ['data']);
    assert.deepEqual(Object.keys(response.json.data), ['roomTypes']);

    const bySlug = new Map<string, any>(response.json.data.roomTypes.map((r: any) => [r.slug, r]));
    for (const slug of Object.values(slugs)) {
      assert.ok(bySlug.has(slug), `${slug} must appear in the admin list`);
    }
    assert.equal(bySlug.get(slugs.archived).isActive, false, 'an archived type must still be listed');
  });

  it('returns exactly the list contract per row', async () => {
    const response = await asAdmin('/api/v1/admin/room-types');
    const row = response.json.data.roomTypes.find((r: any) => r.slug === slugs.priced);

    assert.deepEqual(row, {
      slug: slugs.priced,
      name: `Priced ${runId}`,
      capacity: 2,
      baseNightlyRate: '1500.00',
      currency: 'EGP',
      isActive: true,
      sortOrder: 1,
      // One active room plus one inactive room: inventory, not availability.
      roomCount: 2,
      updatedAt: row.updatedAt,
    });
    assert.match(row.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('counts inactive physical rooms, and reports zero for a type with none', async () => {
    const rows = (await asAdmin('/api/v1/admin/room-types')).json.data.roomTypes;
    const bySlug = new Map<string, any>(rows.map((r: any) => [r.slug, r]));

    assert.equal(bySlug.get(slugs.priced).roomCount, 2, 'an inactive room still counts as inventory');
    assert.equal(bySlug.get(slugs.empty).roomCount, 0, 'a type with no rooms must still appear');
  });

  it('orders by sortOrder, then name, then slug', async () => {
    const rows = (await asAdmin('/api/v1/admin/room-types')).json.data.roomTypes;
    const keys = rows.map((r: any) => [r.sortOrder, r.name, r.slug]);
    const sorted = [...keys].sort(
      (a: any, b: any) => a[0] - b[0] || String(a[1]).localeCompare(b[1]) || String(a[2]).localeCompare(b[2]),
    );

    assert.deepEqual(keys, sorted, 'the list must already be in the contract order');
  });

  it('exposes no internal identifier', async () => {
    const rows = (await asAdmin('/api/v1/admin/room-types')).json.data.roomTypes;

    for (const row of rows) {
      for (const field of ['id', 'roomTypeId', 'roomId', 'createdAt']) {
        assert.ok(!(field in row), `${field} must not appear in a list row`);
      }
    }
  });
});

describe('GET /api/v1/admin/room-types/:slug', () => {
  it('returns exactly the detail contract', async () => {
    const response = await detailAsAdmin(slugs.priced);

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.json), ['data']);

    const detail = response.json.data;
    assert.deepEqual(Object.keys(detail).sort(), [
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
    assert.equal(detail.slug, slugs.priced);
    assert.equal(detail.baseNightlyRate, '1500.00');
    assert.equal(detail.sizeSqm, '42.00');
    assert.equal(detail.currency, 'EGP');
    assert.equal(detail.roomCount, 2);
    assert.match(detail.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('round-trips every nullable column as null', async () => {
    const detail = (await detailAsAdmin(slugs.nulls)).json.data;

    assert.equal(detail.shortDescription, null);
    assert.equal(detail.description, null);
    assert.equal(detail.bedType, null);
    assert.equal(detail.bedCount, null);
    assert.equal(detail.sizeSqm, null);
    assert.equal(detail.view, null);
    assert.equal(detail.baseNightlyRate, '999.99');
  });

  it('shows an archived room type, which the public catalogue hides', async () => {
    const response = await detailAsAdmin(slugs.archived);

    assert.equal(response.status, 200);
    assert.equal(response.json.data.isActive, false);

    const publicResponse = await fetch(`${baseUrl}/api/v1/rooms/${slugs.archived}`);
    assert.equal(publicResponse.status, 404, 'the public endpoint must still hide it');
  });

  it('rejects a malformed slug with 400', async () => {
    for (const slug of [
      slugs.priced.toUpperCase(),
      ` ${slugs.priced}`,
      `${slugs.priced} `,
      'Not-A-Slug',
      'under_score',
      'double--hyphen',
      '-leading',
      'trailing-',
      'dot.slug',
    ]) {
      const response = await detailAsAdmin(slug);

      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(slug)}`);
      assert.deepEqual(response.json, INVALID_SLUG);
    }
  });

  it('returns 404 for a canonical slug with no row', async () => {
    const response = await detailAsAdmin(`itest-rt-${runId}-missing`);

    assert.equal(response.status, 404);
    assert.deepEqual(response.json, NOT_FOUND);
  });

  it('keeps malformed and unknown apart', async () => {
    assert.equal((await detailAsAdmin('NOT-CANONICAL')).status, 400);
    assert.equal((await detailAsAdmin(`itest-rt-${runId}-nobody`)).status, 404);
  });
});

describe('PATCH /api/v1/admin/room-types/:slug', () => {
  it('updates each editable field on its own', async () => {
    const cases: [string, unknown, (d: any) => unknown][] = [
      ['name', `Renamed ${runId}`, (d) => d.name],
      ['shortDescription', 'Updated short.', (d) => d.shortDescription],
      ['description', 'Updated long.', (d) => d.description],
      ['bedType', 'Twin beds', (d) => d.bedType],
      ['bedCount', 2, (d) => d.bedCount],
      ['sizeSqm', '38.25', (d) => d.sizeSqm],
      ['view', 'Garden view', (d) => d.view],
      ['baseNightlyRate', '1750.50', (d) => d.baseNightlyRate],
      ['sortOrder', 7, (d) => d.sortOrder],
    ];

    for (const [field, value, read] of cases) {
      const response = await patchAsAdmin(slugs.nulls, { [field]: value });

      assert.equal(response.status, 200, `expected 200 updating ${field}`);
      assert.equal(read(response.json.data), value, `${field} should have been updated`);
    }
  });

  it('updates several fields at once and returns the row after the update', async () => {
    const response = await patchAsAdmin(slugs.nulls, {
      name: `Multi ${runId}`,
      baseNightlyRate: '2000.00',
      sortOrder: 9,
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.data.name, `Multi ${runId}`);
    assert.equal(response.json.data.baseNightlyRate, '2000.00');
    assert.equal(response.json.data.sortOrder, 9);

    const stored = await readRoomType(slugs.nulls);
    assert.equal(stored.name, `Multi ${runId}`);
    assert.equal(stored.base_nightly_rate, '2000.00');
  });

  it('leaves omitted fields unchanged', async () => {
    const before = (await detailAsAdmin(slugs.nulls)).json.data;

    const response = await patchAsAdmin(slugs.nulls, { sortOrder: 4 });
    const after = response.json.data;

    assert.equal(after.sortOrder, 4);
    assert.equal(after.name, before.name, 'name must not change');
    assert.equal(after.baseNightlyRate, before.baseNightlyRate, 'rate must not change');
    assert.equal(after.description, before.description);
  });

  it('clears a nullable field with an explicit null', async () => {
    await patchAsAdmin(slugs.nulls, { view: 'Temporary view', bedType: 'Temporary bed' });

    const response = await patchAsAdmin(slugs.nulls, { view: null, bedType: null });

    assert.equal(response.status, 200);
    assert.equal(response.json.data.view, null);
    assert.equal(response.json.data.bedType, null);
  });

  it('normalises an empty string to null, per the locked contract', async () => {
    const response = await patchAsAdmin(slugs.nulls, { description: '   ' });

    assert.equal(response.status, 200);
    assert.equal(response.json.data.description, null);
  });

  it('moves updatedAt forward and leaves slug, capacity, isActive and createdAt alone', async () => {
    const before = await readRoomType(slugs.empty);

    const response = await patchAsAdmin(slugs.empty, { name: `Touched ${runId}` });
    assert.equal(response.status, 200);

    const after = await readRoomType(slugs.empty);
    assert.ok(after.updated_at.getTime() >= before.updated_at.getTime(), 'updated_at must move forward');
    assert.equal(after.created_at.getTime(), before.created_at.getTime(), 'created_at must not move');
    assert.equal(after.slug, before.slug, 'slug must be immutable');
    assert.equal(after.capacity, before.capacity, 'capacity must be immutable in T01');
    assert.equal(after.is_active, before.is_active, 'isActive must be immutable in T01');
  });

  it('returns 404 for a canonical slug with no row', async () => {
    const response = await patchAsAdmin(`itest-rt-${runId}-missing`, { name: 'Nobody' });

    assert.equal(response.status, 404);
    assert.deepEqual(response.json, NOT_FOUND);
  });

  it('rejects a malformed slug before looking at the body', async () => {
    const response = await patchAsAdmin('NOT-CANONICAL', { capacity: 99 });

    assert.equal(response.status, 400);
    assert.deepEqual(response.json, INVALID_SLUG, 'the slug wins when both are malformed');
  });
});

// Two layers refuse a bad body, and which one answers depends on whether the
// JSON parser accepts the value at all.
//
// `express.json()` runs app-wide before routing in strict mode, so a top-level
// JSON primitive — a bare string, a number, `null`, a boolean — never reaches a
// route and comes back as the global INVALID_JSON. Objects and arrays do parse,
// so they reach this endpoint's own validator and come back as
// INVALID_ROOM_TYPE_UPDATE.
//
// The validator refuses primitives too; that is proven directly in
// admin-room-types.validation.test.ts, where it is called without a parser in
// front of it. Over HTTP it simply never gets the chance.
describe('PATCH rejects an invalid update at the route', () => {
  const invalid: [string, unknown][] = [
    ['an empty object', {}],
    // An array is valid top-level JSON, so this one does reach the validator.
    ['an array body', ['name']],
    ['slug', { slug: 'new-slug' }],
    ['id', { id: 7 }],
    ['capacity', { capacity: 4 }],
    ['isActive', { isActive: false }],
    ['currency', { currency: 'USD' }],
    ['createdAt', { createdAt: '2026-01-01T00:00:00.000Z' }],
    ['updatedAt', { updatedAt: '2026-01-01T00:00:00.000Z' }],
    ['roomCount', { roomCount: 5 }],
    ['an unknown key', { nickname: 'x' }],
    ['a valid field with an unknown key', { name: 'Valid', nickname: 'x' }],
    ['a numeric rate', { baseNightlyRate: 1500 }],
    ['a rate with three decimals', { baseNightlyRate: '1500.555' }],
    ['a negative rate', { baseNightlyRate: '-1' }],
    ['an exponent rate', { baseNightlyRate: '1e3' }],
    ['a padded rate', { baseNightlyRate: ' 1500.00' }],
    ['a zero size', { sizeSqm: '0.00' }],
    ['an oversized size', { sizeSqm: '10000' }],
    ['a zero bedCount', { bedCount: 0 }],
    ['a fractional bedCount', { bedCount: 1.5 }],
    ['a negative sortOrder', { sortOrder: -1 }],
    ['a fractional sortOrder', { sortOrder: 1.5 }],
    ['an empty name', { name: '   ' }],
  ];

  for (const [label, body] of invalid) {
    it(`with 400 for ${label}`, async () => {
      const before = await readRoomType(slugs.priced);

      const response = await patchAsAdmin(slugs.priced, body);

      assert.equal(response.status, 400, `expected 400 for ${label}`);
      assert.deepEqual(response.json, INVALID_UPDATE);

      const after = await readRoomType(slugs.priced);
      assert.equal(after.name, before.name, 'a rejected update must change nothing');
      assert.equal(after.base_nightly_rate, before.base_nightly_rate);
      assert.equal(after.updated_at.getTime(), before.updated_at.getTime());
    });
  }

});

describe('PATCH rejects an unparseable body at the JSON parser', () => {
  const INVALID_JSON = { error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' } };

  const unparseable: [string, string][] = [
    ['truncated JSON', '{"name":'],
    // Strict-mode express.json() accepts only an object or an array at the top
    // level, so these are refused before routing — the endpoint's validator is
    // never reached, and the answer is the parser's, not this route's.
    ['a bare JSON string', '"name"'],
    ['a JSON number', '42'],
    ['a JSON null', 'null'],
    ['a JSON boolean', 'true'],
  ];

  for (const [label, rawBody] of unparseable) {
    it(`with the global contract for ${label}`, async () => {
      const before = await readRoomType(slugs.priced);

      const response = await asAdmin(`/api/v1/admin/room-types/${slugs.priced}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
      });

      assert.equal(response.status, 400, `expected 400 for ${label}`);
      assert.deepEqual(response.json, INVALID_JSON);

      const after = await readRoomType(slugs.priced);
      assert.equal(after.name, before.name, 'nothing may have changed');
      assert.equal(after.updated_at.getTime(), before.updated_at.getTime());
    });
  }
});

describe('authentication', () => {
  it('refuses every room-type endpoint with no session cookie', async () => {
    const responses = [
      await withoutCookie('/api/v1/admin/room-types'),
      await withoutCookie(`/api/v1/admin/room-types/${slugs.priced}`),
      await withoutCookie(`/api/v1/admin/room-types/${slugs.priced}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Nope' }),
      }),
    ];

    for (const response of responses) {
      assert.equal(response.status, 401);
      assert.deepEqual(response.json, NOT_AUTHENTICATED);
    }
  });

  it('refuses an unrelated or malformed cookie identically', async () => {
    for (const cookie of ['theme=dark', 'tph_admin_session=', 'tph_admin_session=not-a-token']) {
      const response = await withCookie('/api/v1/admin/room-types', cookie);

      assert.equal(response.status, 401, `expected 401 for ${cookie.split('=')[0]}`);
      assert.deepEqual(response.json, NOT_AUTHENTICATED);
    }
  });

  it('decides authentication before the slug, the body or existence', async () => {
    // A malformed slug, an unknown room type and an invalid body must all look
    // identical to an anonymous caller.
    const cases = [
      await withoutCookie('/api/v1/admin/room-types/NOT-CANONICAL'),
      await withoutCookie(`/api/v1/admin/room-types/itest-rt-${runId}-missing`),
      await withoutCookie(`/api/v1/admin/room-types/${slugs.priced}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capacity: 99 }),
      }),
    ];

    for (const response of cases) {
      assert.equal(response.status, 401);
      assert.deepEqual(response.json, NOT_AUTHENTICATED);
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

    assert.equal((await withCookie('/api/v1/admin/room-types', cookie)).status, 200);

    await fetch(`${baseUrl}/api/v1/admin/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });

    const response = await withCookie('/api/v1/admin/room-types', cookie);
    assert.equal(response.status, 401);
    assert.deepEqual(response.json, NOT_AUTHENTICATED);
  });
});

// The reason this feature needed a contract audit before any code: a room
// type's price is what a stay costs from now on, and a reservation's snapshot
// is what a guest already agreed to. Editing the first must never touch the
// second.
describe('historical pricing safety', () => {
  it('leaves an existing reservation untouched when the room type is repriced', async () => {
    const { rows: before } = await dbPool.query<{
      booking_reference: string;
      nightly_rate_snapshot: string;
      total_amount: string;
    }>(
      `SELECT booking_reference, nightly_rate_snapshot AS nightly_rate_snapshot,
              total_amount AS total_amount
         FROM reservations WHERE room_type_id = $1`,
      [roomTypeIds[slugs.priced]],
    );

    const reservation = before[0];
    assert.ok(reservation, 'the fixture reservation is missing');
    assert.equal(reservation.nightly_rate_snapshot, '1500.00');
    assert.equal(reservation.total_amount, '3000.00');

    const response = await patchAsAdmin(slugs.priced, { baseNightlyRate: '4321.00' });
    assert.equal(response.status, 200);
    assert.equal(response.json.data.baseNightlyRate, '4321.00');

    // The room type really did change.
    assert.equal((await readRoomType(slugs.priced)).base_nightly_rate, '4321.00');

    // The reservation really did not.
    const { rows: after } = await dbPool.query<{
      nightly_rate_snapshot: string;
      total_amount: string;
    }>(
      `SELECT nightly_rate_snapshot AS nightly_rate_snapshot, total_amount AS total_amount
         FROM reservations WHERE booking_reference = $1`,
      [reservation.booking_reference],
    );

    assert.equal(after[0]!.nightly_rate_snapshot, '1500.00', 'the booked rate must survive a reprice');
    assert.equal(after[0]!.total_amount, '3000.00', 'the booked total must survive a reprice');
  });
});

describe('public room contract regression', () => {
  it('reflects an admin edit on the public endpoint, unchanged', async () => {
    const name = `Public ${runId}`;
    const rate = '1234.50';

    const patched = await patchAsAdmin(slugs.priced, { name, baseNightlyRate: rate });
    assert.equal(patched.status, 200);

    const response = await fetch(`${baseUrl}/api/v1/rooms/${slugs.priced}`);
    const body = (await response.json()) as { data: { name: string; baseNightlyRate: string; slug: string } };

    assert.equal(response.status, 200);
    assert.equal(body.data.slug, slugs.priced);
    assert.equal(body.data.name, name, 'the public catalogue must show the edited name');
    assert.equal(body.data.baseNightlyRate, rate, 'the public catalogue must show the edited rate');
  });

  it('still hides physical rooms from the public contract', async () => {
    const response = await fetch(`${baseUrl}/api/v1/rooms/${slugs.priced}`);
    const body = (await response.json()) as { data: Record<string, unknown> };

    for (const field of ['id', 'roomCount', 'isActive', 'sortOrder', 'roomNumber']) {
      assert.ok(!(field in body.data), `${field} must not appear in the public contract`);
    }
  });
});
