import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// The deadlock regression, against real MySQL.
//
// Until this was normalised, `replaceAdminPackageVariantRates` and
// `updateAdminPackageVariant` locked a VARIANT row first and only then wrote
// to its package — the `seed_managed` flip — while variant creation and the
// default-variant switch locked the PACKAGE first and the variants after.
// Two of those running at once on the same journey form a cycle: one holds
// the package and waits for the variant, the other holds the variant and
// waits for the package. PostgreSQL breaks it with 40P01, which nothing here
// handles, so a perfectly valid operation returned a 500.
//
// Only a real server can demonstrate that, because a fake client never
// blocks. Each pairing below is run repeatedly, since a deadlock needs the
// two transactions to interleave and a single attempt can miss it.

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
let repository: RepositoryModule;

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-LOCKORDER-${runId}`;
const slugPrefix = `itest-lockorder-${runId}`;

/** How many times each pairing is raced. A cycle needs an unlucky interleave. */
const ATTEMPTS = 12;

const RATES = [
  { minPartySize: 1, maxPartySize: 2, adultUnitRate: '100.00' },
  { minPartySize: 3, maxPartySize: null, adultUnitRate: '80.00' },
];

let sequence = 0;

/** One inactive journey with two priced variants, the first leading. */
async function createFixture(): Promise<{ packageId: string; slug: string }> {
  sequence += 1;
  const code = `${codePrefix}-${sequence}`;
  const slug = `${slugPrefix}-${sequence}`;

  const { insertId: rowsInsertId } = await dbPool.query(
    `INSERT INTO packages (
       code, slug, title, is_active, requires_price_confirmation, sort_order, seed_managed
     ) VALUES ($1, $2, 'Lock order fixture', false, false, 0, true)`,
    [code, slug],
  );
  const packageId = rowsInsertId!;

  for (const [index, key] of ['alpha', 'beta'].entries()) {
    const { insertId: variantRowsInsertId } = await dbPool.query(
      `INSERT INTO package_variants (package_id, \`key\`, label, is_default, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [packageId, key, `Label ${key}`, index === 0, index + 1],
    );

    await dbPool.query(
      `INSERT INTO package_rate_tiers (
         variant_id, min_party_size, max_party_size, adult_unit_rate, currency
       ) VALUES ($1, 1, NULL, '500.00', 'USD')`,
      [variantRowsInsertId!],
    );
  }

  return { packageId, slug };
}

/** PostgreSQL reports a broken deadlock cycle with this SQLSTATE. */
function isDeadlock(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === '40P01';
}

/**
 * Runs two operations at once and reports what came back, keeping any
 * deadlock as a value so the assertion can name it rather than the test
 * merely exploding.
 */
async function race(
  left: () => Promise<unknown>,
  right: () => Promise<unknown>,
): Promise<{ deadlocked: boolean; failures: string[] }> {
  const settled = await Promise.allSettled([left(), right()]);
  const failures: string[] = [];
  let deadlocked = false;

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      if (isDeadlock(outcome.reason)) deadlocked = true;
      failures.push(String((outcome.reason as { message?: unknown })?.message ?? outcome.reason));
    }
  }

  return { deadlocked, failures };
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));

  repository = await import('../src/modules/admin-packages/admin-packages.repository.js');
});

after(async () => {
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

describe('admin package writes: no deadlock between mixed paths', () => {
  it('runs a rate replacement beside a default switch without deadlocking', async () => {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const fixture = await createFixture();

      const { deadlocked, failures } = await race(
        () => repository.replaceAdminPackageVariantRates(fixture.slug, 'alpha', RATES),
        () => repository.setAdminPackageDefaultVariant(fixture.slug, 'beta'),
      );

      assert.equal(deadlocked, false, `attempt ${attempt}: 40P01 — the lock cycle is back`);
      assert.deepEqual(failures, [], `attempt ${attempt}: both operations should complete`);
    }
  });

  it('runs a variant edit beside a variant create without deadlocking', async () => {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const fixture = await createFixture();

      const { deadlocked, failures } = await race(
        () => repository.updateAdminPackageVariant(fixture.slug, 'alpha', {
          label: 'Renamed', childMinAge: null, childMaxAge: null, childDiscountPercent: null,
        }),
        () => repository.insertAdminPackageVariant(fixture.slug, {
          key: `gamma-${attempt}`,
          label: 'Gamma',
          childMinAge: null,
          childMaxAge: null,
          childDiscountPercent: null,
        }),
      );

      assert.equal(deadlocked, false, `attempt ${attempt}: 40P01 — the lock cycle is back`);
      assert.deepEqual(failures, [], `attempt ${attempt}: both operations should complete`);
    }
  });

  it('runs a rate replacement beside a variant edit on the same variant', async () => {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const fixture = await createFixture();

      const { deadlocked, failures } = await race(
        () => repository.replaceAdminPackageVariantRates(fixture.slug, 'alpha', RATES),
        () => repository.updateAdminPackageVariant(fixture.slug, 'alpha', {
          label: 'Renamed', childMinAge: null, childMaxAge: null, childDiscountPercent: null,
        }),
      );

      assert.equal(deadlocked, false, `attempt ${attempt}: 40P01 — the lock cycle is back`);
      assert.deepEqual(failures, [], `attempt ${attempt}: both operations should complete`);
    }
  });

  it('leaves both writes applied, not one lost to a rollback', async () => {
    // Serialising is only half the point: whichever went second must have run
    // against the first one's committed state rather than being discarded.
    const fixture = await createFixture();

    await race(
      () => repository.replaceAdminPackageVariantRates(fixture.slug, 'alpha', RATES),
      () => repository.setAdminPackageDefaultVariant(fixture.slug, 'beta'),
    );

    const { rows: tiers } = await dbPool.query<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM package_rate_tiers r
         JOIN package_variants v ON v.id = r.variant_id
        WHERE v.package_id = $1 AND v.\`key\` = 'alpha'`,
      [fixture.packageId],
    );
    assert.equal(Number(tiers[0]!.n), RATES.length, 'the replacement survived');

    const { rows: leaders } = await dbPool.query<{ key: string }>(
      'SELECT \`key\` FROM package_variants WHERE package_id = $1 AND is_default',
      [fixture.packageId],
    );
    assert.deepEqual(leaders.map((row) => row.key), ['beta'], 'the switch survived');

    const { rows: owner } = await dbPool.query<{ seed_managed: boolean }>(
      'SELECT seed_managed FROM packages WHERE id = $1',
      [fixture.packageId],
    );
    assert.equal(owner[0]!.seed_managed, false, 'both took ownership, and neither undid it');
  });
});
