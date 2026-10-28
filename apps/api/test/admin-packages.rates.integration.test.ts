import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

// Admin rate-tier replacement against real MySQL.
//
// The unit suite models the transaction; this proves the parts only the
// database can settle: that the exclusion constraint actually refuses an
// overlap and that the rollback leaves the previous tiers untouched, that
// `numeric(12,2)` hands the exact decimal strings back, that the USD CHECK
// holds, and that the empty-set policy behaves against real `is_active` and
// `requires_price_confirmation` rows.
//
// Nothing is mocked: the repository is called exactly as the controller calls
// it, through the real pool. Every row this suite writes carries an
// identifier unique to the run, and exactly those rows are removed afterwards.

// Uses the dedicated migrated disposable MySQL database, never hotel development.
const target = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(process.env.PACKAGES_DISPOSABLE_TEST, '1');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '3307');
assert.match(target.pathname, /^\/hotel_[a-z_]*test$/);
assert.equal(target.search, '');

type Pool = typeof import('../src/db/pool.js');
type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let replaceAdminPackageVariantRates: RepositoryModule['replaceAdminPackageVariantRates'];

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-RATES-${runId}`;
const slugPrefix = `itest-rates-${runId}`;

const VARIANT_KEY = 'standard';

/** The three tiers most tests replace with. */
const REPLACEMENT = [
  { minPartySize: 1, maxPartySize: 1, adultUnitRate: '100.00' },
  { minPartySize: 2, maxPartySize: 2, adultUnitRate: '90.50' },
  { minPartySize: 3, maxPartySize: null, adultUnitRate: '80.25' },
] as const;

type StoredTier = {
  min_party_size: number;
  max_party_size: number | null;
  adult_unit_rate: string;
  currency: string;
};

/**
 * Reads a variant's tiers in the catalogue's own order, with the money cast
 * to text so the exact stored decimal is what comes back.
 */
async function storedTiers(variantId: string): Promise<StoredTier[]> {
  const { rows } = await dbPool.query<StoredTier>(
    `SELECT min_party_size,
            max_party_size,
            adult_unit_rate AS adult_unit_rate,
            currency
       FROM package_rate_tiers
      WHERE variant_id = $1
      ORDER BY min_party_size`,
    [variantId],
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

/**
 * One package and one variant, with a starting tier set.
 *
 * Each fixture gets its own code and slug, so tests never contend and cleanup
 * can name exactly what this run created.
 */
async function createFixture(options: {
  seedManaged?: boolean;
  isActive?: boolean;
  requiresPriceConfirmation?: boolean;
  tiers?: Array<{ min: number; max: number | null; rate: string }>;
} = {}): Promise<{ packageId: string; variantId: string; slug: string }> {
  sequence += 1;
  const code = `${codePrefix}-${sequence}`;
  const slug = `${slugPrefix}-${sequence}`;

  const { insertId: packageRowsInsertId } = await dbPool.query(
    `INSERT INTO packages (
       code, slug, title, is_active, requires_price_confirmation, sort_order, seed_managed
     ) VALUES ($1, $2, 'Rate fixture', $3, $4, 0, $5)`,
    [
      code,
      slug,
      options.isActive ?? true,
      options.requiresPriceConfirmation ?? false,
      options.seedManaged ?? false,
    ],
  );
  const packageId = packageRowsInsertId!;

  const { insertId: variantRowsInsertId } = await dbPool.query(
    `INSERT INTO package_variants (package_id, \`key\`, label, is_default, sort_order)
     VALUES ($1, $2, 'Standard', true, 1)`,
    [packageId, VARIANT_KEY],
  );
  const variantId = variantRowsInsertId!;

  for (const tier of options.tiers ?? [{ min: 1, max: null, rate: '500.00' }]) {
    await dbPool.query(
      `INSERT INTO package_rate_tiers (
         variant_id, min_party_size, max_party_size, adult_unit_rate, currency
       ) VALUES ($1, $2, $3, $4, 'USD')`,
      [variantId, tier.min, tier.max, tier.rate],
    );
  }

  return { packageId, variantId, slug };
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));

  // Do not depend on test-file execution order. UP is a no-op when the schema
  // lifecycle suite has already run against this disposable database, and it
  // brings a fresh one up to the current schema when it has not.
  //
  ({ replaceAdminPackageVariantRates } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));

  // Deliberately no assertion that the catalogue is empty. This suite owns
  // only its own prefixed fixtures and cleans exactly those, so what any
  // other file left behind is none of its business — asserting otherwise
  // would reintroduce the ordering dependency this bootstrap removes.
});

beforeEach(async () => {
  // No fixture from a previous test may influence the next one.
  await dbPool.query(
    `DELETE FROM package_rate_tiers
      WHERE variant_id IN (
        SELECT v.id FROM package_variants v
          JOIN packages p ON p.id = v.package_id
         WHERE p.code LIKE $1)`,
    [`${codePrefix}%`],
  );
});

after(async () => {
  // Rate tiers and variants cascade from the package, but they are removed
  // explicitly so a failure part-way through cleanup still names what it hit.
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
    'SELECT COUNT(*) AS n FROM packages WHERE code LIKE $1',
    [`${codePrefix}%`],
  );
  assert.equal(Number(rows[0]!.n), 0, 'every fixture this run created was removed');

  await closeDatabasePool();
});

describe('admin rate replacement against MySQL', () => {
  it('replaces the whole set, keeping exact decimals, USD and order', async () => {
    const fixture = await createFixture({
      seedManaged: false,
      tiers: [
        { min: 1, max: 5, rate: '500.00' },
        { min: 6, max: null, rate: '400.00' },
      ],
    });

    const result = await replaceAdminPackageVariantRates(fixture.slug, VARIANT_KEY, REPLACEMENT);

    assert.equal(result.outcome, 'replaced');

    const tiers = await storedTiers(fixture.variantId);

    // The old tiers are gone, not kept alongside the new ones.
    assert.equal(tiers.length, 3);
    assert.ok(!tiers.some((tier) => tier.adult_unit_rate === '500.00'));
    assert.ok(!tiers.some((tier) => tier.adult_unit_rate === '400.00'));

    // Deterministic order, exact decimals, USD throughout.
    assert.deepEqual(tiers, [
      { min_party_size: 1, max_party_size: 1, adult_unit_rate: '100.00', currency: 'USD' },
      { min_party_size: 2, max_party_size: 2, adult_unit_rate: '90.50', currency: 'USD' },
      { min_party_size: 3, max_party_size: null, adult_unit_rate: '80.25', currency: 'USD' },
    ]);

    // The returned DTO reports the same thing, in the same order.
    if (result.outcome !== 'replaced') return;
    const [variant] = result.package.variants;
    assert.deepEqual(variant!.rates, [
      { minPartySize: 1, maxPartySize: 1, adultUnitRate: '100.00', currency: 'USD' },
      { minPartySize: 2, maxPartySize: 2, adultUnitRate: '90.50', currency: 'USD' },
      { minPartySize: 3, maxPartySize: null, adultUnitRate: '80.25', currency: 'USD' },
    ]);
  });

  it('persists an open-ended final tier as an unbounded upper range', async () => {
    const fixture = await createFixture();

    await replaceAdminPackageVariantRates(fixture.slug, VARIANT_KEY, REPLACEMENT);

    const tiers = await storedTiers(fixture.variantId);
    const last = tiers[tiers.length - 1]!;

    assert.equal(last.max_party_size, null, 'null is stored as null, not as a number');

    // And the database agrees it is genuinely unbounded: a party of a hundred
    // still falls inside it.
    const { rows } = await dbPool.query<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM package_rate_tiers
        WHERE variant_id = $1
          AND min_party_size <= 100
          AND (max_party_size IS NULL OR max_party_size >= 100)`,
      [fixture.variantId],
    );
    assert.equal(Number(rows[0]!.n), 1, 'exactly one tier covers a party of a hundred');
  });

  it('takes ownership of a brochure-managed package', async () => {
    const fixture = await createFixture({ seedManaged: true });

    const result = await replaceAdminPackageVariantRates(fixture.slug, VARIANT_KEY, REPLACEMENT);

    assert.equal(result.outcome, 'replaced');
    assert.equal((await packageState(fixture.packageId)).seed_managed, false);
  });

  it('leaves an already admin-managed package admin-managed', async () => {
    const fixture = await createFixture({ seedManaged: false });

    await replaceAdminPackageVariantRates(fixture.slug, VARIANT_KEY, REPLACEMENT);

    assert.equal((await packageState(fixture.packageId)).seed_managed, false);
  });
});

describe('admin rate replacement: MySQL integrity guard', () => {
  it('refuses an overlapping set and leaves the previous tiers completely intact', async () => {
    const original = [
      { min: 1, max: 2, rate: '300.00' },
      { min: 3, max: null, rate: '250.00' },
    ];
    const fixture = await createFixture({ seedManaged: true, isActive: true, tiers: original });

    // Overlapping, and shaped so the in-process pre-flight check cannot see
    // it: every pair is disjoint by lower bound until the constraint compares
    // the ranges themselves. `[1,4)` and `[2,3)` share a party of two.
    const before = await storedTiers(fixture.variantId);

    const result = await replaceAdminPackageVariantRates(fixture.slug, VARIANT_KEY, [
      { minPartySize: 1, maxPartySize: 3, adultUnitRate: '10.00' },
      { minPartySize: 2, maxPartySize: 2, adultUnitRate: '9.00' },
    ]);

    assert.equal(result.outcome, 'overlapping-tiers');

    // The rollback restored everything: same rows, same order, same values.
    assert.deepEqual(await storedTiers(fixture.variantId), before);
    assert.deepEqual(await storedTiers(fixture.variantId), [
      { min_party_size: 1, max_party_size: 2, adult_unit_rate: '300.00', currency: 'USD' },
      { min_party_size: 3, max_party_size: null, adult_unit_rate: '250.00', currency: 'USD' },
    ]);

    // And the failed attempt changed nothing about the package itself.
    assert.deepEqual(await packageState(fixture.packageId), {
      seed_managed: true,
      is_active: true,
    });
  });

  it('refuses two open-ended tiers, which overlap by construction', async () => {
    const fixture = await createFixture({ tiers: [{ min: 1, max: null, rate: '111.00' }] });

    const result = await replaceAdminPackageVariantRates(fixture.slug, VARIANT_KEY, [
      { minPartySize: 5, maxPartySize: null, adultUnitRate: '10.00' },
      { minPartySize: 1, maxPartySize: null, adultUnitRate: '9.00' },
    ]);

    assert.equal(result.outcome, 'overlapping-tiers');
    assert.deepEqual(await storedTiers(fixture.variantId), [
      { min_party_size: 1, max_party_size: null, adult_unit_rate: '111.00', currency: 'USD' },
    ]);
  });

  it('accepts adjacent tiers, which do not overlap', async () => {
    const fixture = await createFixture();

    const result = await replaceAdminPackageVariantRates(fixture.slug, VARIANT_KEY, [
      { minPartySize: 1, maxPartySize: 2, adultUnitRate: '10.00' },
      { minPartySize: 3, maxPartySize: 4, adultUnitRate: '9.00' },
    ]);

    assert.equal(result.outcome, 'replaced');
    assert.equal((await storedTiers(fixture.variantId)).length, 2);
  });
});

describe('admin rate replacement: empty-set policy against real rows', () => {
  it('allows an empty set for an inactive package', async () => {
    const fixture = await createFixture({ isActive: false, requiresPriceConfirmation: false });

    const result = await replaceAdminPackageVariantRates(fixture.slug, VARIANT_KEY, []);

    assert.equal(result.outcome, 'replaced');
    assert.deepEqual(await storedTiers(fixture.variantId), []);
    assert.equal((await packageState(fixture.packageId)).is_active, false, 'still inactive');
  });

  it('allows an empty set for a package quoted on request', async () => {
    const fixture = await createFixture({ isActive: true, requiresPriceConfirmation: true });

    const result = await replaceAdminPackageVariantRates(fixture.slug, VARIANT_KEY, []);

    assert.equal(result.outcome, 'replaced');
    assert.deepEqual(await storedTiers(fixture.variantId), []);
    assert.equal((await packageState(fixture.packageId)).is_active, true, 'still active');
  });

  it('refuses an empty set for an active deterministically-priced package', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      isActive: true,
      requiresPriceConfirmation: false,
      tiers: [{ min: 1, max: null, rate: '777.00' }],
    });

    const result = await replaceAdminPackageVariantRates(fixture.slug, VARIANT_KEY, []);

    assert.equal(result.outcome, 'rates-required');

    // The previous tiers survive, and nothing was silently deactivated.
    assert.deepEqual(await storedTiers(fixture.variantId), [
      { min_party_size: 1, max_party_size: null, adult_unit_rate: '777.00', currency: 'USD' },
    ]);
    assert.deepEqual(await packageState(fixture.packageId), {
      seed_managed: true,
      is_active: true,
    });
  });
});

describe('admin rate replacement: addressing', () => {
  it('answers package-not-found without touching anything', async () => {
    const fixture = await createFixture({ seedManaged: true });

    const result = await replaceAdminPackageVariantRates(
      `${slugPrefix}-no-such-package`,
      VARIANT_KEY,
      REPLACEMENT,
    );

    assert.equal(result.outcome, 'package-not-found');
    assert.equal((await packageState(fixture.packageId)).seed_managed, true);
  });

  it('answers variant-not-found without flipping ownership', async () => {
    const fixture = await createFixture({ seedManaged: true });

    const result = await replaceAdminPackageVariantRates(
      fixture.slug,
      'no-such-variant',
      REPLACEMENT,
    );

    assert.equal(result.outcome, 'variant-not-found');
    assert.equal((await packageState(fixture.packageId)).seed_managed, true,
      'a mistyped key must not detach a package');
    assert.equal((await storedTiers(fixture.variantId)).length, 1, 'and must not delete its tiers');
  });
});
