import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { runner } from 'node-pg-migrate';

// Admin variant removal against real PostgreSQL.
//
// The unit suite models the transaction; this proves the two things only the
// database can settle, and they pull in opposite directions. Rate tiers must
// vanish with their variant through ON DELETE CASCADE, and a booked variant
// must be refused through ON DELETE RESTRICT — for every reservation status,
// because a cancelled booking holds the row exactly as a confirmed one does.
//
// Nothing is mocked: the repository is called exactly as the controller calls
// it, through the real pool. Every row this suite writes carries an
// identifier unique to the run, and exactly those rows are removed afterwards.

// Uses the dedicated migrated disposable cluster, never hotel development.
const target = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(process.env.PACKAGES_DISPOSABLE_TEST, '1');
assert.equal(target.hostname, '127.0.0.1');
assert.ok(target.port === '5434' || target.port === '55432');
assert.equal(target.pathname, '/hotel_reservation_packages_test');
assert.equal(target.search, '');

type Pool = typeof import('../src/db/pool.js');
type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ReferenceModule = typeof import('../src/modules/package-reservations/booking-reference.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let deleteAdminPackageVariant: RepositoryModule['deleteAdminPackageVariant'];
let generatePackageBookingReference: ReferenceModule['generatePackageBookingReference'];

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-VDEL-${runId}`;
const slugPrefix = `itest-vdel-${runId}`;

type StoredVariant = { id: string; key: string; sort_order: number; is_default: boolean };

async function storedVariants(packageId: string): Promise<StoredVariant[]> {
  const { rows } = await dbPool.query<StoredVariant>(
    `SELECT id, key, sort_order, is_default
       FROM package_variants
      WHERE package_id = $1
      ORDER BY sort_order, key`,
    [packageId],
  );

  return rows;
}

async function tierCount(variantId: string): Promise<number> {
  const { rows } = await dbPool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM package_rate_tiers WHERE variant_id = $1',
    [variantId],
  );

  return rows[0]!.n;
}

async function packageState(id: string): Promise<{ seed_managed: boolean; is_active: boolean }> {
  const { rows } = await dbPool.query<{ seed_managed: boolean; is_active: boolean }>(
    'SELECT seed_managed, is_active FROM packages WHERE id = $1',
    [id],
  );

  const row = rows[0];
  assert.ok(row, 'the fixture package should still exist');

  return row;
}

let sequence = 0;

/** One journey with the variants a test needs, each carrying two tiers. */
async function createFixture(options: {
  isActive?: boolean;
  seedManaged?: boolean;
  variants: Array<{ key: string; isDefault: boolean }>;
}): Promise<{ packageId: string; slug: string; code: string; idsByKey: Map<string, string> }> {
  sequence += 1;
  const code = `${codePrefix}-${sequence}`;
  const slug = `${slugPrefix}-${sequence}`;

  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO packages (
       code, slug, title, is_active, requires_price_confirmation, sort_order, seed_managed
     ) VALUES ($1, $2, 'Variant delete fixture', $3, false, 0, $4)
     RETURNING id`,
    [code, slug, options.isActive ?? false, options.seedManaged ?? true],
  );
  const packageId = rows[0]!.id;
  const idsByKey = new Map<string, string>();

  for (const [index, variant] of options.variants.entries()) {
    const { rows: variantRows } = await dbPool.query<{ id: string }>(
      `INSERT INTO package_variants (package_id, key, label, is_default, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [packageId, variant.key, `Label ${variant.key}`, variant.isDefault, index + 1],
    );
    const variantId = variantRows[0]!.id;
    idsByKey.set(variant.key, variantId);

    // Two tiers, so the cascade has more than one row to take.
    await dbPool.query(
      `INSERT INTO package_rate_tiers (
         variant_id, min_party_size, max_party_size, adult_unit_rate, currency
       ) VALUES ($1, 1, 2, '100.00', 'USD'), ($1, 3, NULL, '80.00', 'USD')`,
      [variantId],
    );
  }

  return { packageId, slug, code, idsByKey };
}

/**
 * One reservation against a variant, in the status asked for.
 *
 * Priced so the schema's own total CHECK is satisfied: 2 adults at 100.00,
 * no children, total 200.00 — the same shape the other integration suites use.
 */
async function bookVariant(
  fixture: { packageId: string; code: string },
  variantId: string,
  status: 'pending' | 'confirmed' | 'cancelled',
): Promise<void> {
  await dbPool.query(
    `INSERT INTO package_reservations (
       booking_reference, package_id, variant_id, tour_date, adults, children,
       guest_first_name, guest_last_name, guest_email, guest_phone, guest_country,
       status, pricing_status,
       package_code_snapshot, package_title_snapshot, variant_label_snapshot,
       currency, adult_unit_rate_snapshot, child_unit_rate_snapshot, total_amount_snapshot
     ) VALUES (
       $1, $2, $3, DATE '2026-10-01', 2, 0,
       'Amira', 'Hassan', 'amira@example.test', '+201000000000', 'Egypt',
       $4, 'quoted',
       $5, 'Variant delete fixture', 'Label booked',
       'USD', '100.00', NULL, '200.00'
     )`,
    [generatePackageBookingReference(), fixture.packageId, variantId, status, fixture.code],
  );
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));

  const version = (await dbPool.query<{ version: number }>(
    "SELECT current_setting('server_version_num')::int AS version",
  )).rows[0]!.version;
  assert.ok(
    (version >= 160000 && version < 170000) || (version >= 180000 && version < 190000),
    'PostgreSQL 16 or 18 required',
  );

  // UP only: the schema suite owns the destructive DOWN/UP lifecycle.
  await runner({
    databaseUrl: process.env.DATABASE_URL!,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    dir: path.resolve(__dirname, '../src/db/migrations'),
    log: () => undefined,
  });

  ({ deleteAdminPackageVariant } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ generatePackageBookingReference } = await import(
    '../src/modules/package-reservations/booking-reference.js'
  ));
});

after(async () => {
  // Reservations first: they reference variants with ON DELETE RESTRICT, so
  // nothing below them can go while they stand.
  await dbPool.query(
    `DELETE FROM package_reservations
      WHERE package_id IN (SELECT id FROM packages WHERE code LIKE $1)`,
    [`${codePrefix}%`],
  );
  await dbPool.query(
    `DELETE FROM package_rate_tiers
      WHERE variant_id IN (
        SELECT v.id FROM package_variants v
          JOIN packages p ON p.id = v.package_id
         WHERE p.code LIKE $1)`,
    [`${codePrefix}%`],
  );
  await dbPool.query(
    `DELETE FROM package_variants
      WHERE package_id IN (SELECT id FROM packages WHERE code LIKE $1)`,
    [`${codePrefix}%`],
  );
  await dbPool.query('DELETE FROM packages WHERE code LIKE $1', [`${codePrefix}%`]);

  const { rows } = await dbPool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM packages WHERE code LIKE $1',
    [`${codePrefix}%`],
  );
  assert.equal(rows[0]!.n, 0, 'every fixture this run created was removed');

  await closeDatabasePool();
});

describe('admin variant removal against PostgreSQL', () => {
  it('removes the variant and lets its rate tiers cascade away', async () => {
    const fixture = await createFixture({
      variants: [
        { key: 'alpha', isDefault: true },
        { key: 'beta', isDefault: false },
      ],
    });

    const removedId = fixture.idsByKey.get('beta')!;
    assert.equal(await tierCount(removedId), 2, 'the fixture priced it');

    const result = await deleteAdminPackageVariant(fixture.slug, 'beta');

    assert.equal(result.outcome, 'deleted');
    assert.deepEqual(
      (await storedVariants(fixture.packageId)).map((variant) => variant.key),
      ['alpha'],
    );
    assert.equal(await tierCount(removedId), 0, 'the tiers went with the variant');
  });

  it('leaves the surviving variant, its id, flag, position and tiers untouched', async () => {
    const fixture = await createFixture({
      variants: [
        { key: 'alpha', isDefault: true },
        { key: 'beta', isDefault: false },
        { key: 'gamma', isDefault: false },
      ],
    });

    const survivors = (await storedVariants(fixture.packageId))
      .filter((variant) => variant.key !== 'beta');

    await deleteAdminPackageVariant(fixture.slug, 'beta');

    assert.deepEqual(await storedVariants(fixture.packageId), survivors, 'nothing else moved');
    assert.equal(await tierCount(fixture.idsByKey.get('alpha')!), 2);
    assert.equal(await tierCount(fixture.idsByKey.get('gamma')!), 2);
  });

  it('does not compact the positions it leaves behind', async () => {
    const fixture = await createFixture({
      variants: [
        { key: 'alpha', isDefault: true },
        { key: 'beta', isDefault: false },
        { key: 'gamma', isDefault: false },
      ],
    });

    await deleteAdminPackageVariant(fixture.slug, 'beta');

    assert.deepEqual(
      (await storedVariants(fixture.packageId)).map((variant) => variant.sort_order),
      [1, 3],
      'the gap is legal; closing it belongs to the reordering endpoint',
    );
  });

  it('refuses the leading variant while others remain', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      variants: [
        { key: 'alpha', isDefault: true },
        { key: 'beta', isDefault: false },
      ],
    });

    const before = await storedVariants(fixture.packageId);

    const result = await deleteAdminPackageVariant(fixture.slug, 'alpha');

    assert.equal(result.outcome, 'variant-is-default');
    assert.deepEqual(await storedVariants(fixture.packageId), before, 'nothing was removed');
    assert.equal((await packageState(fixture.packageId)).seed_managed, true);
  });

  it('allows removing the final variant even though it leads the journey', async () => {
    const fixture = await createFixture({
      variants: [{ key: 'alpha', isDefault: true }],
    });

    const result = await deleteAdminPackageVariant(fixture.slug, 'alpha');

    assert.equal(result.outcome, 'deleted');
    assert.deepEqual(await storedVariants(fixture.packageId), [], 'a journey with no variants');
    assert.equal(await tierCount(fixture.idsByKey.get('alpha')!), 0);

    if (result.outcome !== 'deleted') return;
    assert.equal(result.package.variantCount, 0);
    assert.equal(result.package.defaultVariantLabel, null);
  });

  it('refuses a booked variant whatever the booking status', async () => {
    for (const status of ['pending', 'confirmed', 'cancelled'] as const) {
      const fixture = await createFixture({
        seedManaged: true,
        variants: [
          { key: 'alpha', isDefault: true },
          { key: 'beta', isDefault: false },
        ],
      });

      await bookVariant(fixture, fixture.idsByKey.get('beta')!, status);

      const result = await deleteAdminPackageVariant(fixture.slug, 'beta');

      assert.equal(
        result.outcome,
        'variant-has-reservations',
        `a ${status} booking must hold the variant`,
      );
      assert.equal(
        (await storedVariants(fixture.packageId)).length,
        2,
        `${status}: nothing was removed`,
      );
      assert.equal(await tierCount(fixture.idsByKey.get('beta')!), 2, `${status}: tiers intact`);
      assert.equal(
        (await packageState(fixture.packageId)).seed_managed,
        true,
        `${status}: ownership did not move`,
      );
    }
  });

  it('refuses a live journey without touching it', async () => {
    const fixture = await createFixture({
      isActive: true,
      seedManaged: true,
      variants: [
        { key: 'alpha', isDefault: true },
        { key: 'beta', isDefault: false },
      ],
    });

    const result = await deleteAdminPackageVariant(fixture.slug, 'beta');

    assert.equal(result.outcome, 'package-active');
    assert.equal((await storedVariants(fixture.packageId)).length, 2);

    const state = await packageState(fixture.packageId);
    assert.equal(state.is_active, true, 'the journey was not deactivated for them');
    assert.equal(state.seed_managed, true);
  });

  it('takes ownership only on a real removal', async () => {
    const removed = await createFixture({
      seedManaged: true,
      variants: [
        { key: 'alpha', isDefault: true },
        { key: 'beta', isDefault: false },
      ],
    });

    await deleteAdminPackageVariant(removed.slug, 'beta');
    assert.equal((await packageState(removed.packageId)).seed_managed, false);

    const refused = await createFixture({
      seedManaged: true,
      variants: [
        { key: 'alpha', isDefault: true },
        { key: 'beta', isDefault: false },
      ],
    });

    assert.equal(
      (await deleteAdminPackageVariant(refused.slug, 'no-such-variant')).outcome,
      'variant-not-found',
    );
    assert.equal(
      (await packageState(refused.packageId)).seed_managed,
      true,
      'a mistyped key must not detach a journey',
    );
  });

  it('answers a repeated removal with variant-not-found', async () => {
    const fixture = await createFixture({
      variants: [
        { key: 'alpha', isDefault: true },
        { key: 'beta', isDefault: false },
      ],
    });

    assert.equal((await deleteAdminPackageVariant(fixture.slug, 'beta')).outcome, 'deleted');
    assert.equal((await deleteAdminPackageVariant(fixture.slug, 'beta')).outcome, 'variant-not-found');
  });

  it('answers a journey nothing matches', async () => {
    const result = await deleteAdminPackageVariant(`${slugPrefix}-absent`, 'alpha');

    assert.equal(result.outcome, 'package-not-found');
  });
});
