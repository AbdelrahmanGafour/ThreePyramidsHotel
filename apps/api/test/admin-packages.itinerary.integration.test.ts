import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// Admin itinerary replacement against real MySQL.
//
// The unit suite models the transaction; this proves what only the database
// can settle. `unnest` of three parallel arrays has to pair them positionally
// and carry a NULL through as a NULL rather than as a missing element — which
// is the part a fake cannot demonstrate, because a fake never has to encode
// an array. It also proves the nullable CHECKs accept what this endpoint
// writes, and that a replacement leaves no stale row behind.
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
let replaceAdminPackageItinerary: RepositoryModule['replaceAdminPackageItinerary'];

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-ITIN-${runId}`;
const slugPrefix = `itest-itin-${runId}`;

type StoredSection = {
  day_number: number | null;
  heading: string | null;
  body: string;
  sort_order: number;
};

/** Every section of a package, in the order the projection reads them. */
async function storedSections(packageId: string): Promise<StoredSection[]> {
  const { rows } = await dbPool.query<StoredSection>(
    `SELECT day_number, heading, body, sort_order
       FROM package_itinerary_sections
      WHERE package_id = $1
      ORDER BY sort_order`,
    [packageId],
  );

  return rows;
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

let sequence = 0;

async function createFixture(options: {
  isActive?: boolean;
  seedManaged?: boolean;
  sections?: StoredSection[];
} = {}): Promise<{ packageId: string; slug: string }> {
  sequence += 1;
  const code = `${codePrefix}-${sequence}`;
  const slug = `${slugPrefix}-${sequence}`;

  const { insertId: rowsInsertId } = await dbPool.query(
    `INSERT INTO packages (
       code, slug, title, is_active, requires_price_confirmation, sort_order, seed_managed
     ) VALUES ($1, $2, 'Itinerary fixture', $3, false, 0, $4)`,
    [code, slug, options.isActive ?? false, options.seedManaged ?? true],
  );
  const packageId = rowsInsertId!;

  for (const item of options.sections ?? []) {
    await dbPool.query(
      `INSERT INTO package_itinerary_sections (
         package_id, day_number, heading, body, sort_order
       ) VALUES ($1, $2, $3, $4, $5)`,
      [packageId, item.day_number, item.heading, item.body, item.sort_order],
    );
  }

  return { packageId, slug };
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));

  ({ replaceAdminPackageItinerary } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
});

after(async () => {
  await dbPool.query(
    `DELETE FROM package_itinerary_sections
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

describe('admin itinerary replacement against MySQL', () => {
  it('writes the sections in order, numbered 1..n', async () => {
    const fixture = await createFixture();

    const result = await replaceAdminPackageItinerary(fixture.slug, [
      { dayNumber: 1, heading: 'Arrival', body: 'Meet at the airport.' },
      { dayNumber: 2, heading: 'The Nile', body: 'Board the cruiser.' },
      { dayNumber: 3, heading: 'Departure', body: 'Transfer back.' },
    ]);

    assert.equal(result.outcome, 'replaced');
    assert.deepEqual(await storedSections(fixture.packageId), [
      { day_number: 1, heading: 'Arrival', body: 'Meet at the airport.', sort_order: 1 },
      { day_number: 2, heading: 'The Nile', body: 'Board the cruiser.', sort_order: 2 },
      { day_number: 3, heading: 'Departure', body: 'Transfer back.', sort_order: 3 },
    ]);
  });

  it('stores both nullable fields as real nulls, beside populated ones', async () => {
    // The part only a real server proves: three arrays unnested together must
    // pair positionally, with a NULL staying a NULL rather than collapsing.
    const fixture = await createFixture();

    const result = await replaceAdminPackageItinerary(fixture.slug, [
      { dayNumber: 1, heading: 'Arrival', body: 'Day one.' },
      { dayNumber: null, heading: null, body: 'Applies throughout.' },
      { dayNumber: 2, heading: null, body: 'Day two, unheaded.' },
      { dayNumber: null, heading: 'General', body: 'Headed, but no day.' },
    ]);

    assert.equal(result.outcome, 'replaced');
    assert.deepEqual(await storedSections(fixture.packageId), [
      { day_number: 1, heading: 'Arrival', body: 'Day one.', sort_order: 1 },
      { day_number: null, heading: null, body: 'Applies throughout.', sort_order: 2 },
      { day_number: 2, heading: null, body: 'Day two, unheaded.', sort_order: 3 },
      { day_number: null, heading: 'General', body: 'Headed, but no day.', sort_order: 4 },
    ]);

    if (result.outcome !== 'replaced') return;
    assert.deepEqual(result.package.itinerary, [
      { dayNumber: 1, heading: 'Arrival', body: 'Day one.' },
      { dayNumber: null, heading: null, body: 'Applies throughout.' },
      { dayNumber: 2, heading: null, body: 'Day two, unheaded.' },
      { dayNumber: null, heading: 'General', body: 'Headed, but no day.' },
    ]);
  });

  it('preserves order that is not the day order, and duplicate sections', async () => {
    const fixture = await createFixture();

    await replaceAdminPackageItinerary(fixture.slug, [
      { dayNumber: 3, heading: null, body: 'Third day first.' },
      { dayNumber: 1, heading: null, body: 'Repeated.' },
      { dayNumber: 1, heading: null, body: 'Repeated.' },
    ]);

    assert.deepEqual(
      (await storedSections(fixture.packageId)).map((s) => [s.day_number, s.body, s.sort_order]),
      [[3, 'Third day first.', 1], [1, 'Repeated.', 2], [1, 'Repeated.', 3]],
    );
  });

  it('removes every stale section on a real replacement', async () => {
    const fixture = await createFixture({
      sections: [
        { day_number: 1, heading: 'Old one', body: 'A', sort_order: 1 },
        { day_number: 2, heading: 'Old two', body: 'B', sort_order: 2 },
        { day_number: null, heading: null, body: 'C', sort_order: 3 },
      ],
    });

    await replaceAdminPackageItinerary(fixture.slug, [
      { dayNumber: 1, heading: null, body: 'Only this.' },
    ]);

    assert.deepEqual(await storedSections(fixture.packageId), [
      { day_number: 1, heading: null, body: 'Only this.', sort_order: 1 },
    ]);
  });

  it('clears the itinerary when the array is empty', async () => {
    const fixture = await createFixture({
      sections: [
        { day_number: 1, heading: 'Arrival', body: 'A', sort_order: 1 },
        { day_number: 2, heading: null, body: 'B', sort_order: 2 },
      ],
    });

    const result = await replaceAdminPackageItinerary(fixture.slug, []);

    assert.equal(result.outcome, 'replaced');
    assert.deepEqual(await storedSections(fixture.packageId), []);

    if (result.outcome !== 'replaced') return;
    assert.deepEqual(result.package.itinerary, []);
  });

  it('replaces the itinerary of a live journey without touching publication', async () => {
    const fixture = await createFixture({ isActive: true });

    const result = await replaceAdminPackageItinerary(fixture.slug, [
      { dayNumber: 1, heading: null, body: 'Day one.' },
    ]);

    assert.equal(result.outcome, 'replaced');
    assert.equal((await packageState(fixture.packageId)).is_active, true);
  });

  it('takes ownership on a real replacement', async () => {
    const fixture = await createFixture({ seedManaged: true });
    const before = await packageState(fixture.packageId);

    await replaceAdminPackageItinerary(fixture.slug, [
      { dayNumber: 1, heading: null, body: 'Day one.' },
    ]);

    const state = await packageState(fixture.packageId);
    assert.equal(state.seed_managed, false, 'or the seed would rewrite the itinerary');
    assert.notEqual(state.updated_at, before.updated_at, 'a real change is recorded');
  });

  it('writes nothing at all when the itinerary is already exactly this', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      sections: [
        { day_number: 1, heading: 'Arrival', body: 'Meet at the airport.', sort_order: 1 },
        { day_number: null, heading: null, body: 'Applies throughout.', sort_order: 2 },
      ],
    });

    const before = await packageState(fixture.packageId);
    const sectionsBefore = await storedSections(fixture.packageId);

    const result = await replaceAdminPackageItinerary(fixture.slug, [
      { dayNumber: 1, heading: 'Arrival', body: 'Meet at the airport.' },
      { dayNumber: null, heading: null, body: 'Applies throughout.' },
    ]);

    assert.equal(result.outcome, 'unchanged');

    const state = await packageState(fixture.packageId);
    assert.equal(state.seed_managed, true, 'nothing diverged, so ownership did not move');
    assert.equal(
      state.updated_at,
      before.updated_at,
      'when the journey last changed is not rewritten',
    );
    assert.deepEqual(await storedSections(fixture.packageId), sectionsBefore);
  });

  it('treats reordered sections as a real change', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      sections: [
        { day_number: 1, heading: 'One', body: 'A', sort_order: 1 },
        { day_number: 2, heading: 'Two', body: 'B', sort_order: 2 },
      ],
    });

    const result = await replaceAdminPackageItinerary(fixture.slug, [
      { dayNumber: 2, heading: 'Two', body: 'B' },
      { dayNumber: 1, heading: 'One', body: 'A' },
    ]);

    assert.equal(result.outcome, 'replaced', 'order is part of the itinerary');
    assert.deepEqual(
      (await storedSections(fixture.packageId)).map((s) => s.body),
      ['B', 'A'],
    );
    assert.equal((await packageState(fixture.packageId)).seed_managed, false);
  });

  it('treats a null becoming a value as a real change', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      sections: [{ day_number: null, heading: null, body: 'A', sort_order: 1 }],
    });

    const result = await replaceAdminPackageItinerary(fixture.slug, [
      { dayNumber: 1, heading: null, body: 'A' },
    ]);

    assert.equal(result.outcome, 'replaced', 'a whole-journey note is not a day-one note');
    assert.equal((await storedSections(fixture.packageId))[0]!.day_number, 1);
  });

  it('accepts a full hundred sections', async () => {
    const fixture = await createFixture();
    const many = Array.from({ length: 100 }, (_unused, index) => ({
      dayNumber: index + 1,
      heading: null,
      body: `Day ${index + 1}.`,
    }));

    const result = await replaceAdminPackageItinerary(fixture.slug, many);

    assert.equal(result.outcome, 'replaced');

    const stored = await storedSections(fixture.packageId);
    assert.equal(stored.length, 100);
    assert.deepEqual(stored.map((s) => s.sort_order), many.map((_u, i) => i + 1));
  });

  it('answers a journey nothing matches without writing', async () => {
    const result = await replaceAdminPackageItinerary(`${slugPrefix}-absent`, [
      { dayNumber: 1, heading: null, body: 'Day one.' },
    ]);

    assert.equal(result.outcome, 'package-not-found');
  });
});
