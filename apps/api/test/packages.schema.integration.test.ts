import assert from 'node:assert/strict';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { runner } from 'node-pg-migrate';
import { seedBrochurePackageCatalogue, type BrochurePackageSeed } from '../src/db/seeds/packageCatalogueSeed';

// Deliberately separate from the general integration command: this suite runs
// migration DOWN and is only permitted on an explicitly disposable PG16 target.
const databaseUrl = process.env.DATABASE_URL ?? '';
assert.ok(databaseUrl, 'DATABASE_URL is required');
const target = new URL(databaseUrl);
assert.equal(process.env.PACKAGES_DISPOSABLE_TEST, '1', 'Explicit disposable-cluster opt-in required');
assert.equal(target.hostname, '127.0.0.1');
assert.ok(target.port === '5434' || target.port === '55432');
assert.equal(target.pathname, '/hotel_reservation_packages_test');
assert.equal(target.search, '', 'Connection overrides are not allowed');
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
let client: PoolClient;
const tables = ['packages', 'package_itinerary_sections', 'package_content_items',
  'package_variants', 'package_rate_tiers', 'package_reservations'].sort();
const migrationName = '1790200000000_create-packages-and-package-reservations';
let baseline: unknown;
let connected = false;
let ready = false;
let packageId: string;
let variantId: string;

async function migrate(direction: 'up' | 'down', count?: number) {
  return runner({ databaseUrl, direction, count, migrationsTable: 'pgmigrations',
    dir: path.resolve(__dirname, '../src/db/migrations'), log: () => undefined });
}

async function packageTables() {
  return (await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND (tablename = 'packages' OR tablename LIKE 'package_%') ORDER BY tablename",
  )).rows.map(row => row.tablename);
}

async function assertNoFixtures() {
  for (const table of await packageTables()) {
    assert.ok(tables.includes(table));
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n, 0, `${table} residue`);
  }
}

async function hotelSnapshot() {
  // Schema, indexes, constraints, rows and sequence state: no hotel writes.
  const columns = (await client.query(`SELECT table_name, column_name, ordinal_position,
    data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('room_types','rooms','reservations')
    ORDER BY table_name, ordinal_position`)).rows;
  const indexes = (await client.query(`SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN ('room_types','rooms','reservations')
    ORDER BY tablename, indexname`)).rows;
  const constraints = (await client.query(`SELECT conrelid::regclass::text AS tablename,
    conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid IN ('room_types'::regclass,'rooms'::regclass,'reservations'::regclass)
    ORDER BY tablename, conname`)).rows;
  const rows: Record<string, unknown> = {};
  for (const table of ['room_types', 'rooms', 'reservations']) {
    rows[table] = (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    rows[`${table}_sequence`] = (await client.query(`SELECT last_value, is_called FROM ${table}_id_seq`)).rows;
  }
  return { columns, indexes, constraints, rows };
}

before(async () => {
  client = await pool.connect();
  connected = true;
  // The dedicated-port check lives in the module-level guard on the client
  // URL above, not here: `inet_server_port()` reports the port PostgreSQL
  // itself listens on, which behind Docker/NAT port forwarding is the
  // container's internal 5432 rather than the forwarded host port this suite
  // is required to connect through. The client URL is the safety boundary.
  const server = (await client.query(`SELECT current_database() AS db,
    current_setting('server_version_num')::int AS version`)).rows[0];
  assert.equal(server.db, 'hotel_reservation_packages_test');
  assert.ok((server.version >= 160000 && server.version < 170000) || (server.version >= 180000 && server.version < 190000), 'PostgreSQL 16 or 18 required');
  const historyExists = (await client.query("SELECT to_regclass('public.pgmigrations') AS name")).rows[0].name;
  if (historyExists) {
    const history = (await client.query('SELECT name FROM pgmigrations ORDER BY id')).rows;
    // Current main's baseline is 6 migrations; 7 means the package migration
    // is already applied and this run must start by taking it back down.
    assert.ok(history.length === 6 || history.length === 7, 'Unexpected migration history');
    if (history.length === 7) {
      assert.equal(history[6].name, migrationName);
      await assertNoFixtures();
      await migrate('down', 1);
    }
  } else {
    assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0,
      'A fresh disposable database must be empty');
    assert.equal((await migrate('up', 6)).length, 6);
  }
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pgmigrations')).rows[0].n, 6);
  baseline = await hotelSnapshot();
  ready = true;
});

after(async () => {
  if (!connected) { await pool.end(); return; }
  try {
    if (ready) {
      await assertNoFixtures();
      assert.deepEqual(await hotelSnapshot(), baseline, 'Hotel schema/data/sequence state changed');
    }
  } finally { client.release(); await pool.end(); }
});

it('migrates UP / DOWN / UP, removes owned objects, and makes repeated UP a no-op', async t => {
  assert.equal((await migrate('up', 1)).length, 1);
  assert.deepEqual(await packageTables(), tables);
  assert.deepEqual(await hotelSnapshot(), baseline);
  assert.equal((await migrate('down', 1)).length, 1);
  assert.deepEqual(await packageTables(), []);
  assert.equal((await client.query(`SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public'
    AND (c.relname='packages' OR c.relname LIKE 'package_%')`)).rows[0].n, 0);
  assert.deepEqual(await hotelSnapshot(), baseline);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_extension WHERE extname='btree_gist'")).rows[0].n, 1);
  assert.equal((await migrate('up', 1)).length, 1);
  assert.deepEqual(await packageTables(), tables);
  assert.equal((await migrate('up')).length, 0);
  // Baseline 6 plus the package migration.
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pgmigrations')).rows[0].n, 7);
  t.diagnostic('UP/DOWN/UP/no-op UP passed; existing hotel schema, rows and sequences unchanged');
});

it('installs all required indexes, validated constraints and package-only foreign keys', async t => {
  const indexes = (await client.query<{ indexname: string }>(
    'SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename=ANY($2::text[])', ['public', tables],
  )).rows.map(row => row.indexname).sort();
  const expected = [
    'packages_pkey', 'packages_code_key', 'packages_slug_key', 'packages_public_catalogue_idx',
    'package_itinerary_sections_pkey', 'package_itinerary_sections_package_sort_key',
    'package_content_items_pkey', 'package_content_items_package_kind_sort_key',
    'package_variants_pkey', 'package_variants_package_key_key', 'package_variants_package_sort_key',
    'package_variants_id_package_id_key', 'package_variants_one_default_per_package_idx',
    'package_rate_tiers_pkey', 'package_rate_tiers_variant_id_idx', 'package_rate_tiers_no_overlap',
    'package_reservations_pkey', 'package_reservations_booking_reference_key',
    'package_reservations_package_tour_date_idx', 'package_reservations_variant_tour_date_idx',
  ].sort();
  assert.deepEqual(indexes, expected);
  const constraints = (await client.query(`SELECT conname, contype, convalidated,
    confrelid::regclass::text AS parent FROM pg_constraint
    WHERE conrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]))
    AND contype <> 'n'`, [tables])).rows;
  assert.ok(constraints.every(row => row.convalidated));
  assert.equal(constraints.length, 62);
  const fks = constraints.filter(row => row.contype === 'f');
  assert.equal(fks.length, 5);
  assert.ok(fks.every(row => tables.includes(row.parent)));
  const columns = (await client.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=ANY($1::text[])`, [tables])).rows;
  assert.ok(columns.every(row => !/image|photo|media|room_id|room_type_id|pricing_basis|tier_party_basis/.test(row.column_name)));
  t.diagnostic(`${tables.length} tables, ${indexes.length} indexes, ${constraints.length} validated constraints, ${fks.length} package-only FKs`);
});

async function rejectSql(sql: string, values: unknown[], code: string | string[] = '23514', constraint?: string) {
  await client.query('SAVEPOINT expected_rejection');
  try {
    await assert.rejects(client.query(sql, values), error => {
      const failure = error as { code: string; constraint?: string };
      const acceptedCodes = Array.isArray(code) ? code : [code];
      assert.ok(acceptedCodes.includes(failure.code), `Unexpected SQLSTATE ${failure.code}; expected ${acceptedCodes.join(' or ')}`);
      if (constraint) assert.equal(failure.constraint, constraint);
      return true;
    });
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_rejection');
    await client.query('RELEASE SAVEPOINT expected_rejection');
  }
}

async function reservation(overrides: Record<string, unknown> = {}) {
  const data = {
    booking_reference: 'TPP-23456789ABCD', package_id: packageId, variant_id: variantId,
    tour_date: '2030-01-01', adults: 2, children: 0, guest_first_name: 'Synthetic',
    guest_last_name: 'Guest', guest_email: 'fixture@example.test', guest_phone: '+201000000000',
    guest_country: 'Egypt', pricing_status: 'quoted', package_code_snapshot: 'TEST',
    package_title_snapshot: 'Synthetic package', variant_label_snapshot: 'Standard',
    adult_unit_rate_snapshot: '100.00', total_amount_snapshot: '200.00', ...overrides,
  };
  const keys = Object.keys(data);
  return client.query(`INSERT INTO package_reservations (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(data));
}

describe('package PostgreSQL integrity', () => {
  beforeEach(async () => {
    await client.query('BEGIN');
    packageId = (await client.query("INSERT INTO packages(code,slug,title) VALUES ('TEST','test-package','Synthetic package') RETURNING id")).rows[0].id;
    variantId = (await client.query("INSERT INTO package_variants(package_id,key,label,is_default,sort_order) VALUES ($1,'standard','Standard',true,0) RETURNING id", [packageId])).rows[0].id;
  });
  afterEach(async () => { await client.query('ROLLBACK'); });

  it('defaults rates and reservation snapshots to USD and rejects any other currency', async () => {
    const rate = await client.query('INSERT INTO package_rate_tiers(variant_id,min_party_size,max_party_size,adult_unit_rate) VALUES ($1,1,NULL,100) RETURNING currency', [variantId]);
    assert.equal(rate.rows[0].currency, 'USD');
    assert.equal((await reservation()).rows[0].currency, 'USD');
    await rejectSql("UPDATE package_rate_tiers SET currency='EGP'", [], '23514', 'package_rate_tiers_currency_check');
    await rejectSql("UPDATE package_reservations SET currency='EGP'", [], '23514', 'package_reservations_currency_check');
  });

  it('supports 1/2/3+ tiers and rejects inclusive and unbounded overlap', async () => {
    await client.query('INSERT INTO package_rate_tiers(variant_id,min_party_size,max_party_size,adult_unit_rate) VALUES ($1,1,1,100),($1,2,2,90),($1,3,NULL,80)', [variantId]);
    for (const size of [1, 2, 3, 10]) {
      const matches = await client.query('SELECT adult_unit_rate FROM package_rate_tiers WHERE variant_id=$1 AND min_party_size<=$2 AND (max_party_size IS NULL OR max_party_size>=$2)', [variantId, size]);
      assert.equal(matches.rowCount, 1);
      assert.equal(matches.rows[0].adult_unit_rate, size === 1 ? '100.00' : size === 2 ? '90.00' : '80.00');
    }
    for (const range of [[1, 2], [4, null]]) {
      await rejectSql('INSERT INTO package_rate_tiers(variant_id,min_party_size,max_party_size,adult_unit_rate) VALUES ($1,$2,$3,50)', [variantId, ...range], '23P01', 'package_rate_tiers_no_overlap');
    }
  });

  it('rejects invalid tier bounds and nonfinite/negative rates', async () => {
    for (const values of [[0, 1, '100.00'], [2, 1, '100.00'], [1, null, '-0.01'], [1, null, 'NaN']]) {
      await rejectSql('INSERT INTO package_rate_tiers(variant_id,min_party_size,max_party_size,adult_unit_rate) VALUES ($1,$2,$3,$4)', [variantId, ...values]);
    }
    await rejectSql('INSERT INTO package_rate_tiers(variant_id,min_party_size,adult_unit_rate) VALUES ($1,1,$2)', [variantId, '10000000000.00'], '22003');
  });

  it('enforces all catalogue parent foreign keys', async () => {
    await rejectSql("INSERT INTO package_variants(package_id,key,label,sort_order) VALUES (-1,'orphan','Orphan',0)", [], '23503');
    await rejectSql("INSERT INTO package_content_items(package_id,kind,text,sort_order) VALUES (-1,'note','Orphan',0)", [], '23503');
    await rejectSql("INSERT INTO package_itinerary_sections(package_id,body,sort_order) VALUES (-1,'Orphan',0)", [], '23503');
    await rejectSql('INSERT INTO package_rate_tiers(variant_id,min_party_size,adult_unit_rate) VALUES (-1,1,100)', [], '23503');
  });

  it('enforces package identities and ordered content uniqueness', async () => {
    await rejectSql("INSERT INTO packages(code,slug,title) VALUES ('TEST','different','Duplicate')", [], '23505');
    await rejectSql("INSERT INTO packages(code,slug,title) VALUES ('DIFFERENT','test-package','Duplicate')", [], '23505');
    const contentSql = "INSERT INTO package_content_items(package_id,kind,text,sort_order) VALUES ($1,'note','Fixture',0)";
    const itinerarySql = "INSERT INTO package_itinerary_sections(package_id,body,sort_order) VALUES ($1,'Fixture',0)";
    await client.query(contentSql, [packageId]);
    await client.query(itinerarySql, [packageId]);
    await rejectSql(contentSql, [packageId], '23505');
    await rejectSql(itinerarySql, [packageId], '23505');
  });

  for (const days of [[], ['monday', 'monday'], ['Funday'], [null], [['monday'], ['tuesday']]]) {
    it(`rejects invalid operating days ${JSON.stringify(days)}`, async () => {
      await rejectSql('UPDATE packages SET operating_days=$1::text[]', [days]);
    });
  }
  it('accepts explicit weekdays and rejects nonstandard array lower bounds', async () => {
    await client.query("UPDATE packages SET operating_days=ARRAY['monday','sunday']");
    await rejectSql("UPDATE packages SET operating_days='[0:0]={monday}'::text[]", []);
  });

  for (const [field, value] of [['code', ' TEST'], ['code', '\t'], ['title', 'Title '], ['slug', 'Invalid'], ['sort_order', -1]] as const) {
    it(`rejects invalid package ${field}`, async () => { await rejectSql(`UPDATE packages SET ${field}=$1`, [value]); });
  }

  it('enforces child metadata completeness, age order and discount bounds', async () => {
    await rejectSql('UPDATE package_variants SET child_min_age=6', []);
    for (const values of [[12, 6, '50.00'], [-1, 6, '50.00'], [6, 12, '100.01'], [6, 12, 'NaN']]) {
      await rejectSql('UPDATE package_variants SET child_min_age=$1,child_max_age=$2,child_discount_percent=$3', values);
    }
    await client.query('UPDATE package_variants SET child_min_age=6,child_max_age=12,child_discount_percent=50.00');
  });

  for (const ages of [[], [6, 7], [null], [-1], [[6]]]) {
    it(`rejects invalid child ages ${JSON.stringify(ages)}`, async () => {
      await reservation({ children: 1, pricing_status: 'requires_confirmation', total_amount_snapshot: null });
      await rejectSql('UPDATE package_reservations SET child_ages=$1::integer[]', [ages]);
    });
  }
  it('allows child ages only in matching one-based arrays; quotes children with exact rates', async () => {
    const created = await reservation({ children: 1, child_ages: [6], child_unit_rate_snapshot: '50.25', total_amount_snapshot: '250.25' });
    assert.equal(created.rows[0].total_amount_snapshot, '250.25');
    await rejectSql("UPDATE package_reservations SET child_ages='[0:0]={6}'::integer[]", []);
    await rejectSql('UPDATE package_reservations SET children=0', []);
  });

  const invalidReservations: [string, unknown][] = [
    ['total_amount_snapshot', null], ['total_amount_snapshot', '199.99'],
    ['total_amount_snapshot', 'NaN'], ['adult_unit_rate_snapshot', 'NaN'],
    ['adult_unit_rate_snapshot', '-0.01'], ['child_unit_rate_snapshot', 'NaN'],
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
    await assert.rejects(reservation(), { code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT duplicate_reference');
  });
  it('rejects mismatched variant/package ownership and preserves referenced catalogue rows', async () => {
    const other = (await client.query("INSERT INTO packages(code,slug,title) VALUES ('OTHER','other','Other') RETURNING id")).rows[0].id;
    await reservation();
    await rejectSql('UPDATE package_reservations SET package_id=$1', [other], '23503', 'package_reservations_variant_package_fkey');
    await rejectSql('DELETE FROM package_variants WHERE id=$1', [variantId], ['23001', '23503']);
    await rejectSql('DELETE FROM packages WHERE id=$1', [packageId], ['23001', '23503']);
  });
  it('keeps historical snapshots independent of catalogue changes', async () => {
    const original = (await reservation()).rows[0];
    await client.query("UPDATE packages SET code='CHANGED', title='Changed'");
    await client.query("UPDATE package_variants SET label='Changed'");
    assert.deepEqual((await client.query('SELECT * FROM package_reservations')).rows[0], original);
  });
  it('enforces variant defaults, keys, ordering and content/itinerary integrity', async () => {
    await rejectSql("INSERT INTO package_variants(package_id,key,label,is_default,sort_order) VALUES ($1,'other','Other',true,1)", [packageId], '23505');
    await rejectSql("INSERT INTO package_variants(package_id,key,label,sort_order) VALUES ($1,'standard','Other',1)", [packageId], '23505');
    await rejectSql("INSERT INTO package_variants(package_id,key,label,sort_order) VALUES ($1,'other','Other',0)", [packageId], '23505');
    await rejectSql("INSERT INTO package_content_items(package_id,kind,text,sort_order) VALUES ($1,'other','Text',0)", [packageId]);
    await rejectSql("INSERT INTO package_itinerary_sections(package_id,day_number,body,sort_order) VALUES ($1,0,'Body',0)", [packageId]);
    await client.query("INSERT INTO package_content_items(package_id,kind,text,sort_order) VALUES ($1,'note','Text',0)", [packageId]);
    await client.query("INSERT INTO package_itinerary_sections(package_id,body,sort_order) VALUES ($1,'Body',0)", [packageId]);
    await client.query('DELETE FROM packages WHERE id=$1', [packageId]);
    for (const table of ['package_variants','package_content_items','package_itinerary_sections']) {
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
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
    item.variants[0].rates[0].adultUnitRate = '150.00';
    await seedBrochurePackageCatalogue(client, [item]);
    for (const table of tables) assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 1);
    assert.equal((await client.query('SELECT currency FROM package_rate_tiers')).rows[0].currency, 'USD');
    assert.deepEqual((await client.query('SELECT * FROM package_reservations')).rows[0], original);
  });
});

it('leaves zero package fixtures and preserves hotel schema, rows and sequence state', async t => {
  await assertNoFixtures();
  assert.deepEqual(await hotelSnapshot(), baseline);
  t.diagnostic('Zero fixture rows across all six package tables; hotel snapshot unchanged');
});
