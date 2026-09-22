import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, it } from 'node:test';
import { runner } from 'node-pg-migrate';

const target = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(process.env.PACKAGES_DISPOSABLE_TEST, '1');
assert.equal(target.hostname, '127.0.0.1');
assert.ok(target.port === '5434' || target.port === '55432');
assert.equal(target.pathname, '/hotel_reservation_packages_test');
assert.equal(target.search, '');

type Pool = typeof import('../src/db/pool.js');
let pool: Pool;
let server: Server | undefined;
let endpoint: string;
const runId = randomUUID().slice(0, 8);
const slug = `reservation-${runId}`;
const code = `RES-${runId}`;
let packageId: string;
let standardVariantId: string;
let noRateVariantId: string;
let hotelBefore: unknown;
const createdReferences: string[] = [];

async function hotelRows() {
  const result: Record<string, unknown> = {};
  for (const table of ['room_types', 'rooms', 'reservations']) {
    result[table] = (await pool.dbPool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    result[`${table}_sequence`] = (await pool.dbPool.query(`SELECT last_value, is_called FROM ${table}_id_seq`)).rows;
  }
  return result;
}

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    packageSlug: slug,
    tourDate: '2030-01-07', // Monday
    adults: 2,
    children: 1,
    childAges: [10],
    guestFirstName: 'Integration',
    guestLastName: 'Guest',
    guestEmail: 'Integration.Guest@Example.COM',
    guestPhone: '+201000000000',
    guestCountry: 'Egypt',
    specialRequests: '  Quiet pickup  ',
    ...overrides,
  };
}

async function post(body: unknown): Promise<Response> {
  return fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

before(async () => {
  pool = await import('../src/db/pool.js');
  const version = (await pool.dbPool.query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version;
  assert.ok((version >= 160000 && version < 170000) || (version >= 180000 && version < 190000), 'PostgreSQL 16 or 18 required');
  await runner({ databaseUrl: process.env.DATABASE_URL!, direction: 'up', migrationsTable: 'pgmigrations',
    dir: path.resolve(__dirname, '../src/db/migrations'), log: () => undefined });
  assert.equal((await pool.dbPool.query('SELECT count(*)::int AS n FROM packages')).rows[0].n, 0);
  hotelBefore = await hotelRows();

  packageId = (await pool.dbPool.query<{ id: string }>(`INSERT INTO packages(
    code,slug,title,summary,description,duration_label,schedule_label,operating_days,is_active,
    requires_price_confirmation,sort_order) VALUES ($1,$2,'Reservation package','Summary','Description',
    'Approx. 4 hrs','Monday only',ARRAY['monday'],true,false,1) RETURNING id`, [code, slug])).rows[0].id;

  standardVariantId = (await pool.dbPool.query<{ id: string }>(`INSERT INTO package_variants(
    package_id,key,label,is_default,sort_order,child_min_age,child_max_age,child_discount_percent)
    VALUES ($1,'standard','Standard',true,1,6,12,50.00) RETURNING id`, [packageId])).rows[0].id;
  noRateVariantId = (await pool.dbPool.query<{ id: string }>(`INSERT INTO package_variants(
    package_id,key,label,is_default,sort_order) VALUES ($1,'manual','Manual',false,2) RETURNING id`, [packageId])).rows[0].id;
  await pool.dbPool.query(`INSERT INTO package_rate_tiers(variant_id,min_party_size,max_party_size,adult_unit_rate,currency)
    VALUES ($1,1,1,'100.00','EGP'),($1,2,2,'90.00','EGP'),($1,3,NULL,'80.00','EGP')`, [standardVariantId]);

  const { createApp } = await import('../src/app.js');
  server = await new Promise<Server>(resolve => {
    const listening = createApp().listen(0, '127.0.0.1', () => resolve(listening));
  });
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/package-reservations`;
});

after(async () => {
  try {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await pool.dbPool.query('DELETE FROM package_reservations WHERE package_id=$1', [packageId]);
    await pool.dbPool.query('DELETE FROM packages WHERE id=$1', [packageId]);
    for (const table of ['packages','package_variants','package_rate_tiers','package_content_items','package_itinerary_sections','package_reservations']) {
      assert.equal((await pool.dbPool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, `${table} residue`);
    }
    assert.deepEqual(await hotelRows(), hotelBefore);
  } finally {
    await pool.closeDatabasePool();
  }
});

it('creates one pending reservation with authoritative tier and historical snapshots', async () => {
  const response = await post(requestBody());
  assert.equal(response.status, 201);
  const payload = (await response.json()).data;
  assert.equal(payload.status, 'pending');
  assert.equal(payload.package.slug, slug);
  assert.equal(payload.variant.key, 'standard');
  assert.equal(payload.pricingStatus, 'quoted');
  assert.equal(payload.currency, 'EGP');
  assert.equal(payload.adultUnitRate, '80.00'); // party size is adults + children = 3
  assert.equal(payload.childUnitRate, '40.00');
  assert.equal(payload.totalAmount, '200.00');
  assert.ok(/^TPP-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(payload.bookingReference));
  createdReferences.push(payload.bookingReference);

  const stored = (await pool.dbPool.query(`SELECT status,pricing_status,package_code_snapshot,package_title_snapshot,
    variant_label_snapshot,currency,adult_unit_rate_snapshot,child_unit_rate_snapshot,total_amount_snapshot,
    guest_email,special_requests,child_ages FROM package_reservations WHERE booking_reference=$1`,
  [payload.bookingReference])).rows[0];
  assert.deepEqual(stored, {
    status: 'pending', pricing_status: 'quoted', package_code_snapshot: code, package_title_snapshot: 'Reservation package',
    variant_label_snapshot: 'Standard', currency: 'EGP', adult_unit_rate_snapshot: '80.00',
    child_unit_rate_snapshot: '40.00', total_amount_snapshot: '200.00', guest_email: 'integration.guest@example.com',
    special_requests: 'Quiet pickup', child_ages: [10],
  });
});

it('uses the single default variant when variantKey is omitted', async () => {
  const response = await post(requestBody({ adults: 1, children: 0, childAges: undefined }));
  assert.equal(response.status, 201);
  const data = (await response.json()).data;
  assert.equal(data.variant.key, 'standard');
  assert.equal(data.adultUnitRate, '100.00');
  assert.equal(data.totalAmount, '100.00');
  createdReferences.push(data.bookingReference);
});

it('returns requires_confirmation instead of inventing unknown child pricing', async () => {
  const response = await post(requestBody({ childAges: undefined }));
  assert.equal(response.status, 201);
  const data = (await response.json()).data;
  assert.equal(data.pricingStatus, 'requires_confirmation');
  assert.equal(data.adultUnitRate, '80.00');
  assert.equal(data.childUnitRate, null);
  assert.equal(data.totalAmount, null);
  createdReferences.push(data.bookingReference);
});

it('preserves stored snapshots after later catalogue changes', async () => {
  const response = await post(requestBody({ adults: 1, children: 0, childAges: undefined }));
  const data = (await response.json()).data;
  createdReferences.push(data.bookingReference);
  await pool.dbPool.query("UPDATE packages SET title='Changed title' WHERE id=$1", [packageId]);
  await pool.dbPool.query("UPDATE package_rate_tiers SET adult_unit_rate='777.00' WHERE variant_id=$1 AND min_party_size=1", [standardVariantId]);
  const snapshot = (await pool.dbPool.query(`SELECT package_title_snapshot,adult_unit_rate_snapshot,total_amount_snapshot
    FROM package_reservations WHERE booking_reference=$1`, [data.bookingReference])).rows[0];
  assert.deepEqual(snapshot, { package_title_snapshot: 'Reservation package', adult_unit_rate_snapshot: '100.00', total_amount_snapshot: '100.00' });
  await pool.dbPool.query("UPDATE packages SET title='Reservation package' WHERE id=$1", [packageId]);
  await pool.dbPool.query("UPDATE package_rate_tiers SET adult_unit_rate='100.00' WHERE variant_id=$1 AND min_party_size=1", [standardVariantId]);
});

it('rejects dates outside explicit operating days without inserting', async () => {
  const before = (await pool.dbPool.query('SELECT count(*)::int AS n FROM package_reservations')).rows[0].n;
  const response = await post(requestBody({ tourDate: '2030-01-08' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'PACKAGE_OPERATING_DAY_MISMATCH');
  assert.equal((await pool.dbPool.query('SELECT count(*)::int AS n FROM package_reservations')).rows[0].n, before);
});

it('returns narrow 404/409 errors for unknown package, variant and unavailable rate', async () => {
  let response = await post(requestBody({ packageSlug: `missing-${runId}` }));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'PACKAGE_NOT_FOUND');

  response = await post(requestBody({ variantKey: 'missing' }));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'PACKAGE_VARIANT_NOT_FOUND');

  response = await post(requestBody({ variantKey: 'manual' }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'PACKAGE_RATE_UNAVAILABLE');
});

it('rejects browser-controlled pricing/status fields and malformed JSON', async () => {
  let response = await post(requestBody({ currency: 'USD', total: '0.01', status: 'confirmed' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_PACKAGE_RESERVATION');

  response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad-json' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' } });
});

it('rolls back a failed INSERT and returns a sanitized 500', async () => {
  const fn = `reject_package_reservation_${runId}`.replace(/-/g, '_');
  const trigger = `reject_package_reservation_trigger_${runId}`.replace(/-/g, '_');
  await pool.dbPool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private db failure'; END $$`);
  await pool.dbPool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON package_reservations FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  const before = (await pool.dbPool.query('SELECT count(*)::int AS n FROM package_reservations')).rows[0].n;
  try {
    const response = await post(requestBody({ adults: 1, children: 0, childAges: undefined }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: {
      code: 'PACKAGE_RESERVATION_FAILED', message: 'Package reservation could not be created',
    } });
    assert.equal((await pool.dbPool.query('SELECT count(*)::int AS n FROM package_reservations')).rows[0].n, before);
  } finally {
    await pool.dbPool.query(`DROP TRIGGER ${trigger} ON package_reservations`);
    await pool.dbPool.query(`DROP FUNCTION ${fn}()`);
  }
});

it('never changes hotel room/reservation data or sequences', async () => {
  assert.deepEqual(await hotelRows(), hotelBefore);
  assert.ok(noRateVariantId);
  assert.ok(createdReferences.length >= 4);
});
