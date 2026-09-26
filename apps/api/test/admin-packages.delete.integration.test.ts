import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { runner } from 'node-pg-migrate';

// Removing a whole journey, against real PostgreSQL.
//
// The unit suite models the transaction; this proves the cascade chain, which
// is the part only the schema can settle. One DELETE against `packages` has
// to take three child tables with it and a fourth beneath those — rate tiers
// hang off variants, not off the package — and the same statement has to be
// refused outright when any variant has ever been booked, for every booking
// status.
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
type BrochureModule = typeof import('../src/modules/admin-packages/admin-packages.brochure.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let deleteAdminPackage: RepositoryModule['deleteAdminPackage'];
let generatePackageBookingReference: ReferenceModule['generatePackageBookingReference'];
let reservedBrochureIdentities: BrochureModule['reservedBrochureIdentities'];

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-PKGDEL-${runId}`;
const slugPrefix = `itest-pkgdel-${runId}`;

let brochureCode: string;
let brochureSlug: string;

/** How many rows of each child table belong to this package. */
async function childCounts(packageId: string): Promise<{
  itinerary: number;
  content: number;
  variants: number;
  rates: number;
}> {
  const { rows } = await dbPool.query<{
    itinerary: number;
    content: number;
    variants: number;
    rates: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM package_itinerary_sections WHERE package_id = $1) AS itinerary,
       (SELECT count(*)::int FROM package_content_items WHERE package_id = $1) AS content,
       (SELECT count(*)::int FROM package_variants WHERE package_id = $1) AS variants,
       (SELECT count(*)::int FROM package_rate_tiers r
          JOIN package_variants v ON v.id = r.variant_id
         WHERE v.package_id = $1) AS rates`,
    [packageId],
  );

  return rows[0]!;
}

async function packageExists(id: string): Promise<boolean> {
  const { rows } = await dbPool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM packages WHERE id = $1',
    [id],
  );

  return rows[0]!.n > 0;
}

let sequence = 0;

/**
 * One journey furnished with every kind of child row, so a cascade has
 * something of each to take.
 */
async function createFixture(options: {
  isActive?: boolean;
  seedManaged?: boolean;
  code?: string;
  slug?: string;
} = {}): Promise<{ packageId: string; slug: string; code: string; variantIds: string[] }> {
  sequence += 1;
  const code = options.code ?? `${codePrefix}-${sequence}`;
  const slug = options.slug ?? `${slugPrefix}-${sequence}`;

  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO packages (
       code, slug, title, is_active, requires_price_confirmation, sort_order, seed_managed
     ) VALUES ($1, $2, 'Package delete fixture', $3, false, 0, $4)
     RETURNING id`,
    [code, slug, options.isActive ?? false, options.seedManaged ?? false],
  );
  const packageId = rows[0]!.id;

  await dbPool.query(
    `INSERT INTO package_itinerary_sections (package_id, day_number, heading, body, sort_order)
     VALUES ($1, 1, 'Arrival', 'Meet at the airport.', 1),
            ($1, NULL, NULL, 'Applies throughout.', 2)`,
    [packageId],
  );

  await dbPool.query(
    `INSERT INTO package_content_items (package_id, kind, text, sort_order)
     VALUES ($1, 'included', 'Dinner', 1),
            ($1, 'excluded', 'Drinks', 1),
            ($1, 'note', 'Smart dress.', 1)`,
    [packageId],
  );

  const variantIds: string[] = [];

  for (const [index, key] of ['alpha', 'beta'].entries()) {
    const { rows: variantRows } = await dbPool.query<{ id: string }>(
      `INSERT INTO package_variants (package_id, key, label, is_default, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [packageId, key, `Label ${key}`, index === 0, index + 1],
    );
    const variantId = variantRows[0]!.id;
    variantIds.push(variantId);

    await dbPool.query(
      `INSERT INTO package_rate_tiers (
         variant_id, min_party_size, max_party_size, adult_unit_rate, currency
       ) VALUES ($1, 1, 2, '100.00', 'USD'), ($1, 3, NULL, '80.00', 'USD')`,
      [variantId],
    );
  }

  return { packageId, slug, code, variantIds };
}

/** One reservation against a variant, in the status asked for. */
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
       $5, 'Package delete fixture', 'Label booked',
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

  ({ deleteAdminPackage } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ generatePackageBookingReference } = await import(
    '../src/modules/package-reservations/booking-reference.js'
  ));
  ({ reservedBrochureIdentities } = await import(
    '../src/modules/admin-packages/admin-packages.brochure.js'
  ));

  const { codes, slugs } = reservedBrochureIdentities();
  assert.ok(codes[0] && slugs[0], 'the brochure catalogue should have entries to test against');
  brochureCode = codes[0];
  brochureSlug = slugs[0];
});

after(async () => {
  // Reservations first: they reference variants with ON DELETE RESTRICT, so
  // nothing below them can go while they stand.
  await dbPool.query(
    `DELETE FROM package_reservations
      WHERE package_id IN (SELECT id FROM packages WHERE code LIKE $1)`,
    [`${codePrefix}%`],
  );
  await dbPool.query('DELETE FROM packages WHERE code LIKE $1', [`${codePrefix}%`]);

  // The brochure-identity fixtures borrow a real code or slug, so they are
  // named by their own prefix rather than by the shared one.
  await dbPool.query('DELETE FROM packages WHERE slug LIKE $1', [`${slugPrefix}%`]);

  const { rows } = await dbPool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM packages WHERE code LIKE $1 OR slug LIKE $2',
    [`${codePrefix}%`, `${slugPrefix}%`],
  );
  assert.equal(rows[0]!.n, 0, 'every fixture this run created was removed');

  await closeDatabasePool();
});

describe('admin package removal against PostgreSQL', () => {
  it('removes the journey and every child row by cascade', async () => {
    const fixture = await createFixture();

    const before = await childCounts(fixture.packageId);
    assert.deepEqual(before, { itinerary: 2, content: 3, variants: 2, rates: 4 });

    const result = await deleteAdminPackage(fixture.slug);

    assert.equal(result.outcome, 'deleted');
    assert.equal(await packageExists(fixture.packageId), false);

    // Three cascade from the package; the rate tiers cascade from the
    // variants, which is the level of the chain a single FK would miss.
    assert.deepEqual(await childCounts(fixture.packageId), {
      itinerary: 0, content: 0, variants: 0, rates: 0,
    });
  });

  it('leaves no orphan row behind in any child table', async () => {
    const fixture = await createFixture();
    const { variantIds } = fixture;

    await deleteAdminPackage(fixture.slug);

    const { rows } = await dbPool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM package_rate_tiers WHERE variant_id = ANY($1::bigint[])',
      [variantIds],
    );
    assert.equal(rows[0]!.n, 0, 'the tiers went with their variants');
  });

  it('refuses a live journey without touching it', async () => {
    const fixture = await createFixture({ isActive: true });

    const result = await deleteAdminPackage(fixture.slug);

    assert.equal(result.outcome, 'package-active');
    assert.equal(await packageExists(fixture.packageId), true);
    assert.deepEqual(await childCounts(fixture.packageId), {
      itinerary: 2, content: 3, variants: 2, rates: 4,
    });
  });

  it('refuses a reserved brochure code even when the row is admin-managed', async () => {
    // The seed looks brochure journeys up by code, so deleting this row would
    // not remove the journey — the next run would recreate it.
    const fixture = await createFixture({ seedManaged: false, code: brochureCode });

    const result = await deleteAdminPackage(fixture.slug);

    assert.equal(result.outcome, 'brochure-managed');
    assert.equal(await packageExists(fixture.packageId), true);
  });

  it('refuses a reserved brochure slug even when the row is admin-managed', async () => {
    const fixture = await createFixture({ seedManaged: false, slug: brochureSlug });

    const result = await deleteAdminPackage(fixture.slug);

    assert.equal(result.outcome, 'brochure-managed');
    assert.equal(await packageExists(fixture.packageId), true);
  });

  it('removes an admin-created identity whatever the ownership flag says', async () => {
    for (const seedManaged of [true, false]) {
      const fixture = await createFixture({ seedManaged });

      assert.equal(
        (await deleteAdminPackage(fixture.slug)).outcome,
        'deleted',
        `seedManaged=${seedManaged}`,
      );
      assert.equal(await packageExists(fixture.packageId), false);
    }
  });

  it('refuses a booked journey whatever the booking status', async () => {
    for (const status of ['pending', 'confirmed', 'cancelled'] as const) {
      const fixture = await createFixture();

      await bookVariant(fixture, fixture.variantIds[0]!, status);

      const result = await deleteAdminPackage(fixture.slug);

      assert.equal(
        result.outcome,
        'has-reservations',
        `a ${status} booking must hold the journey`,
      );
      assert.equal(await packageExists(fixture.packageId), true, `${status}: nothing was removed`);
      assert.deepEqual(
        await childCounts(fixture.packageId),
        { itinerary: 2, content: 3, variants: 2, rates: 4 },
        `${status}: every child row is intact`,
      );
    }
  });

  it('is blocked by a booking on any variant, not only the default', async () => {
    const fixture = await createFixture();

    // The second variant, which is not the one the journey leads with.
    await bookVariant(fixture, fixture.variantIds[1]!, 'pending');

    assert.equal((await deleteAdminPackage(fixture.slug)).outcome, 'has-reservations');
    assert.equal(await packageExists(fixture.packageId), true);
  });

  it('removes a journey permanently, so a repeat finds nothing', async () => {
    const fixture = await createFixture();

    assert.equal((await deleteAdminPackage(fixture.slug)).outcome, 'deleted');
    assert.equal((await deleteAdminPackage(fixture.slug)).outcome, 'package-not-found');
  });

  it('answers a journey nothing matches', async () => {
    const result = await deleteAdminPackage(`${slugPrefix}-absent`);

    assert.equal(result.outcome, 'package-not-found');
  });
});
