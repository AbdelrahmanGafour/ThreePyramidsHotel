import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { runner } from 'node-pg-migrate';

// Admin content replacement against real PostgreSQL.
//
// The unit suite models the transaction; this proves what only the database
// can settle. `UNIQUE (package_id, kind, sort_order)` is scoped per kind, so
// three lists numbered independently from 1 must coexist — a global sequence
// would pass a fake and look merely odd here, while a per-kind sequence
// written the wrong way would collide outright. It also proves the kind CHECK
// accepts the singular `note` this endpoint writes, and that a replacement
// leaves no stale row behind.
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

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let replaceAdminPackageContent: RepositoryModule['replaceAdminPackageContent'];

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-CONTENT-${runId}`;
const slugPrefix = `itest-content-${runId}`;

type StoredItem = { kind: string; text: string; sort_order: number };

/** Every content row of a package, in the order the projection reads them. */
async function storedItems(packageId: string): Promise<StoredItem[]> {
  const { rows } = await dbPool.query<StoredItem>(
    `SELECT kind, text, sort_order
       FROM package_content_items
      WHERE package_id = $1
      ORDER BY kind, sort_order`,
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
    'SELECT seed_managed, is_active, updated_at::text AS updated_at FROM packages WHERE id = $1',
    [id],
  );

  const row = rows[0];
  assert.ok(row, 'the fixture package should still exist');

  return row;
}

let sequence = 0;

/** One journey, optionally pre-loaded with content. */
async function createFixture(options: {
  isActive?: boolean;
  seedManaged?: boolean;
  items?: StoredItem[];
} = {}): Promise<{ packageId: string; slug: string }> {
  sequence += 1;
  const code = `${codePrefix}-${sequence}`;
  const slug = `${slugPrefix}-${sequence}`;

  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO packages (
       code, slug, title, is_active, requires_price_confirmation, sort_order, seed_managed
     ) VALUES ($1, $2, 'Content fixture', $3, false, 0, $4)
     RETURNING id`,
    [code, slug, options.isActive ?? false, options.seedManaged ?? true],
  );
  const packageId = rows[0]!.id;

  for (const item of options.items ?? []) {
    await dbPool.query(
      `INSERT INTO package_content_items (package_id, kind, text, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [packageId, item.kind, item.text, item.sort_order],
    );
  }

  return { packageId, slug };
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

  ({ replaceAdminPackageContent } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
});

after(async () => {
  await dbPool.query(
    `DELETE FROM package_content_items
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

describe('admin content replacement against PostgreSQL', () => {
  it('writes all three kinds, each numbered from 1', async () => {
    const fixture = await createFixture();

    const result = await replaceAdminPackageContent(fixture.slug, {
      included: ['Dinner', 'Guide', 'Transfer'],
      excluded: ['Drinks', 'Tips'],
      notes: ['Smart dress.'],
    });

    assert.equal(result.outcome, 'replaced');

    // The per-kind unique index permits three independent sequences; a global
    // one would have produced 1..6 here.
    assert.deepEqual(await storedItems(fixture.packageId), [
      { kind: 'excluded', text: 'Drinks', sort_order: 1 },
      { kind: 'excluded', text: 'Tips', sort_order: 2 },
      { kind: 'included', text: 'Dinner', sort_order: 1 },
      { kind: 'included', text: 'Guide', sort_order: 2 },
      { kind: 'included', text: 'Transfer', sort_order: 3 },
      { kind: 'note', text: 'Smart dress.', sort_order: 1 },
    ]);
  });

  it('stores the singular kind the CHECK allows, and exposes it as notes', async () => {
    const fixture = await createFixture();

    const result = await replaceAdminPackageContent(fixture.slug, {
      included: [],
      excluded: [],
      notes: ['Bring a coat.'],
    });

    const { rows } = await dbPool.query<{ kind: string }>(
      'SELECT DISTINCT kind FROM package_content_items WHERE package_id = $1',
      [fixture.packageId],
    );

    assert.deepEqual(rows.map((row) => row.kind), ['note'], 'the CHECK allows only the singular');

    if (result.outcome !== 'replaced') return;
    assert.deepEqual(result.package.content.notes, ['Bring a coat.']);
    assert.deepEqual(result.package.content.included, []);
  });

  it('preserves order exactly, including duplicate text', async () => {
    const fixture = await createFixture();

    const result = await replaceAdminPackageContent(fixture.slug, {
      included: ['zebra', 'Transfer', 'apple', 'Transfer'],
      excluded: [],
      notes: [],
    });

    assert.deepEqual(
      (await storedItems(fixture.packageId)).map((item) => [item.text, item.sort_order]),
      [['zebra', 1], ['Transfer', 2], ['apple', 3], ['Transfer', 4]],
      'never sorted, and duplicates survive',
    );

    if (result.outcome !== 'replaced') return;
    assert.deepEqual(result.package.content.included, ['zebra', 'Transfer', 'apple', 'Transfer']);
  });

  it('removes every stale row, across all three kinds', async () => {
    const fixture = await createFixture({
      items: [
        { kind: 'included', text: 'Old one', sort_order: 1 },
        { kind: 'included', text: 'Old two', sort_order: 2 },
        { kind: 'excluded', text: 'Old three', sort_order: 1 },
        { kind: 'note', text: 'Old four', sort_order: 1 },
      ],
    });

    await replaceAdminPackageContent(fixture.slug, {
      included: ['Only this'],
      excluded: [],
      notes: [],
    });

    assert.deepEqual(await storedItems(fixture.packageId), [
      { kind: 'included', text: 'Only this', sort_order: 1 },
    ]);
  });

  it('clears the content when all three lists are empty', async () => {
    const fixture = await createFixture({
      items: [
        { kind: 'included', text: 'Dinner', sort_order: 1 },
        { kind: 'note', text: 'Smart dress.', sort_order: 1 },
      ],
    });

    const result = await replaceAdminPackageContent(fixture.slug, {
      included: [],
      excluded: [],
      notes: [],
    });

    assert.equal(result.outcome, 'replaced');
    assert.deepEqual(await storedItems(fixture.packageId), []);

    if (result.outcome !== 'replaced') return;
    assert.deepEqual(result.package.content, { included: [], excluded: [], notes: [] });
  });

  it('replaces the content of a live journey without touching publication', async () => {
    const fixture = await createFixture({ isActive: true });

    const result = await replaceAdminPackageContent(fixture.slug, {
      included: ['Dinner'],
      excluded: [],
      notes: [],
    });

    assert.equal(result.outcome, 'replaced');
    assert.equal((await packageState(fixture.packageId)).is_active, true);
  });

  it('takes ownership on a real replacement', async () => {
    const fixture = await createFixture({ seedManaged: true });
    const before = await packageState(fixture.packageId);

    await replaceAdminPackageContent(fixture.slug, {
      included: ['Dinner'],
      excluded: [],
      notes: [],
    });

    const state = await packageState(fixture.packageId);
    assert.equal(state.seed_managed, false, 'or the seed would rewrite the content');
    assert.notEqual(state.updated_at, before.updated_at, 'a real change is recorded');
  });

  it('writes nothing at all when the content is already exactly this', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      items: [
        { kind: 'included', text: 'Dinner', sort_order: 1 },
        { kind: 'included', text: 'Guide', sort_order: 2 },
        { kind: 'excluded', text: 'Drinks', sort_order: 1 },
        { kind: 'note', text: 'Smart dress.', sort_order: 1 },
      ],
    });

    const before = await packageState(fixture.packageId);
    const itemsBefore = await storedItems(fixture.packageId);

    const result = await replaceAdminPackageContent(fixture.slug, {
      included: ['Dinner', 'Guide'],
      excluded: ['Drinks'],
      notes: ['Smart dress.'],
    });

    assert.equal(result.outcome, 'unchanged');

    const state = await packageState(fixture.packageId);
    assert.equal(state.seed_managed, true, 'nothing diverged, so ownership did not move');
    assert.equal(
      state.updated_at,
      before.updated_at,
      'when the journey last changed is not rewritten',
    );
    assert.deepEqual(await storedItems(fixture.packageId), itemsBefore, 'no row was rewritten');
  });

  it('treats a reordered list as a real change', async () => {
    const fixture = await createFixture({
      seedManaged: true,
      items: [
        { kind: 'included', text: 'Dinner', sort_order: 1 },
        { kind: 'included', text: 'Guide', sort_order: 2 },
      ],
    });

    const result = await replaceAdminPackageContent(fixture.slug, {
      included: ['Guide', 'Dinner'],
      excluded: [],
      notes: [],
    });

    assert.equal(result.outcome, 'replaced', 'order is part of the content');
    assert.deepEqual(
      (await storedItems(fixture.packageId)).map((item) => item.text),
      ['Guide', 'Dinner'],
    );
    assert.equal((await packageState(fixture.packageId)).seed_managed, false);
  });

  it('answers a journey nothing matches without writing', async () => {
    const result = await replaceAdminPackageContent(`${slugPrefix}-absent`, {
      included: ['Dinner'],
      excluded: [],
      notes: [],
    });

    assert.equal(result.outcome, 'package-not-found');
  });

  it('accepts a full hundred entries in one list', async () => {
    const fixture = await createFixture();
    const many = Array.from({ length: 100 }, (_unused, index) => `Item ${index + 1}`);

    const result = await replaceAdminPackageContent(fixture.slug, {
      included: many,
      excluded: [],
      notes: [],
    });

    assert.equal(result.outcome, 'replaced');

    const stored = await storedItems(fixture.packageId);
    assert.equal(stored.length, 100);
    assert.deepEqual(stored.map((item) => item.sort_order), many.map((_u, i) => i + 1));
  });
});
