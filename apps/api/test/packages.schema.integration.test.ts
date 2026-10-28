import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { Pool, type PoolClient } from '../src/db/pool';
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
/**
 * Tables a LATER migration creates that still match the `package_%` sweep
 * below. They are not this suite's subject — `package_media` has its own
 * schema suite — but they exist by the time the migrations are fully applied,
 * so the sweep has to expect them. Every index, constraint and column
 * assertion here stays scoped to `tables`.
 */
const laterPackageTables = ['package_media'];
const allPackageTables = [...tables, ...laterPackageTables].sort();
const migrationName = '1790200000000_create-packages-and-package-reservations';
const ownershipMigrationName = '1790300000000_add-packages-seed-managed';
const mediaMigrationName = '1790400000000_create-package-media';
/** Everything this suite applies, in apply order. Its subject, and only it. */
const packageMigrations = [migrationName, ownershipMigrationName, mediaMigrationName];

const migrationsDir = path.resolve(__dirname, '../src/db/migrations');

/**
 * Every migration on disk, in the order node-pg-migrate applies them, named as
 * `pgmigrations` records them.
 *
 * Read from disk rather than listed here, because what this suite needs to
 * know is not which migrations exist but WHERE ITS OWN sit in the sequence.
 * The package migrations were once the newest, and the assertions below were
 * written as though they always would be; `create-notification-outbox` landing
 * on top of them broke every one of those assumptions at once. Deriving the
 * position means the next migration to land — wherever it lands — is absorbed
 * instead of breaking this file again.
 */
const allMigrations = readdirSync(migrationsDir)
  .filter(name => name.endsWith('.cjs'))
  .sort()
  .map(name => name.replace(/\.cjs$/, ''));

const firstPackageIndex = allMigrations.indexOf(migrationName);
const lastPackageIndex = allMigrations.indexOf(mediaMigrationName);
assert.ok(firstPackageIndex >= 0 && lastPackageIndex >= 0, 'the package migrations must exist on disk');
assert.deepEqual(allMigrations.slice(firstPackageIndex, lastPackageIndex + 1), packageMigrations,
  'the package migrations must be contiguous and in this order');

/** Migrations that exist before any package migration. */
const baselineMigrations = allMigrations.slice(0, firstPackageIndex);
/**
 * Migrations that land AFTER the package ones — today, the notification
 * outbox. They are not this suite's subject and it asserts nothing about what
 * they contain, but it cannot ignore them either: node-pg-migrate unwinds
 * strictly newest-first, so anything above the package migrations has to come
 * off before them and go back on afterwards.
 */
const trailingMigrations = allMigrations.slice(lastPackageIndex + 1);
/** The full expected history above the baseline, in apply order. */
const aboveBaseline = [...packageMigrations, ...trailingMigrations];
const BASELINE = baselineMigrations.length;
// Pinned, not merely derived. The hotel snapshot this suite compares against
// is the schema those six migrations produce, so a NEW migration inserted
// before the package ones changes this suite's baseline and needs a look
// rather than a silently shifted number. A migration added at the END is
// absorbed by `trailingMigrations` and needs nothing.
assert.equal(BASELINE, 6, 'a migration was added before the package ones; re-check the baseline here');

/**
 * How many DOWN steps remove `name` and everything applied after it.
 *
 * Only meaningful from a fully-migrated history, which is the state each
 * caller below is in. This is what replaces the hard-coded step counts: they
 * silently meant "and nothing is above this", which stopped being true.
 */
const stepsDownThrough = (name: string) => allMigrations.length - allMigrations.indexOf(name);
let baseline: unknown;
/** The history as this run found it, so `after` can prove it was restored. */
let initialHistory: string[] = [];
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
    assert.ok(allPackageTables.includes(table));
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
    const applied = history.map((row: { name: string }) => row.name);
    initialHistory = applied;
    // The history must be the baseline, then an unbroken prefix of what
    // follows it: the package migrations, then anything applied after them.
    // Checked by NAME and in order rather than by count, so a history that
    // merely happens to be the right length is still rejected.
    assert.ok(applied.length >= BASELINE && applied.length <= allMigrations.length,
      'Unexpected migration history');
    assert.deepEqual(applied.slice(0, BASELINE), baselineMigrations, 'Unexpected migration history');
    assert.deepEqual(applied.slice(BASELINE), aboveBaseline.slice(0, applied.length - BASELINE),
      'Unexpected migration history');
    if (applied.length > BASELINE) {
      await assertNoFixtures();
      // Newest-first, so any trailing migration comes off before the package
      // ones it sits above. The first test puts all of it back.
      await migrate('down', applied.length - BASELINE);
    }
  } else {
    assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0,
      'A fresh disposable database must be empty');
    assert.equal((await migrate('up', BASELINE)).length, BASELINE);
  }
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pgmigrations')).rows[0].n, BASELINE);
  baseline = await hotelSnapshot();
  ready = true;
});

after(async () => {
  if (!connected) { await pool.end(); return; }
  try {
    if (ready) {
      await assertNoFixtures();
      assert.deepEqual(await hotelSnapshot(), baseline, 'Hotel schema/data/sequence state changed');
      // The history this suite unwound has to be put back exactly. Every
      // migration ends applied, in order — including the trailing ones this
      // suite took down only to reach its own subject, whose absence would
      // leave the database short of a table the rest of the run needs.
      const finalHistory = (await client.query('SELECT name FROM pgmigrations ORDER BY id')).rows
        .map((row: { name: string }) => row.name);
      assert.deepEqual(finalHistory, allMigrations, 'the migration history was not fully restored');
      if (initialHistory.length === allMigrations.length) {
        assert.deepEqual(finalHistory, initialHistory, 'the history differs from the one this run found');
      }
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
  // The ownership column follows the package tables and is applied here, so
  // the rest of this suite runs against the schema a deployment actually has.
  // Everything still pending: the remaining package migrations AND whatever
  // now sits above them. This is the step that restores the trailing
  // migrations this suite unwound in `before`.
  assert.equal((await migrate('up')).length, packageMigrations.length - 1 + trailingMigrations.length);
  assert.equal((await migrate('up')).length, 0);
  assert.deepEqual(await packageTables(), allPackageTables, 'later package migrations have applied too');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pgmigrations')).rows[0].n,
    allMigrations.length, 'the whole history is applied again');
  t.diagnostic('UP/DOWN/UP/no-op UP passed; existing hotel schema, rows and sequences unchanged');
});

// The ownership column, proved against real PostgreSQL: that it backfills an
// existing package as seed-owned, that its own DOWN takes nothing else with
// it, and that the package tables are untouched either way.
it('backfills seed_managed as true and reverses cleanly on its own', async t => {
  const columnCount = async () => (await client.query(`SELECT count(*)::int AS n
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='packages' AND column_name='seed_managed'`)).rows[0].n;

  // The ownership column is the subject, but node-pg-migrate unwinds
  // newest-first and everything above it — package-media, and now the
  // notification outbox — has to come off first. The step count is derived so
  // that stays true as migrations are added, and the same count goes back up
  // at the end.
  const ownershipSteps = stepsDownThrough(ownershipMigrationName);
  assert.equal((await migrate('down', ownershipSteps)).length, ownershipSteps);
  assert.equal(await columnCount(), 0, 'DOWN removes the column');
  assert.deepEqual(await packageTables(), tables, 'and leaves the tables it did not create');
  assert.deepEqual(await hotelSnapshot(), baseline, 'and touches nothing outside packages');

  // A package row that predates the column, so the backfill is real rather
  // than the column default acting on a fresh insert.
  const code = 'ITEST-OWNERSHIP';
  await client.query(
    `INSERT INTO packages (code, slug, title) VALUES ($1, 'itest-ownership', 'Ownership fixture')`,
    [code],
  );

  try {
    assert.equal((await migrate('up', ownershipSteps)).length, ownershipSteps);
    assert.equal(await columnCount(), 1, 'UP restores the column');

    const column = (await client.query(`SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='packages' AND column_name='seed_managed'`)).rows[0];
    assert.equal(column.data_type, 'boolean');
    assert.equal(column.is_nullable, 'NO');
    assert.match(String(column.column_default), /true/);

    const existing = (await client.query('SELECT seed_managed FROM packages WHERE code = $1', [code])).rows[0];
    assert.equal(existing.seed_managed, true, 'a package that predates the column is seed-owned');

    // Nothing else about the table moved.
    assert.deepEqual(await packageTables(), allPackageTables);
    assert.deepEqual(await hotelSnapshot(), baseline);
  } finally {
    await client.query('DELETE FROM packages WHERE code = $1', [code]);
  }

  t.diagnostic('seed_managed backfills true, is NOT NULL, and its DOWN removes only itself');
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

  // Reordering variants in place has to satisfy a NOT DEFERRABLE
  // UNIQUE(package_id, sort_order), which PostgreSQL checks as each row is
  // written rather than at statement end. The seed parks existing rows above
  // every value in use before writing the final 1..n positions.
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
        'SELECT id, key, sort_order FROM package_variants WHERE package_id = $1 ORDER BY key',
        [packageId],
      );
      return Object.fromEntries(rows.map((row) => [row.key, { id: row.id, sortOrder: row.sort_order }]));
    }

    async function addVariant(key: string, sortOrder: number): Promise<void> {
      await client.query(
        "INSERT INTO package_variants(package_id,key,label,is_default,sort_order) VALUES ($1,$2,$2,false,$3)",
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
      // The fixture variant is created at 0, which is valid under
      // CHECK (sort_order >= 0) and must not drag the base below the final range.
      const before = await variantsByKey();
      assert.equal(before.standard!.sortOrder, 0);

      await seedBrochurePackageCatalogue(client, [catalogueItem(['second', 'standard'])]);

      const after = await variantsByKey();
      assert.equal(after.second!.sortOrder, 1);
      assert.equal(after.standard!.sortOrder, 2);
      assert.equal(after.standard!.id, before.standard!.id);
    });

    it('reorders across sparse existing values that overlap the naive range', async () => {
      // The immediate-unique regression: with n = 2 a temporary range starting
      // at n + 1 would target 3, which `second` still holds when `standard` is
      // written. Parking above max(existing) is what makes this safe.
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

    it('relies on a constraint that is still checked immediately', async () => {
      const { rows } = await client.query<{ condeferrable: boolean; condeferred: boolean }>(
        "SELECT condeferrable, condeferred FROM pg_constraint WHERE conname = 'package_variants_package_sort_key'",
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.condeferrable, false, 'parking is only necessary while this stays immediate');
      assert.equal(rows[0]!.condeferred, false);
    });
  });
});

it('leaves zero package fixtures and preserves hotel schema, rows and sequence state', async t => {
  await assertNoFixtures();
  assert.deepEqual(await hotelSnapshot(), baseline);
  t.diagnostic('Zero fixture rows across all six package tables; hotel snapshot unchanged');
});
