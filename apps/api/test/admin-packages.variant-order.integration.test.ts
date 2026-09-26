import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { runner } from 'node-pg-migrate';

// Admin variant reordering against real PostgreSQL.
//
// The unit suite models the two-pass renumber; this proves the part only the
// database can settle — that `package_variants_package_sort_key`, a
// non-deferrable UNIQUE (package_id, sort_order), is never tripped by any
// arrangement. It also proves what a fake cannot: that variant ids survive,
// so a reservation taken before the reorder still points at the variant it
// was taken against, and that the ON DELETE RESTRICT reference is never put
// to the test because nothing is ever deleted.
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
let reorderAdminPackageVariants: RepositoryModule['reorderAdminPackageVariants'];
let generatePackageBookingReference: ReferenceModule['generatePackageBookingReference'];

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-VORDER-${runId}`;
const slugPrefix = `itest-vorder-${runId}`;

type StoredVariant = { id: string; key: string; sort_order: number; is_default: boolean };

/** A journey's variants in the catalogue's own order. */
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

/** One journey with the variants a test needs, each priced. */
async function createFixture(options: {
  isActive?: boolean;
  seedManaged?: boolean;
  variants: Array<{ key: string; sortOrder: number }>;
}): Promise<{ packageId: string; slug: string; idsByKey: Map<string, string> }> {
  sequence += 1;
  const code = `${codePrefix}-${sequence}`;
  const slug = `${slugPrefix}-${sequence}`;

  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO packages (
       code, slug, title, is_active, requires_price_confirmation, sort_order, seed_managed
     ) VALUES ($1, $2, 'Variant order fixture', $3, false, 0, $4)
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
      [packageId, variant.key, `Label ${variant.key}`, index === 0, variant.sortOrder],
    );
    const variantId = variantRows[0]!.id;
    idsByKey.set(variant.key, variantId);

    await dbPool.query(
      `INSERT INTO package_rate_tiers (
         variant_id, min_party_size, max_party_size, adult_unit_rate, currency
       ) VALUES ($1, 1, NULL, '100.00', 'USD')`,
      [variantId],
    );
  }

  return { packageId, slug, idsByKey };
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

  ({ reorderAdminPackageVariants } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));

  // The real generator, so the reference satisfies the schema's own format
  // CHECK rather than a hand-made string that happens to look like one.
  ({ generatePackageBookingReference } = await import(
    '../src/modules/package-reservations/booking-reference.js'
  ));
});

after(async () => {
  // Reservations first: they reference variants with ON DELETE RESTRICT.
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

describe('admin variant reordering against PostgreSQL', () => {
  it('swaps two variants without tripping the unique index', async () => {
    const fixture = await createFixture({
      variants: [{ key: 'alpha', sortOrder: 1 }, { key: 'beta', sortOrder: 2 }],
    });

    const result = await reorderAdminPackageVariants(fixture.slug, ['beta', 'alpha']);

    assert.equal(result.outcome, 'reordered');

    const variants = await storedVariants(fixture.packageId);
    assert.deepEqual(variants.map((variant) => variant.key), ['beta', 'alpha']);
    assert.deepEqual(variants.map((variant) => variant.sort_order), [1, 2]);
  });

  it('reverses three variants', async () => {
    const fixture = await createFixture({
      variants: [
        { key: 'alpha', sortOrder: 1 },
        { key: 'beta', sortOrder: 2 },
        { key: 'gamma', sortOrder: 3 },
      ],
    });

    const result = await reorderAdminPackageVariants(fixture.slug, ['gamma', 'beta', 'alpha']);

    assert.equal(result.outcome, 'reordered');

    const variants = await storedVariants(fixture.packageId);
    assert.deepEqual(variants.map((variant) => variant.key), ['gamma', 'beta', 'alpha']);
    assert.deepEqual(variants.map((variant) => variant.sort_order), [1, 2, 3]);
  });

  it('closes gaps in a sparse set, landing on exactly 1..n', async () => {
    const fixture = await createFixture({
      variants: [
        { key: 'alpha', sortOrder: 0 },
        { key: 'beta', sortOrder: 9 },
        { key: 'gamma', sortOrder: 40 },
      ],
    });

    await reorderAdminPackageVariants(fixture.slug, ['gamma', 'alpha', 'beta']);

    const variants = await storedVariants(fixture.packageId);
    assert.deepEqual(variants.map((variant) => variant.sort_order), [1, 2, 3]);
    assert.deepEqual(variants.map((variant) => variant.key), ['gamma', 'alpha', 'beta']);
  });

  it('survives every arrangement of four variants', async () => {
    // Exhaustive over a small set: the parking pass must work whatever the
    // permutation, not merely for the rotations a hand-written test picks.
    const keys = ['alpha', 'beta', 'gamma', 'delta'];
    const permutations = (input: string[]): string[][] =>
      input.length <= 1
        ? [input]
        : input.flatMap((key, index) =>
          permutations([...input.slice(0, index), ...input.slice(index + 1)])
            .map((rest) => [key, ...rest]));

    for (const order of permutations(keys)) {
      const fixture = await createFixture({
        variants: keys.map((key, index) => ({ key, sortOrder: index + 1 })),
      });

      const result = await reorderAdminPackageVariants(fixture.slug, order);

      assert.ok(
        result.outcome === 'reordered' || result.outcome === 'unchanged',
        `${order.join(',')} should be accepted`,
      );

      const variants = await storedVariants(fixture.packageId);
      assert.deepEqual(variants.map((variant) => variant.key), order, order.join(','));
      assert.deepEqual(variants.map((variant) => variant.sort_order), [1, 2, 3, 4]);
    }
  });

  it('preserves variant ids, so a reservation still points at its variant', async () => {
    const fixture = await createFixture({
      variants: [
        { key: 'alpha', sortOrder: 1 },
        { key: 'beta', sortOrder: 2 },
        { key: 'gamma', sortOrder: 3 },
      ],
    });

    const bookedVariantId = fixture.idsByKey.get('alpha')!;
    const bookingReference = generatePackageBookingReference();

    // The same shape the admin reservation-status suite uses: every NOT NULL
    // column supplied, and priced so the schema's own total CHECK is
    // satisfied — 2 adults at 100.00, no children, total 200.00.
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
         'pending', 'quoted',
         $4, 'Variant order fixture', 'Label alpha',
         'USD', '100.00', NULL, '200.00'
       )`,
      [bookingReference, fixture.packageId, bookedVariantId, `${codePrefix}-${sequence}`],
    );

    await reorderAdminPackageVariants(fixture.slug, ['gamma', 'beta', 'alpha']);

    const variants = await storedVariants(fixture.packageId);
    assert.deepEqual(
      new Set(variants.map((variant) => variant.id)),
      new Set([...fixture.idsByKey.values()]),
      'the same rows, moved rather than replaced',
    );

    const { rows } = await dbPool.query<Record<string, unknown>>(
      `SELECT variant_id, package_id, variant_label_snapshot, package_code_snapshot,
              package_title_snapshot, adults, children, tour_date::text AS tour_date,
              adult_unit_rate_snapshot::text AS adult_unit_rate_snapshot,
              total_amount_snapshot::text AS total_amount_snapshot, currency, pricing_status
         FROM package_reservations
        WHERE booking_reference = $1`,
      [bookingReference],
    );

    const reservation = rows[0]!;

    assert.equal(reservation.variant_id, bookedVariantId, 'still the variant that was booked');
    assert.equal(reservation.package_id, fixture.packageId);

    // Every historical snapshot, exactly as it was taken. A reorder rewrites
    // positions and nothing else.
    assert.deepEqual(reservation.variant_label_snapshot, 'Label alpha');
    assert.deepEqual(reservation.package_title_snapshot, 'Variant order fixture');
    assert.deepEqual(reservation.adults, 2);
    assert.deepEqual(reservation.children, 0);
    assert.deepEqual(reservation.tour_date, '2026-10-01');
    assert.deepEqual(reservation.adult_unit_rate_snapshot, '100.00');
    assert.deepEqual(reservation.total_amount_snapshot, '200.00');
    assert.deepEqual(reservation.currency, 'USD');
    assert.deepEqual(reservation.pricing_status, 'quoted');
  });

  it('leaves the default flag where it was', async () => {
    const fixture = await createFixture({
      variants: [{ key: 'alpha', sortOrder: 1 }, { key: 'beta', sortOrder: 2 }],
    });

    await reorderAdminPackageVariants(fixture.slug, ['beta', 'alpha']);

    const variants = await storedVariants(fixture.packageId);
    assert.deepEqual(
      variants.filter((variant) => variant.is_default).map((variant) => variant.key),
      ['alpha'],
      'moving a variant down must not change what an unqualified booking resolves to',
    );
  });

  it('rearranges a live journey without deactivating it', async () => {
    const fixture = await createFixture({
      isActive: true,
      variants: [{ key: 'alpha', sortOrder: 1 }, { key: 'beta', sortOrder: 2 }],
    });

    const result = await reorderAdminPackageVariants(fixture.slug, ['beta', 'alpha']);

    assert.equal(result.outcome, 'reordered');
    assert.equal((await packageState(fixture.packageId)).is_active, true);
  });

  it('takes ownership on a real reorder and leaves it alone on a no-op', async () => {
    const changed = await createFixture({
      seedManaged: true,
      variants: [{ key: 'alpha', sortOrder: 1 }, { key: 'beta', sortOrder: 2 }],
    });

    await reorderAdminPackageVariants(changed.slug, ['beta', 'alpha']);
    assert.equal((await packageState(changed.packageId)).seed_managed, false);

    const untouched = await createFixture({
      seedManaged: true,
      variants: [{ key: 'alpha', sortOrder: 1 }, { key: 'beta', sortOrder: 2 }],
    });

    const result = await reorderAdminPackageVariants(untouched.slug, ['alpha', 'beta']);

    assert.equal(result.outcome, 'unchanged');
    assert.equal(
      (await packageState(untouched.packageId)).seed_managed,
      true,
      'nothing diverged, so ownership did not move',
    );
  });

  it('refuses a stale list without moving anything', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      variants: [
        { key: 'alpha', sortOrder: 1 },
        { key: 'beta', sortOrder: 2 },
        { key: 'gamma', sortOrder: 3 },
      ],
    });

    const before = await storedVariants(fixture.packageId);

    assert.equal(
      (await reorderAdminPackageVariants(fixture.slug, ['gamma', 'alpha'])).outcome,
      'set-mismatch',
    );
    assert.equal(
      (await reorderAdminPackageVariants(fixture.slug, ['gamma', 'beta', 'alpha', 'delta'])).outcome,
      'variant-not-found',
    );

    assert.deepEqual(await storedVariants(fixture.packageId), before, 'not one row moved');
    assert.equal((await packageState(fixture.packageId)).seed_managed, true);
  });

  it('answers a journey nothing matches', async () => {
    const result = await reorderAdminPackageVariants(`${slugPrefix}-absent`, ['alpha']);

    assert.equal(result.outcome, 'package-not-found');
  });
});
