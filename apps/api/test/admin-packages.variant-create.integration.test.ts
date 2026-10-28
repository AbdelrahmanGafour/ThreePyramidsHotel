import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// Admin variant creation against real MySQL.
//
// The unit suite models the transaction; this proves the parts only the
// database can settle. Chiefly it proves the lock: two administrators adding
// a variant to the same journey at the same moment must not both read "no
// variants yet", and no fake client can demonstrate that. It also proves the
// server-assigned position survives `UNIQUE (package_id, sort_order)`, that
// the single-default partial index is never tripped, that a duplicate key is
// refused by the constraint with the previous state intact, and that a
// refusal leaves `seed_managed` where it was.
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
let insertAdminPackageVariant: RepositoryModule['insertAdminPackageVariant'];

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-VCREATE-${runId}`;
const slugPrefix = `itest-vcreate-${runId}`;

/** The body most tests create with. */
const NEW_VARIANT = {
  key: 'premium-service',
  label: 'Premium service',
  childMinAge: 6,
  childMaxAge: 12,
  childDiscountPercent: '33.33',
} as const;

type StoredVariant = {
  id: string;
  key: string;
  label: string;
  is_default: boolean;
  sort_order: number;
  child_min_age: number | null;
  child_max_age: number | null;
  child_discount_percent: string | null;
};

/**
 * A journey's variants in the catalogue's own order, with the percentage cast
 * to text so the exact stored decimal is what comes back.
 */
async function storedVariants(packageId: string): Promise<StoredVariant[]> {
  const { rows } = await dbPool.query<StoredVariant>(
    `SELECT id,
            \`key\`,
            label,
            is_default,
            sort_order,
            child_min_age,
            child_max_age,
            child_discount_percent AS child_discount_percent
       FROM package_variants
      WHERE package_id = $1
      ORDER BY sort_order, \`key\``,
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

async function rateTierCount(packageId: string): Promise<number> {
  const { rows } = await dbPool.query<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM package_rate_tiers r
       JOIN package_variants v ON v.id = r.variant_id
      WHERE v.package_id = $1`,
    [packageId],
  );

  return Number(rows[0]!.n);
}

let sequence = 0;

/**
 * One journey, with whatever variants a test needs it to start with.
 *
 * Each fixture gets its own code and slug, so tests never contend — which
 * matters more here than elsewhere, because one of them deliberately runs two
 * writes at once — and cleanup can name exactly what this run created.
 *
 * Inactive and brochure-owned by default: those are the states the rules
 * under test actually turn on.
 */
async function createFixture(options: {
  seedManaged?: boolean;
  isActive?: boolean;
  requiresPriceConfirmation?: boolean;
  variants?: Array<{ key: string; isDefault: boolean; sortOrder: number }>;
} = {}): Promise<{ packageId: string; slug: string }> {
  sequence += 1;
  const code = `${codePrefix}-${sequence}`;
  const slug = `${slugPrefix}-${sequence}`;

  const { insertId: rowsInsertId } = await dbPool.query(
    `INSERT INTO packages (
       code, slug, title, is_active, requires_price_confirmation, sort_order, seed_managed
     ) VALUES ($1, $2, 'Variant create fixture', $3, $4, 0, $5)`,
    [
      code,
      slug,
      options.isActive ?? false,
      options.requiresPriceConfirmation ?? false,
      options.seedManaged ?? true,
    ],
  );
  const packageId = rowsInsertId!;

  for (const variant of options.variants ?? []) {
    await dbPool.query(
      `INSERT INTO package_variants (package_id, \`key\`, label, is_default, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [packageId, variant.key, `Label ${variant.key}`, variant.isDefault, variant.sortOrder],
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
  ({ insertAdminPackageVariant } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
});

// No beforeEach reset: every test builds its own prefixed fixture and reads
// only that one, so there is nothing shared to clear between them.

after(async () => {
  // Variants cascade from the package, but they are removed explicitly so a
  // failure part-way through cleanup still names what it hit.
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

describe('admin variant creation against MySQL', () => {
  it('creates the first variant as the default, at the base position, unpriced', async () => {
    const fixture = await createFixture({ seedManaged: true });

    const result = await insertAdminPackageVariant(fixture.slug, NEW_VARIANT);

    assert.equal(result.outcome, 'created');

    const variants = await storedVariants(fixture.packageId);
    assert.equal(variants.length, 1);

    const [created] = variants;
    assert.equal(created!.key, 'premium-service');
    assert.equal(created!.is_default, true, 'the first variant leads its journey');
    assert.equal(created!.sort_order, 1, 'the base position the brochure seed also uses');

    // The exact decimal survives `numeric(5,2)` as the string it arrived as.
    assert.equal(created!.child_discount_percent, '33.33');
    assert.equal(created!.child_min_age, 6);
    assert.equal(created!.child_max_age, 12);

    assert.equal(await rateTierCount(fixture.packageId), 0, 'no rate tier was created');

    // The same transaction took ownership, and published nothing.
    const state = await packageState(fixture.packageId);
    assert.equal(state.seed_managed, false);
    assert.equal(state.is_active, false);

    if (result.outcome !== 'created') return;
    assert.equal(result.package.managementSource, 'admin');
    assert.deepEqual(result.package.variants[0]!.rates, []);
  });

  it('appends a second variant behind the first, without disturbing it', async () => {
    const fixture = await createFixture({
      seedManaged: false,
      variants: [{ key: 'standard-service', isDefault: true, sortOrder: 1 }],
    });

    const result = await insertAdminPackageVariant(fixture.slug, NEW_VARIANT);

    assert.equal(result.outcome, 'created');

    const variants = await storedVariants(fixture.packageId);
    assert.deepEqual(
      variants.map((variant) => [variant.key, variant.is_default, variant.sort_order]),
      [['standard-service', true, 1], ['premium-service', false, 2]],
      'the new variant is added behind the one that already leads',
    );
  });

  it('appends past the highest position in use, not past the count', async () => {
    // Real `UNIQUE (package_id, sort_order)`: a gapped set would collide if
    // the next position were derived from how many variants there are.
    const fixture = await createFixture({
      variants: [
        { key: 'alpha', isDefault: true, sortOrder: 4 },
        { key: 'beta', isDefault: false, sortOrder: 9 },
      ],
    });

    const result = await insertAdminPackageVariant(fixture.slug, NEW_VARIANT);

    assert.equal(result.outcome, 'created');

    const variants = await storedVariants(fixture.packageId);
    assert.deepEqual(variants.map((variant) => variant.sort_order), [4, 9, 10]);
  });

  it('serializes two simultaneous creates on the same journey', async () => {
    // The point of the parent lock. Both calls start against an empty
    // journey; without the lock both would read "no variants", both would
    // claim position 1 and both would claim the default flag — one tripping
    // UNIQUE (package_id, sort_order), the other the single-default index.
    const fixture = await createFixture({ seedManaged: true });

    const [first, second] = await Promise.all([
      insertAdminPackageVariant(fixture.slug, { ...NEW_VARIANT, key: 'alpha', label: 'Alpha' }),
      insertAdminPackageVariant(fixture.slug, { ...NEW_VARIANT, key: 'beta', label: 'Beta' }),
    ]);

    assert.equal(first.outcome, 'created', 'both creates succeed');
    assert.equal(second.outcome, 'created', 'both creates succeed');

    const variants = await storedVariants(fixture.packageId);
    assert.equal(variants.length, 2, 'exactly two rows exist');

    // Which one won the lock is not determined, so the set is asserted rather
    // than either order.
    assert.deepEqual([...variants.map((variant) => variant.key)].sort(), ['alpha', 'beta']);
    assert.deepEqual(
      [...variants.map((variant) => variant.sort_order)].sort((a, b) => a - b),
      [1, 2],
      'distinct, contiguous positions',
    );

    const defaults = variants.filter((variant) => variant.is_default);
    assert.equal(defaults.length, 1, 'exactly one variant leads the journey');
    assert.equal(
      defaults[0]!.sort_order,
      1,
      'and it is the one that got there first',
    );

    assert.equal((await packageState(fixture.packageId)).seed_managed, false);
  });

  it('refuses a duplicate key and leaves the journey exactly as it was', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      variants: [{ key: 'premium-service', isDefault: true, sortOrder: 1 }],
    });

    const before = await storedVariants(fixture.packageId);

    const result = await insertAdminPackageVariant(fixture.slug, NEW_VARIANT);

    assert.equal(result.outcome, 'key-in-use', 'the unique constraint answered');

    const after = await storedVariants(fixture.packageId);
    assert.deepEqual(after, before, 'not one column of the existing variant moved');
    assert.equal(after.length, 1, 'nothing was appended');

    // The rollback undid the attempt, so the refusal took no ownership.
    assert.equal(
      (await packageState(fixture.packageId)).seed_managed,
      true,
      'a duplicate key must not detach a journey from the brochure',
    );
  });

  it('refuses to add a rate-less variant to a live journey, and writes nothing', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      isActive: true,
      variants: [{ key: 'standard-service', isDefault: true, sortOrder: 1 }],
    });

    const result = await insertAdminPackageVariant(fixture.slug, NEW_VARIANT);

    assert.equal(result.outcome, 'package-active');

    const variants = await storedVariants(fixture.packageId);
    assert.equal(variants.length, 1, 'no variant was inserted');
    assert.equal(variants[0]!.key, 'standard-service');

    const state = await packageState(fixture.packageId);
    assert.equal(state.seed_managed, true, 'ownership did not move');
    assert.equal(state.is_active, true, 'and the journey was not deactivated for them');
  });

  it('still refuses when the live journey is quoted on request', async () => {
    const fixture = await createFixture({
      isActive: true,
      requiresPriceConfirmation: true,
      variants: [{ key: 'standard-service', isDefault: true, sortOrder: 1 }],
    });

    const result = await insertAdminPackageVariant(fixture.slug, NEW_VARIANT);

    assert.equal(result.outcome, 'package-active');
    assert.equal((await storedVariants(fixture.packageId)).length, 1);
  });

  it('refuses a second variant beside a lone unflagged one', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      variants: [{ key: 'standard-service', isDefault: false, sortOrder: 1 }],
    });

    const result = await insertAdminPackageVariant(fixture.slug, NEW_VARIANT);

    assert.equal(result.outcome, 'unsafe-default-state');
    assert.equal((await storedVariants(fixture.packageId)).length, 1);
    assert.equal((await packageState(fixture.packageId)).seed_managed, true);
  });

  it('answers a journey nothing matches without writing anything', async () => {
    const result = await insertAdminPackageVariant(`${slugPrefix}-absent`, NEW_VARIANT);

    assert.equal(result.outcome, 'package-not-found');
  });
});
