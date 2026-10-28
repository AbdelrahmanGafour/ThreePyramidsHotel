import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import type { PoolClient } from '../src/db/pool';
import { seedBrochurePackageCatalogue, type BrochurePackageSeed } from '../src/db/seeds/packageCatalogueSeed';

// The package tables' schema, proved against real MySQL.
//
// Every case runs inside a transaction that is rolled back, on one pooled
// connection, so nothing here leaves a row behind. There is no migration
// UP/DOWN/UP lifecycle any more: the schema (src/db/schema) is applied once
// with `npm run migrate:up`, and this suite asserts what it produced.
//
// Rules MySQL cannot express are NOT asserted here because they are not in
// the database any more:
//   * package_rate_tiers_no_overlap (the GiST exclusion constraint) is
//     enforced by the application under the variant lock, and is proved by
//     `admin-packages.rates.integration.test.ts`.
//   * the array-shape CHECKs on operating_days / child_ages are JSON-schema
//     checks now; PostgreSQL-only array corner cases (non-1 lower bounds,
//     NaN numerics) have no MySQL equivalent.

const databaseUrl = process.env.DATABASE_URL ?? '';
assert.ok(databaseUrl, 'DATABASE_URL is required');
const target = new URL(databaseUrl);
assert.equal(process.env.PACKAGES_DISPOSABLE_TEST, '1', 'Explicit disposable-database opt-in required');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '3307');
assert.match(target.pathname, /^\/hotel_[a-z_]*test$/);
assert.equal(target.search, '', 'Connection overrides are not allowed');

type Pool = typeof import('../src/db/pool.js');
let pool: Pool;
let client: PoolClient;
let connected = false;
let packageId: string;
let variantId: string;

const tables = ['packages', 'package_itinerary_sections', 'package_content_items',
  'package_variants', 'package_rate_tiers', 'package_reservations'].sort();

before(async () => {
  pool = await import('../src/db/pool.js');
  client = await pool.dbPool.connect();
  connected = true;
  const server = (await client.query<{ db: string; version: string }>(
    'SELECT DATABASE() AS db, VERSION() AS version',
  )).rows[0]!;
  assert.match(server.db, /^hotel_[a-z_]*test$/);
  assert.match(server.version, /^8\.0\./, 'MySQL 8.0 required');
});

after(async () => {
  if (connected) client.release();
  if (pool) await pool.closeDatabasePool();
});

const count = async (sql: string, values: unknown[] = []): Promise<number> =>
  Number((await client.query<{ n: string }>(sql, values)).rows[0]!.n);

it('installs the indexes, named constraints and package-only foreign keys the code relies on', async t => {
  const indexes = (await client.query<{ table_name: string; index_name: string; non_unique: number }>(
    `SELECT DISTINCT table_name AS table_name, index_name AS index_name, non_unique AS non_unique FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name IN (?)`, [tables],
  )).rows;
  const names = new Set(indexes.map(row => `${row.table_name}.${row.index_name}`));
  for (const required of [
    'packages.packages_code_key', 'packages.packages_slug_key',
    'package_variants.package_variants_package_key_key',
    'package_variants.package_variants_package_sort_key',
    'package_variants.package_variants_id_package_id_key',
    'package_variants.package_variants_one_default_per_package_idx',
    'package_itinerary_sections.package_itinerary_sections_package_sort_key',
    'package_content_items.package_content_items_package_kind_sort_key',
    'package_reservations.package_reservations_booking_reference_key',
  ]) {
    assert.ok(names.has(required), `missing ${required}`);
  }
  for (const unique of ['packages_code_key', 'packages_slug_key', 'package_variants_package_sort_key',
    'package_variants_one_default_per_package_idx', 'package_reservations_booking_reference_key']) {
    assert.ok(indexes.some(row => row.index_name === unique && row.non_unique === 0), `${unique} must be unique`);
  }

  const checks = (await client.query<{ constraint_name: string }>(
    `SELECT constraint_name AS constraint_name FROM information_schema.table_constraints
      WHERE table_schema = DATABASE() AND constraint_type = 'CHECK' AND table_name IN (?)`, [tables],
  )).rows.map(row => row.constraint_name);
  for (const required of ['package_rate_tiers_currency_check', 'package_reservations_currency_check',
    'package_reservations_pricing_total_check', 'package_variants_child_pricing_metadata_check']) {
    assert.ok(checks.includes(required), `missing check ${required}`);
  }

  const fks = (await client.query<{ constraint_name: string; table_name: string; referenced_table_name: string; delete_rule: string }>(
    `SELECT rc.constraint_name AS constraint_name, rc.table_name AS table_name,
            rc.referenced_table_name AS referenced_table_name, rc.delete_rule AS delete_rule
       FROM information_schema.referential_constraints rc
      WHERE rc.constraint_schema = DATABASE() AND rc.table_name IN (?)`, [tables],
  )).rows;
  assert.ok(fks.every(row => tables.includes(row.referenced_table_name)), 'only package tables are referenced');
  const reservationFk = fks.find(row => row.constraint_name === 'package_reservations_variant_package_fkey');
  assert.equal(reservationFk?.delete_rule, 'RESTRICT');
  for (const cascading of ['package_itinerary_sections_package_id_fkey', 'package_content_items_package_id_fkey',
    'package_variants_package_id_fkey', 'package_rate_tiers_variant_id_fkey']) {
    assert.equal(fks.find(row => row.constraint_name === cascading)?.delete_rule, 'CASCADE', cascading);
  }

  const columns = (await client.query<{ column_name: string }>(
    `SELECT column_name AS column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name IN (?)`, [tables],
  )).rows;
  assert.ok(columns.every(row => !/image|photo|media|room_id|room_type_id|pricing_basis|tier_party_basis/.test(row.column_name)));
  t.diagnostic(`${tables.length} tables, ${names.size} indexes, ${checks.length} checks, ${fks.length} package-only FKs`);
});

/** Runs a statement that must be refused, then restores the transaction. */
async function rejectSql(sql: string, values: unknown[], code: string | string[] = '23514', constraint?: string) {
  await client.query('SAVEPOINT expected_rejection');
  try {
    await assert.rejects(client.query(sql, values), error => {
      const failure = error as { code?: string; constraint?: string; sqlMessage?: string };
      const acceptedCodes = Array.isArray(code) ? code : [code];
      assert.ok(acceptedCodes.includes(failure.code ?? ''),
        `Unexpected code ${failure.code} (${failure.sqlMessage}); expected ${acceptedCodes.join(' or ')}`);
      if (constraint) assert.equal(failure.constraint, constraint);
      return true;
    });
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_rejection');
    await client.query('RELEASE SAVEPOINT expected_rejection');
  }
}

/** Runs a statement that must be refused for a reason with no pg-style code (value/range errors). */
async function rejectAny(sql: string, values: unknown[] = []) {
  await client.query('SAVEPOINT expected_rejection');
  try {
    await assert.rejects(client.query(sql, values));
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_rejection');
    await client.query('RELEASE SAVEPOINT expected_rejection');
  }
}

async function reservation(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    booking_reference: 'TPP-23456789ABCD', package_id: packageId, variant_id: variantId,
    tour_date: '2030-01-01', adults: 2, children: 0, guest_first_name: 'Synthetic',
    guest_last_name: 'Guest', guest_email: 'fixture@example.test', guest_phone: '+201000000000',
    guest_country: 'Egypt', pricing_status: 'quoted', package_code_snapshot: 'TEST',
    package_title_snapshot: 'Synthetic package', variant_label_snapshot: 'Standard',
    adult_unit_rate_snapshot: '100.00', total_amount_snapshot: '200.00', ...overrides,
  };
  if (Array.isArray(data.child_ages)) data.child_ages = JSON.stringify(data.child_ages);
  const keys = Object.keys(data);
  const inserted = await client.query(
    `INSERT INTO package_reservations (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    Object.values(data),
  );
  return client.query('SELECT * FROM package_reservations WHERE id=$1', [inserted.insertId]);
}

describe('package MySQL integrity', () => {
  beforeEach(async () => {
    await client.query('BEGIN');
    packageId = (await client.query("INSERT INTO packages(code,slug,title) VALUES ('TEST','test-package','Synthetic package')")).insertId!;
    variantId = (await client.query("INSERT INTO package_variants(package_id,`key`,label,is_default,sort_order) VALUES ($1,'standard','Standard',true,0)", [packageId])).insertId!;
  });
  afterEach(async () => { await client.query('ROLLBACK'); });

  it('defaults rates and reservation snapshots to USD and rejects any other currency', async () => {
    const rate = await client.query('INSERT INTO package_rate_tiers(variant_id,min_party_size,max_party_size,adult_unit_rate) VALUES ($1,1,NULL,100)', [variantId]);
    assert.ok(rate.insertId);
    assert.equal((await client.query('SELECT currency FROM package_rate_tiers WHERE id=$1', [rate.insertId])).rows[0]!.currency, 'USD');
    assert.equal((await reservation()).rows[0]!.currency, 'USD');
    await rejectSql("UPDATE package_rate_tiers SET currency='EGP'", [], '23514', 'package_rate_tiers_currency_check');
    await rejectSql("UPDATE package_reservations SET currency='EGP'", [], '23514', 'package_reservations_currency_check');
  });

  it('supports 1/2/3+ tiers and resolves exactly one tier per party size', async () => {
    // Overlap itself is rejected by the application (see the file header), so
    // the database is only asked to hold well-formed, adjacent tiers.
    await client.query('INSERT INTO package_rate_tiers(variant_id,min_party_size,max_party_size,adult_unit_rate) VALUES ($1,1,1,100),($1,2,2,90),($1,3,NULL,80)', [variantId]);
    for (const size of [1, 2, 3, 10]) {
      const matches = await client.query('SELECT adult_unit_rate FROM package_rate_tiers WHERE variant_id=$1 AND min_party_size<=$2 AND (max_party_size IS NULL OR max_party_size>=$2)', [variantId, size]);
      assert.equal(matches.rowCount, 1);
      assert.equal(matches.rows[0]!.adult_unit_rate, size === 1 ? '100.00' : size === 2 ? '90.00' : '80.00');
    }
  });

  it('rejects invalid tier bounds and negative or out-of-range rates', async () => {
    for (const values of [[0, 1, '100.00'], [2, 1, '100.00'], [1, null, '-0.01']]) {
      await rejectSql('INSERT INTO package_rate_tiers(variant_id,min_party_size,max_party_size,adult_unit_rate) VALUES ($1,$2,$3,$4)', [variantId, ...values]);
    }
    await rejectAny('INSERT INTO package_rate_tiers(variant_id,min_party_size,adult_unit_rate) VALUES ($1,1,$2)', [variantId, '10000000000.00']);
    await rejectAny('INSERT INTO package_rate_tiers(variant_id,min_party_size,max_party_size,adult_unit_rate) VALUES ($1,1,NULL,$2)', [variantId, 'NaN']);
  });

  it('enforces all catalogue parent foreign keys', async () => {
    await rejectSql("INSERT INTO package_variants(package_id,`key`,label,sort_order) VALUES (-1,'orphan','Orphan',0)", [], '23503');
    await rejectSql("INSERT INTO package_content_items(package_id,kind,text,sort_order) VALUES (-1,'note','Orphan',0)", [], '23503');
    await rejectSql("INSERT INTO package_itinerary_sections(package_id,body,sort_order) VALUES (-1,'Orphan',0)", [], '23503');
    await rejectSql('INSERT INTO package_rate_tiers(variant_id,min_party_size,adult_unit_rate) VALUES (-1,1,100)', [], '23503');
  });

  it('enforces package identities and ordered content uniqueness', async () => {
    await rejectSql("INSERT INTO packages(code,slug,title) VALUES ('TEST','different','Duplicate')", [], '23505', 'packages_code_key');
    await rejectSql("INSERT INTO packages(code,slug,title) VALUES ('DIFFERENT','test-package','Duplicate')", [], '23505', 'packages_slug_key');
    const contentSql = "INSERT INTO package_content_items(package_id,kind,text,sort_order) VALUES ($1,'note','Fixture',0)";
    const itinerarySql = "INSERT INTO package_itinerary_sections(package_id,body,sort_order) VALUES ($1,'Fixture',0)";
    await client.query(contentSql, [packageId]);
    await client.query(itinerarySql, [packageId]);
    await rejectSql(contentSql, [packageId], '23505', 'package_content_items_package_kind_sort_key');
    await rejectSql(itinerarySql, [packageId], '23505', 'package_itinerary_sections_package_sort_key');
  });

  for (const days of [['monday', 'monday'], ['Funday'], [null], [['monday'], ['tuesday']]]) {
    it(`rejects invalid operating days ${JSON.stringify(days)}`, async () => {
      await rejectSql('UPDATE packages SET operating_days=$1', [JSON.stringify(days)]);
    });
  }
  it('accepts explicit weekdays', async () => {
    await client.query('UPDATE packages SET operating_days=$1', [JSON.stringify(['monday', 'sunday'])]);
    assert.deepEqual((await client.query('SELECT operating_days FROM packages WHERE id=$1', [packageId])).rows[0]!.operating_days, ['monday', 'sunday']);
  });

  for (const [field, value] of [['code', ' TEST'], ['code', '\t'], ['title', 'Title '], ['slug', 'Invalid'], ['sort_order', -1]] as const) {
    it(`rejects invalid package ${field}`, async () => { await rejectSql(`UPDATE packages SET ${field}=$1`, [value]); });
  }

  it('enforces child metadata completeness, age order and discount bounds', async () => {
    await rejectSql('UPDATE package_variants SET child_min_age=6', []);
    for (const values of [[12, 6, '50.00'], [-1, 6, '50.00'], [6, 12, '100.01']]) {
      await rejectSql('UPDATE package_variants SET child_min_age=$1,child_max_age=$2,child_discount_percent=$3', values);
    }
    await client.query('UPDATE package_variants SET child_min_age=6,child_max_age=12,child_discount_percent=50.00');
  });

  for (const ages of [[6, 7], [-1], [[6]]]) {
    it(`rejects invalid child ages ${JSON.stringify(ages)}`, async () => {
      await reservation({ children: 1, pricing_status: 'requires_confirmation', total_amount_snapshot: null });
      await rejectSql('UPDATE package_reservations SET child_ages=$1', [JSON.stringify(ages)]);
    });
  }
  it('allows child ages only in a matching array; quotes children with exact rates', async () => {
    const created = await reservation({ children: 1, child_ages: [6], child_unit_rate_snapshot: '50.25', total_amount_snapshot: '250.25' });
    assert.equal(created.rows[0]!.total_amount_snapshot, '250.25');
    assert.deepEqual(created.rows[0]!.child_ages, [6]);
    await rejectSql('UPDATE package_reservations SET children=0', []);
  });

  const invalidReservations: [string, unknown][] = [
    ['total_amount_snapshot', null], ['total_amount_snapshot', '199.99'],
    ['adult_unit_rate_snapshot', '-0.01'],
    ['status', 'paid'], ['pricing_status', 'estimated'], ['adults', 0], ['children', -1],
    ['guest_first_name', '\t'], ['guest_last_name', 'x'.repeat(101)],
    ['guest_email', 'x'.repeat(255)], ['guest_phone', 'x'.repeat(51)],
    ['guest_country', 'x'.repeat(101)], ['special_requests', 'x'.repeat(2001)],
    ['booking_reference', 'bad'], ['package_code_snapshot', ''],
    ['package_title_snapshot', ''], ['variant_label_snapshot', ''],
  ];
  for (const [field, value] of invalidReservations) {
    it(`rejects reservation ${field}=${String(value).slice(0, 20)}`, async () => {
      await reservation();
      await rejectSql(`UPDATE package_reservations SET ${field}=$1`, [value]);
    });
  }
  it('requires a deterministic child rate for quoted children', async () => {
    await reservation();
    await rejectSql('UPDATE package_reservations SET children=1', []);
  });
  it('requires_confirmation stores no guaranteed total', async () => {
    await reservation({ pricing_status: 'requires_confirmation', total_amount_snapshot: null });
    await rejectSql('UPDATE package_reservations SET total_amount_snapshot=200', []);
  });
  it('enforces booking reference uniqueness', async () => {
    await reservation();
    await client.query('SAVEPOINT duplicate_reference');
    await assert.rejects(reservation(), { code: '23505', constraint: 'package_reservations_booking_reference_key' });
    await client.query('ROLLBACK TO SAVEPOINT duplicate_reference');
  });
  it('rejects mismatched variant/package ownership and preserves referenced catalogue rows', async () => {
    const other = (await client.query("INSERT INTO packages(code,slug,title) VALUES ('OTHER','other','Other')")).insertId!;
    await reservation();
    await rejectSql('UPDATE package_reservations SET package_id=$1', [other], '23503', 'package_reservations_variant_package_fkey');
    await rejectSql('DELETE FROM package_variants WHERE id=$1', [variantId], '23503', 'package_reservations_variant_package_fkey');
    await rejectSql('DELETE FROM packages WHERE id=$1', [packageId], '23503', 'package_reservations_variant_package_fkey');
  });
  it('keeps historical snapshots independent of catalogue changes', async () => {
    const original = (await reservation()).rows[0];
    await client.query("UPDATE packages SET code='CHANGED', title='Changed'");
    await client.query("UPDATE package_variants SET label='Changed'");
    assert.deepEqual((await client.query('SELECT * FROM package_reservations')).rows[0], original);
  });
  it('enforces variant defaults, keys, ordering and content/itinerary integrity', async () => {
    await rejectSql("INSERT INTO package_variants(package_id,`key`,label,is_default,sort_order) VALUES ($1,'other','Other',true,1)", [packageId], '23505', 'package_variants_one_default_per_package_idx');
    await rejectSql("INSERT INTO package_variants(package_id,`key`,label,sort_order) VALUES ($1,'standard','Other',1)", [packageId], '23505', 'package_variants_package_key_key');
    await rejectSql("INSERT INTO package_variants(package_id,`key`,label,sort_order) VALUES ($1,'other','Other',0)", [packageId], '23505', 'package_variants_package_sort_key');
    await rejectSql("INSERT INTO package_content_items(package_id,kind,text,sort_order) VALUES ($1,'other','Text',0)", [packageId]);
    await rejectSql("INSERT INTO package_itinerary_sections(package_id,day_number,body,sort_order) VALUES ($1,0,'Body',0)", [packageId]);
    await client.query("INSERT INTO package_content_items(package_id,kind,text,sort_order) VALUES ($1,'note','Text',0)", [packageId]);
    await client.query("INSERT INTO package_itinerary_sections(package_id,body,sort_order) VALUES ($1,'Body',0)", [packageId]);
    await client.query('DELETE FROM packages WHERE id=$1', [packageId]);
    for (const table of ['package_variants', 'package_content_items', 'package_itinerary_sections']) {
      assert.equal(await count(`SELECT COUNT(*) AS n FROM ${table}`), 0);
    }
  });
  it('reconciles a synthetic catalogue twice without duplicates or changing historical reservations', async () => {
    const item: BrochurePackageSeed = {
      code: 'TEST', slug: 'test-package', title: 'Synthetic package', summary: null,
      description: null, durationLabel: null, scheduleLabel: null, operatingDays: null,
      requiresPriceConfirmation: false, itinerary: [{ dayNumber: null, heading: null, body: 'Fixture' }],
      content: [{ kind: 'note', text: 'Fixture' }], variants: [{ key: 'standard', label: 'Standard', isDefault: true,
        childMinAge: null, childMaxAge: null, childDiscountPercent: null,
        rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '100.00' }] }],
    };
    const original = (await reservation()).rows[0];
    await seedBrochurePackageCatalogue(client, [item]);
    item.variants[0]!.rates[0]!.adultUnitRate = '150.00';
    await seedBrochurePackageCatalogue(client, [item]);
    for (const table of tables) assert.equal(await count(`SELECT COUNT(*) AS n FROM ${table}`), 1);
    assert.equal((await client.query('SELECT currency FROM package_rate_tiers')).rows[0]!.currency, 'USD');
    assert.deepEqual((await client.query('SELECT * FROM package_reservations')).rows[0], original);
  });

  // Reordering variants in place has to satisfy a UNIQUE(package_id,
  // sort_order) that InnoDB checks as each row is written rather than at
  // statement end. The seed parks existing rows above every value in use
  // before writing the final 1..n positions.
  describe('variant reorder', () => {
    function catalogueItem(variantKeys: string[]): BrochurePackageSeed {
      return {
        code: 'TEST', slug: 'test-package', title: 'Synthetic package', summary: null,
        description: null, durationLabel: null, scheduleLabel: null, operatingDays: null,
        requiresPriceConfirmation: false, itinerary: [], content: [],
        variants: variantKeys.map((key) => ({
          key, label: key, isDefault: variantKeys.length === 1,
          childMinAge: null, childMaxAge: null, childDiscountPercent: null,
          rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '100.00' }],
        })),
      };
    }

    /** Every variant of the fixture package, keyed for stable comparison. */
    async function variantsByKey(): Promise<Record<string, { id: string; sortOrder: number }>> {
      const { rows } = await client.query<{ id: string; key: string; sort_order: number }>(
        'SELECT id, `key`, sort_order FROM package_variants WHERE package_id = $1 ORDER BY `key`',
        [packageId],
      );
      return Object.fromEntries(rows.map((row) => [row.key, { id: row.id, sortOrder: row.sort_order }]));
    }

    async function addVariant(key: string, sortOrder: number): Promise<void> {
      await client.query(
        'INSERT INTO package_variants(package_id,`key`,label,is_default,sort_order) VALUES ($1,$2,$2,false,$3)',
        [packageId, key, sortOrder],
      );
    }

    /** The beforeEach fixture variant sits at 0; move it where a case needs it. */
    async function moveStandard(sortOrder: number): Promise<void> {
      await client.query('UPDATE package_variants SET sort_order = $2 WHERE id = $1', [variantId, sortOrder]);
    }

    it('swaps two variants without changing their ids', async () => {
      await moveStandard(1);
      await addVariant('second', 2);
      const before = await variantsByKey();

      await seedBrochurePackageCatalogue(client, [catalogueItem(['second', 'standard'])]);

      const after = await variantsByKey();
      assert.equal(after.second!.sortOrder, 1);
      assert.equal(after.standard!.sortOrder, 2);
      assert.equal(after.standard!.id, before.standard!.id);
      assert.equal(after.second!.id, before.second!.id);
    });

    it('reverses three variants without changing their ids', async () => {
      await moveStandard(1);
      await addVariant('second', 2);
      await addVariant('third', 3);
      const before = await variantsByKey();

      await seedBrochurePackageCatalogue(client, [catalogueItem(['third', 'second', 'standard'])]);

      const after = await variantsByKey();
      assert.deepEqual(
        [after.third!.sortOrder, after.second!.sortOrder, after.standard!.sortOrder],
        [1, 2, 3],
      );
      for (const key of ['standard', 'second', 'third']) {
        assert.equal(after[key]!.id, before[key]!.id, `${key} id must be stable`);
      }
    });

    it('handles an insert combined with a reorder', async () => {
      await moveStandard(1);
      await addVariant('second', 2);
      const before = await variantsByKey();

      await seedBrochurePackageCatalogue(client, [catalogueItem(['third', 'second', 'standard'])]);

      const after = await variantsByKey();
      assert.deepEqual(
        [after.third!.sortOrder, after.second!.sortOrder, after.standard!.sortOrder],
        [1, 2, 3],
      );
      assert.equal(after.standard!.id, before.standard!.id);
      assert.equal(after.second!.id, before.second!.id);
      assert.ok(after.third, 'the new variant was inserted');
    });

    it('reorders when an existing variant legally sits at sort_order 0', async () => {
      const before = await variantsByKey();
      assert.equal(before.standard!.sortOrder, 0);

      await seedBrochurePackageCatalogue(client, [catalogueItem(['second', 'standard'])]);

      const after = await variantsByKey();
      assert.equal(after.second!.sortOrder, 1);
      assert.equal(after.standard!.sortOrder, 2);
      assert.equal(after.standard!.id, before.standard!.id);
    });

    it('reorders across sparse existing values that overlap the naive range', async () => {
      await moveStandard(1);
      await addVariant('second', 3);
      const before = await variantsByKey();

      await seedBrochurePackageCatalogue(client, [catalogueItem(['second', 'standard'])]);

      const after = await variantsByKey();
      assert.equal(after.second!.sortOrder, 1);
      assert.equal(after.standard!.sortOrder, 2);
      assert.equal(after.standard!.id, before.standard!.id);
      assert.equal(after.second!.id, before.second!.id);
    });

    it('leaves final positions as exactly 1..n, with no parked value surviving', async () => {
      await moveStandard(1);
      await addVariant('second', 3);

      await seedBrochurePackageCatalogue(client, [catalogueItem(['second', 'standard'])]);

      const orders = Object.values(await variantsByKey()).map((v) => v.sortOrder).sort((a, b) => a - b);
      assert.deepEqual(orders, [1, 2]);
    });

    it('still refuses an unexpected existing variant, leaving variants untouched', async () => {
      await moveStandard(1);
      await addVariant('removed', 2);
      const before = await variantsByKey();

      await assert.rejects(
        seedBrochurePackageCatalogue(client, [catalogueItem(['standard'])]),
        /unexpected existing variants: removed/,
      );

      assert.deepEqual(await variantsByKey(), before, 'no variant row may move before the guard passes');
    });

    it('is idempotent across a repeated reorder', async () => {
      await moveStandard(1);
      await addVariant('second', 3);

      await seedBrochurePackageCatalogue(client, [catalogueItem(['second', 'standard'])]);
      const first = await variantsByKey();
      await seedBrochurePackageCatalogue(client, [catalogueItem(['second', 'standard'])]);

      assert.deepEqual(await variantsByKey(), first);
    });

    it('keeps a reservation pointing at the same variant across a reorder', async () => {
      await moveStandard(1);
      await addVariant('second', 3);
      const original = (await reservation()).rows[0];

      await seedBrochurePackageCatalogue(client, [catalogueItem(['second', 'standard'])]);

      const after = await variantsByKey();
      assert.equal(after.standard!.id, variantId, 'the referenced variant id is unchanged');
      assert.deepEqual((await client.query('SELECT * FROM package_reservations')).rows[0], original);
    });

    it('relies on a unique key that is still checked immediately', async () => {
      // InnoDB has no deferrable constraints, which is why parking is needed.
      await moveStandard(1);
      await addVariant('second', 2);
      await rejectSql('UPDATE package_variants SET sort_order = 2 WHERE id = $1', [variantId], '23505',
        'package_variants_package_sort_key');
    });
  });
});

it('leaves zero package fixtures behind', async t => {
  assert.equal(await count('SELECT COUNT(*) AS n FROM packages WHERE code IN (\'TEST\', \'OTHER\', \'CHANGED\')'), 0);
  t.diagnostic('Every case ran in a rolled-back transaction');
});
