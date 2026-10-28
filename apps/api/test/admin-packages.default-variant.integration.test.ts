import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// Admin default-variant switching against real MySQL.
//
// The unit suite models the transaction; this proves the parts only the
// database can settle. Chiefly it proves the partial unique index
// `package_variants_one_default_per_package_idx` is never violated: the
// clear-then-set order is asserted here by the index itself refusing anything
// else, and two simultaneous switches on one journey are made to serialize
// through the package lock rather than both claiming the flag.
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
let setAdminPackageDefaultVariant: RepositoryModule['setAdminPackageDefaultVariant'];

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-DEFVAR-${runId}`;
const slugPrefix = `itest-defvar-${runId}`;

type StoredVariant = {
  key: string;
  label: string;
  is_default: boolean;
  sort_order: number;
  child_discount_percent: string | null;
};

/** A journey's variants in the catalogue's own order. */
async function storedVariants(packageId: string): Promise<StoredVariant[]> {
  const { rows } = await dbPool.query<StoredVariant>(
    `SELECT \`key\`,
            label,
            is_default,
            sort_order,
            child_discount_percent AS child_discount_percent
       FROM package_variants
      WHERE package_id = $1
      ORDER BY sort_order, \`key\``,
    [packageId],
  );

  return rows;
}

/**
 * How many variants of this journey hold the flag.
 *
 * Counted in the database rather than derived from the rows above, because
 * this is the invariant the partial unique index exists to protect and it
 * should be asked of the index's own table directly.
 */
async function defaultCount(packageId: string): Promise<number> {
  const { rows } = await dbPool.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM package_variants WHERE package_id = $1 AND is_default',
    [packageId],
  );

  return Number(rows[0]!.n);
}

async function packageState(id: string): Promise<{
  seed_managed: boolean;
  is_active: boolean;
  updated_at: string;
}> {
  const { rows } = await dbPool.query<{
    seed_managed: boolean;
    is_active: boolean;
    updated_at: string;
  }>(
    'SELECT seed_managed, is_active, CAST(updated_at AS CHAR) AS updated_at FROM packages WHERE id = $1',
    [id],
  );

  const row = rows[0];
  assert.ok(row, 'the fixture package should still exist');

  return row;
}

async function storedTiers(packageId: string): Promise<Array<{
  key: string;
  min_party_size: number;
  max_party_size: number | null;
  adult_unit_rate: string;
}>> {
  const { rows } = await dbPool.query<{
    key: string;
    min_party_size: number;
    max_party_size: number | null;
    adult_unit_rate: string;
  }>(
    `SELECT v.\`key\`,
            r.min_party_size,
            r.max_party_size,
            r.adult_unit_rate AS adult_unit_rate
       FROM package_rate_tiers r
       JOIN package_variants v ON v.id = r.variant_id
      WHERE v.package_id = $1
      ORDER BY v.\`key\`, r.min_party_size`,
    [packageId],
  );

  return rows;
}

let sequence = 0;

/**
 * One journey with the variants a test needs, each priced.
 *
 * Each fixture gets its own code and slug, so tests never contend — which
 * matters more here than elsewhere, because one of them deliberately runs two
 * switches at once — and cleanup can name exactly what this run created.
 *
 * Inactive and brochure-owned by default: those are the states the rules
 * under test actually turn on.
 */
async function createFixture(options: {
  isActive?: boolean;
  seedManaged?: boolean;
  variants: Array<{ key: string; isDefault: boolean; sortOrder: number }>;
}): Promise<{ packageId: string; slug: string }> {
  sequence += 1;
  const code = `${codePrefix}-${sequence}`;
  const slug = `${slugPrefix}-${sequence}`;

  const { insertId: rowsInsertId } = await dbPool.query(
    `INSERT INTO packages (
       code, slug, title, is_active, requires_price_confirmation, sort_order, seed_managed
     ) VALUES ($1, $2, 'Default variant fixture', $3, false, 0, $4)`,
    [code, slug, options.isActive ?? false, options.seedManaged ?? true],
  );
  const packageId = rowsInsertId!;

  for (const variant of options.variants) {
    const { insertId: variantRowsInsertId } = await dbPool.query(
      `INSERT INTO package_variants (
         package_id, \`key\`, label, is_default, sort_order,
         child_min_age, child_max_age, child_discount_percent
       ) VALUES ($1, $2, $3, $4, $5, 6, 12, '33.33')`,
      [packageId, variant.key, `Label ${variant.key}`, variant.isDefault, variant.sortOrder],
    );

    // Priced, so a switch can be shown not to disturb the rates.
    await dbPool.query(
      `INSERT INTO package_rate_tiers (
         variant_id, min_party_size, max_party_size, adult_unit_rate, currency
       ) VALUES ($1, 1, NULL, $2, 'USD')`,
      [variantRowsInsertId!, `10${variant.sortOrder}.00`],
    );
  }

  return { packageId, slug };
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));

  // Do not depend on test-file execution order. UP is a no-op when the schema
  // lifecycle suite has already run against this disposable database, and it
  // brings a fresh one up to the current schema when it has not.
  //
  ({ setAdminPackageDefaultVariant } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
});

// No beforeEach reset: every test builds its own prefixed fixture and reads
// only that one, so there is nothing shared to clear between them.

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

describe('admin default variant against MySQL', () => {
  it('moves the default from one variant to another', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      variants: [
        { key: 'alpha', isDefault: true, sortOrder: 1 },
        { key: 'beta', isDefault: false, sortOrder: 2 },
      ],
    });

    const before = await packageState(fixture.packageId);
    const tiersBefore = await storedTiers(fixture.packageId);

    const result = await setAdminPackageDefaultVariant(fixture.slug, 'beta');

    assert.equal(result.outcome, 'updated');

    const variants = await storedVariants(fixture.packageId);
    assert.deepEqual(
      variants.map((variant) => [variant.key, variant.is_default]),
      [['alpha', false], ['beta', true]],
      'the old default is cleared and the new one set',
    );

    // The invariant the partial unique index exists to protect.
    assert.equal(await defaultCount(fixture.packageId), 1);

    const state = await packageState(fixture.packageId);
    assert.equal(state.seed_managed, false, 'the seed must stop reconciling it');
    assert.equal(state.is_active, false, 'publication is untouched');
    assert.notEqual(state.updated_at, before.updated_at, 'a real change is recorded');

    // Nothing but the flag moved.
    assert.deepEqual(
      variants.map((variant) => [variant.key, variant.sort_order, variant.label]),
      [['alpha', 1, 'Label alpha'], ['beta', 2, 'Label beta']],
    );
    assert.deepEqual(
      variants.map((variant) => variant.child_discount_percent),
      ['33.33', '33.33'],
      'child pricing is untouched, to the exact decimal',
    );
    assert.deepEqual(await storedTiers(fixture.packageId), tiersBefore, 'rates are untouched');
  });

  it('repairs a journey whose only variant is not the default', async () => {
    const fixture = await createFixture({
      variants: [{ key: 'alpha', isDefault: false, sortOrder: 1 }],
    });

    const result = await setAdminPackageDefaultVariant(fixture.slug, 'alpha');

    assert.equal(result.outcome, 'updated');
    assert.equal(await defaultCount(fixture.packageId), 1);
    assert.equal((await storedVariants(fixture.packageId))[0]!.is_default, true);
    assert.equal((await packageState(fixture.packageId)).seed_managed, false);
  });

  it('repairs several variants that have no default at all', async () => {
    const fixture = await createFixture({
      variants: [
        { key: 'alpha', isDefault: false, sortOrder: 1 },
        { key: 'beta', isDefault: false, sortOrder: 2 },
        { key: 'gamma', isDefault: false, sortOrder: 3 },
      ],
    });

    // The clear matches nothing here, which is a state to repair, not an error.
    const result = await setAdminPackageDefaultVariant(fixture.slug, 'beta');

    assert.equal(result.outcome, 'updated');
    assert.equal(await defaultCount(fixture.packageId), 1);

    const variants = await storedVariants(fixture.packageId);
    assert.deepEqual(
      variants.filter((variant) => variant.is_default).map((variant) => variant.key),
      ['beta'],
      'the selected target is the only default',
    );
  });

  it('is idempotent for the variant that already leads', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      variants: [
        { key: 'alpha', isDefault: true, sortOrder: 1 },
        { key: 'beta', isDefault: false, sortOrder: 2 },
      ],
    });

    const before = await packageState(fixture.packageId);
    const variantsBefore = await storedVariants(fixture.packageId);

    const result = await setAdminPackageDefaultVariant(fixture.slug, 'alpha');

    assert.equal(result.outcome, 'unchanged');

    const state = await packageState(fixture.packageId);
    assert.equal(state.seed_managed, true, 'nothing diverged, so ownership did not move');
    assert.equal(
      state.updated_at,
      before.updated_at,
      'when the journey last changed is not rewritten',
    );
    assert.deepEqual(await storedVariants(fixture.packageId), variantsBefore, 'no row moved');
    assert.equal(await defaultCount(fixture.packageId), 1);
  });

  it('refuses a live journey and changes nothing', async () => {
    const fixture = await createFixture({
      isActive: true,
      seedManaged: true,
      variants: [
        { key: 'alpha', isDefault: true, sortOrder: 1 },
        { key: 'beta', isDefault: false, sortOrder: 2 },
      ],
    });

    const before = await packageState(fixture.packageId);

    const result = await setAdminPackageDefaultVariant(fixture.slug, 'beta');

    assert.equal(result.outcome, 'package-active');

    const variants = await storedVariants(fixture.packageId);
    assert.deepEqual(
      variants.map((variant) => [variant.key, variant.is_default]),
      [['alpha', true], ['beta', false]],
      'the default did not move',
    );

    const state = await packageState(fixture.packageId);
    assert.equal(state.seed_managed, true, 'ownership did not move');
    assert.equal(state.is_active, true, 'and the journey was not deactivated for them');
    assert.equal(state.updated_at, before.updated_at);
  });

  it('answers an unknown target without touching the journey', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      variants: [
        { key: 'alpha', isDefault: true, sortOrder: 1 },
        { key: 'beta', isDefault: false, sortOrder: 2 },
      ],
    });

    const before = await packageState(fixture.packageId);
    const variantsBefore = await storedVariants(fixture.packageId);

    const result = await setAdminPackageDefaultVariant(fixture.slug, 'no-such-variant');

    assert.equal(result.outcome, 'variant-not-found');
    assert.deepEqual(await storedVariants(fixture.packageId), variantsBefore, 'no row moved');
    assert.equal(await defaultCount(fixture.packageId), 1);

    const state = await packageState(fixture.packageId);
    assert.equal(state.seed_managed, true, 'a mistyped key must not detach a journey');
    assert.equal(state.updated_at, before.updated_at);
  });

  it('answers a journey nothing matches', async () => {
    const result = await setAdminPackageDefaultVariant(`${slugPrefix}-absent`, 'alpha');

    assert.equal(result.outcome, 'package-not-found');
  });

  it('serializes two simultaneous switches on the same journey', async () => {
    // The point of the package lock. The partial unique index is not
    // deferrable, so two switches that both read "alpha leads" and both set
    // their own target would leave one of them raising 23505 — or, worse,
    // leave two rows holding the flag if the index were not there.
    const fixture = await createFixture({
      seedManaged: true,
      variants: [
        { key: 'alpha', isDefault: true, sortOrder: 1 },
        { key: 'beta', isDefault: false, sortOrder: 2 },
        { key: 'gamma', isDefault: false, sortOrder: 3 },
      ],
    });

    const [first, second] = await Promise.all([
      setAdminPackageDefaultVariant(fixture.slug, 'beta'),
      setAdminPackageDefaultVariant(fixture.slug, 'gamma'),
    ]);

    // Neither may fail: a duplicate-default violation would surface here as a
    // thrown 23505 rather than an outcome, so reaching this line at all is
    // part of what is being proved.
    assert.equal(first.outcome, 'updated', 'both switches succeed');
    assert.equal(second.outcome, 'updated', 'both switches succeed');

    assert.equal(
      await defaultCount(fixture.packageId),
      1,
      'exactly one default survives, whichever committed last',
    );

    const variants = await storedVariants(fixture.packageId);
    const leader = variants.find((variant) => variant.is_default)!;

    // Which one won the lock is not determined, so the set is asserted rather
    // than either order — but it must be one of the two that was asked for,
    // never the one both switches cleared.
    assert.ok(['beta', 'gamma'].includes(leader.key), `unexpected leader: ${leader.key}`);
    assert.equal(
      variants.find((variant) => variant.key === 'alpha')!.is_default,
      false,
      'the original default was cleared by both',
    );

    assert.equal((await packageState(fixture.packageId)).seed_managed, false);
  });
});
