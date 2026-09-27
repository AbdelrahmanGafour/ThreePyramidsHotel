import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, it, mock } from 'node:test';
import { runner } from 'node-pg-migrate';
import type { PackageCard, PackageDetail } from '../src/modules/packages/packages.types';

// Uses the dedicated migrated disposable cluster, never hotel development.
const target = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(process.env.PACKAGES_DISPOSABLE_TEST, '1');
assert.equal(target.hostname, '127.0.0.1');
assert.ok(target.port === '5434' || target.port === '55432');
assert.equal(target.pathname, '/hotel_reservation_packages_test');
assert.equal(target.search, '');
let pool: typeof import('../src/db/pool');
let server: Server | undefined;
let baseUrl: string;
let emptyCatalogue: unknown;
const prefix = `catalogue-${randomUUID()}`;
const slugs = ['standard', 'confirm', 'empty', 'inactive', 'free'].map(key => `${prefix}-${key}`);
const [standard, confirm, empty, inactive, free] = slugs;
const ids: string[] = [];
let hotelBefore: unknown;
let schemaReady = false;

async function hotelRows() {
  const result: Record<string, unknown> = {};
  for (const table of ['room_types', 'rooms', 'reservations']) {
    result[table] = (await pool.dbPool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    result[`${table}_sequence`] = (await pool.dbPool.query(`SELECT last_value, is_called FROM ${table}_id_seq`)).rows;
  }
  return result;
}

before(async () => {
  pool = await import('../src/db/pool.js');
  const version = (await pool.dbPool.query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version;
  assert.ok((version >= 160000 && version < 170000) || (version >= 180000 && version < 190000), 'PostgreSQL 16 or 18 required');
  // Do not depend on test-file execution order. UP is a no-op when the schema
  // lifecycle suite has already run against this disposable database.
  await runner({ databaseUrl: process.env.DATABASE_URL!, direction: 'up', migrationsTable: 'pgmigrations',
    dir: path.resolve(__dirname, '../src/db/migrations'), log: () => undefined });
  schemaReady = true;
  assert.equal((await pool.dbPool.query('SELECT count(*)::int AS n FROM packages')).rows[0].n, 0);
  hotelBefore = await hotelRows();
  const { createApp } = await import('../src/app.js');
  server = await new Promise<Server>(resolve => {
    const listening = createApp().listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/packages`;
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  emptyCatalogue = await response.json();

  const client = await pool.dbPool.connect();
  try {
    await client.query('BEGIN');
    for (const [index, slug] of slugs.entries()) {
      const inserted = await client.query(`INSERT INTO packages(code,slug,title,summary,description,
        duration_label,schedule_label,operating_days,is_active,requires_price_confirmation,sort_order)
        VALUES ($1,$1,$2,NULL,$3,NULL,NULL,$4,$5,$6,$7) RETURNING id`,
      [slug, `Synthetic ${index}`, index === 0 ? 'Description' : null,
        index === 0 ? ['monday', 'friday'] : null, index !== 3, index === 1, [20, 10, 30, 0, 20][index]]);
      ids.push(inserted.rows[0].id);
    }
    // Insertion order intentionally differs from public variant order.
    const double = (await client.query(`INSERT INTO package_variants(package_id,key,label,is_default,sort_order)
      VALUES ($1,'double','Double Cabin',false,2) RETURNING id`, [ids[0]])).rows[0].id;
    const single = (await client.query(`INSERT INTO package_variants(package_id,key,label,is_default,sort_order,
      child_min_age,child_max_age,child_discount_percent) VALUES ($1,'single','Single Cabin',true,1,6,12,50.00) RETURNING id`, [ids[0]])).rows[0].id;
    await client.query(`INSERT INTO package_rate_tiers(variant_id,min_party_size,max_party_size,adult_unit_rate)
      VALUES ($1,3,NULL,'80.00'),($1,1,1,'9999999999.99'),($1,2,2,'90.00'),($2,2,NULL,'9.25')`, [single, double]);
    for (const index of [1, 2, 3, 4]) {
      const v = (await client.query(`INSERT INTO package_variants(package_id,key,label,is_default,sort_order)
        VALUES ($1,'standard','Standard',true,0) RETURNING id`, [ids[index]])).rows[0].id;
      if (index !== 2) await client.query(`INSERT INTO package_rate_tiers(variant_id,min_party_size,adult_unit_rate)
        VALUES ($1,1,$2)`, [v, index === 4 ? '0.00' : '100.00']);
    }
    await client.query(`INSERT INTO package_itinerary_sections(package_id,day_number,heading,body,sort_order)
      VALUES ($1,2,'Second','Second body',2),($1,NULL,NULL,'Unnumbered introduction',0),($1,1,'First','First body',1)`, [ids[0]]);
    await client.query(`INSERT INTO package_content_items(package_id,kind,text,sort_order)
      VALUES ($1,'note','Second note',2),($1,'included','Included',1),($1,'excluded','Excluded',1),($1,'note','First note',1)`, [ids[0]]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});

after(async () => {
  try {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (pool && schemaReady) {
      await pool.dbPool.query('DELETE FROM packages WHERE slug=ANY($1::text[])', [slugs]);
      for (const table of ['packages','package_variants','package_rate_tiers','package_content_items','package_itinerary_sections','package_reservations']) {
        assert.equal((await pool.dbPool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, `${table} residue`);
      }
      if (hotelBefore) assert.deepEqual(await hotelRows(), hotelBefore);
    }
  } finally { if (pool) await pool.closeDatabasePool(); }
});

async function list(): Promise<PackageCard[]> {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  return (await response.json()).data;
}
async function detail(slug: string): Promise<PackageDetail> {
  const response = await fetch(`${baseUrl}/${slug}`);
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

it('returns an empty successful catalogue when no active products exist', () => {
  assert.deepEqual(emptyCatalogue, { data: [] });
});
it('lists active products in deterministic sort_order/id order', async () => {
  const first = await list();
  assert.deepEqual(first.map(item => item.slug), [confirm, standard, free, empty]);
  assert.deepEqual(await list(), first);
});
it('returns only card-safe fields and qualified numeric from pricing', async () => {
  const card = (await list()).find(item => item.slug === standard)!;
  // Exact, not a subset: this is what keeps an internal media field — a
  // reference, a storage key, an asset id, a checksum, a content type, a
  // byte size or a bucket — from reaching a guest by simply appearing.
  // `image` is the public four-field object or null, and nothing else here
  // gained a key.
  assert.deepEqual(Object.keys(card).sort(), ['code','slug','title','summary','durationLabel','scheduleLabel',
    'operatingDays','currency','requiresPriceConfirmation','pricing','image'].sort());
  assert.deepEqual(card.pricing, { status: 'from', unit: 'per_person',
    from: { adultUnitRate: '9.25', variantKey: 'double', minPartySize: 2, maxPartySize: null } });
  assert.equal(card.currency, 'USD');
});
it('marks confirmation-required prices honestly while retaining detail source rates', async () => {
  const product = await detail(confirm);
  assert.equal(product.requiresPriceConfirmation, true);
  assert.deepEqual(product.pricing, { status: 'requires_confirmation', unit: 'per_person',
    from: { adultUnitRate: '100.00', variantKey: 'standard', minPartySize: 1, maxPartySize: null } });
  assert.equal(product.variants[0].rates[0].adultUnitRate, '100.00');
});
it('preserves zero prices and does not manufacture rates for unpriced variants', async () => {
  assert.equal((await detail(free)).pricing.from?.adultUnitRate, '0.00');
  const product = await detail(empty);
  assert.deepEqual(product.pricing, { status: 'unavailable', unit: 'per_person', from: null });
  assert.deepEqual(product.variants[0].rates, []);
  assert.deepEqual(product.itinerary, []);
  assert.deepEqual(product.included, []);
  assert.equal(product.description, null);
});
it('returns ordered source content, nullable sections, variants and exact decimal rates', async () => {
  const product = await detail(standard);
  assert.equal(product.description, 'Description');
  assert.deepEqual(product.itinerary.map(section => section.dayNumber), [null, 1, 2]);
  assert.deepEqual(product.notes, ['First note', 'Second note']);
  assert.deepEqual(product.included, ['Included']);
  assert.deepEqual(product.excluded, ['Excluded']);
  assert.deepEqual(product.variants.map(v => v.key), ['single','double']);
  assert.deepEqual(product.variants[0].rates.map(r => r.minPartySize), [1,2,3]);
  assert.equal(product.variants[0].rates[0].adultUnitRate, '9999999999.99');
  assert.equal(product.variants[0].childDiscountPercent, '50.00');
  assert.equal(product.variants[1].childDiscountPercent, null);
  assert.deepEqual(product.operatingDays, ['monday', 'friday']);
});
it('never returns internal IDs, timestamps or administrative flags at any depth', async () => {
  function inspect(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!/^(id|.*_id|packageId|variantId|createdAt|updatedAt|sortOrder|isActive)$/.test(key), key);
      inspect(child);
    }
  }
  inspect(await list());
  inspect(await detail(standard));
});
it('makes inactive and nonexistent slugs indistinguishable', async () => {
  for (const slug of [inactive, 'not-a-real-package']) {
    const response = await fetch(`${baseUrl}/${slug}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' } });
  }
});
for (const slug of ['Bad-Slug', 'bad--slug', 'bad%20slug', 'bad%0A', 'a'.repeat(121), '%27%20OR%201%3D1', '%252F', '%E0%A4%A']) {
  it(`rejects invalid HTTP slug ${slug.slice(0, 25)}`, async () => {
    const response = await fetch(`${baseUrl}/${slug}`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_PACKAGE_SLUG');
  });
}
it('does not allow query parameters to reveal inactive products or choose arbitrary SQL ordering', async () => {
  const response = await fetch(`${baseUrl}?is_active=false&sort=title&limit=1`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, await list());
});
it('keeps catalogue endpoints read-only', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    assert.equal((await fetch(`${baseUrl}/${standard}`, { method })).status, 404);
  }
});
it('returns a sanitized server error on database failure, never an empty list or 404', async () => {
  const query = mock.method(pool.dbPool, 'query', async () => { throw new Error('secret database details'); });
  try {
    for (const url of [baseUrl, `${baseUrl}/${standard}`]) {
      const response = await fetch(url);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: { code: 'PACKAGES_UNAVAILABLE', message: 'Package catalogue unavailable' } });
    }
  } finally { query.mock.restore(); }
});
it('fails closed on malformed database rows rather than coercing a price', async () => {
  const query = mock.method(pool.dbPool, 'query', async () => ({ rows: [{ title: 'Incomplete' }] }));
  try {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.code, 'PACKAGES_UNAVAILABLE');
  } finally { query.mock.restore(); }
});
