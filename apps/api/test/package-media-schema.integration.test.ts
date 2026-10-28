import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

// The `package_media` schema, proved against real MySQL.
//
// Everything asserted here is a rule only the database can settle: that
// exactly one image per journey is a constraint rather than a habit, that an
// asset cannot be placed twice, that the alt-text ceiling is enforced at the
// column, and — the reason this table takes RESTRICT on both sides — that
// neither a journey nor an asset can be deleted out from under a relation
// that still points at it.
//
// Narrowly scoped on purpose. `packages.schema.integration.test.ts` owns the
// migration UP/DOWN/UP proof and the package tables' own index and constraint
// inventory; this suite owns one table and asserts nothing about the others.
//
// Every row it writes carries an identifier unique to the run, and exactly
// those rows are removed afterwards.

// Uses the dedicated migrated disposable cluster, never hotel development.
const target = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(process.env.PACKAGES_DISPOSABLE_TEST, '1');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '3307');
assert.match(target.pathname, /^\/hotel_[a-z_]*test$/);
assert.equal(target.search, '');

type Pool = typeof import('../src/db/pool.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-PKGMEDIA-${runId}`;
const slugPrefix = `itest-pkgmedia-${runId}`;
const keyPrefix = `media/itest-pkgmedia-${runId}`;

let sequence = 0;

/** A journey with nothing but an identity — no variants, no content. */
async function createPackage(): Promise<string> {
  sequence += 1;

  const inserted = await dbPool.query(
    `INSERT INTO packages (code, slug, title, is_active, seed_managed)
     VALUES ($1, $2, 'Package media fixture', false, false)`,
    [`${codePrefix}-${sequence}`, `${slugPrefix}-${sequence}`],
  );

  return inserted.insertId!;
}

/**
 * One stored object's metadata, shaped exactly as the processing pipeline
 * records it: a normalized WebP with a real digest-shaped checksum.
 */
async function createAsset(): Promise<string> {
  sequence += 1;

  const inserted = await dbPool.query(
    `INSERT INTO media_assets
       (reference, storage_key, content_type, byte_size, checksum_sha256, width, height)
     VALUES ($1, $2, 'image/webp', 4096, $3, 1200, 800)`,
    [randomUUID(), `${keyPrefix}-${sequence}.webp`, 'a'.repeat(64)],
  );

  return inserted.insertId!;
}

async function insertMedia(
  packageId: string,
  mediaAssetId: string,
  altText: string | null = null,
): Promise<string> {
  const inserted = await dbPool.query(
    `INSERT INTO package_media (package_id, media_asset_id, alt_text)
     VALUES ($1, $2, $3)`,
    [packageId, mediaAssetId, altText],
  );

  return inserted.insertId!;
}

type Violation = { code: string; constraint: string };

/**
 * Runs a statement that must be refused, and reports which rule refused it.
 *
 * A test that only asserted "this threw" would pass for the wrong reason the
 * first time an unrelated constraint, a typo or a missing column produced an
 * error instead. Naming the constraint is what makes the assertion mean
 * something. Copied in shape from `media-schema.integration.test.ts`, whose
 * table this one is the journey-side counterpart of.
 */
async function violation(run: () => Promise<unknown>): Promise<Violation> {
  try {
    await run();
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };

    return { code: pgError.code ?? '(none)', constraint: pgError.constraint ?? '(none)' };
  }

  assert.fail('expected MySQL to reject the statement');
}

/**
 * The two SQLSTATEs a RESTRICT-mediated delete refusal can carry.
 *
 * PostgreSQL 16 reports 23503 (foreign_key_violation); PostgreSQL 18 reports
 * the more specific 23001 (restrict_violation). Both say the same thing, so
 * pinning one would assert which server major is running rather than anything
 * about this schema. The constraint name stays exact either way, and that
 * RESTRICT rather than CASCADE is declared at all is pinned separately and
 * structurally by the `confdeltype` assertion below, which no SQLSTATE
 * affects.
 *
 * This suite's disposable cluster runs 16 or 18, so both are accepted.
 */
const RESTRICT_REFUSAL_CODES = ['23001', '23503'];

function assertRestrictRefusal(actual: Violation, constraint: string): void {
  assert.equal(actual.constraint, constraint);
  assert.ok(
    RESTRICT_REFUSAL_CODES.includes(actual.code),
    `expected ${RESTRICT_REFUSAL_CODES.join(' or ')} from ${constraint}, got ${actual.code}`,
  );
}

before(async () => {
  // The schema (src/db/schema) is applied beforehand with `npm run migrate:up`.
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
});

after(async () => {
  // Relations first: they hold RESTRICT foreign keys in both directions, so
  // neither a package nor an asset can go while one still points at it.
  await dbPool.query(
    `DELETE FROM package_media
      WHERE package_id IN (SELECT id FROM packages WHERE code LIKE $1)`,
    [`${codePrefix}%`],
  );
  await dbPool.query(
    'DELETE FROM package_media WHERE media_asset_id IN (SELECT id FROM media_assets WHERE storage_key LIKE $1)',
    [`${keyPrefix}%`],
  );
  await dbPool.query('DELETE FROM packages WHERE code LIKE $1', [`${codePrefix}%`]);
  await dbPool.query('DELETE FROM media_assets WHERE storage_key LIKE $1', [`${keyPrefix}%`]);

  const { rows } = await dbPool.query<{ packages: number; assets: number; media: number }>(
    `SELECT
       (SELECT CAST(COUNT(*) AS SIGNED) FROM packages WHERE code LIKE $1) AS packages,
       (SELECT CAST(COUNT(*) AS SIGNED) FROM media_assets WHERE storage_key LIKE $2) AS assets,
       (SELECT CAST(COUNT(*) AS SIGNED) FROM package_media pm
          JOIN media_assets ma ON ma.id = pm.media_asset_id
         WHERE ma.storage_key LIKE $2) AS media`,
    [`${codePrefix}%`, `${keyPrefix}%`],
  );

  assert.deepEqual(
    { packages: Number(rows[0]!.packages), assets: Number(rows[0]!.assets), media: Number(rows[0]!.media) },
    { packages: 0, assets: 0, media: 0 }, 'every fixture this run created was removed');

  await closeDatabasePool();
});

describe('package_media: the table as the migration declares it', () => {
  it('carries exactly the six columns, and none of the gallery ones', async () => {
    const { rows } = await dbPool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name AS column_name, is_nullable AS is_nullable
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'package_media'
        ORDER BY ordinal_position`,
    );

    assert.deepEqual(
      rows.map((row) => row.column_name),
      ['id', 'package_id', 'media_asset_id', 'alt_text', 'created_at', 'updated_at'],
    );

    // No sort_order and no is_cover: with one image per journey there is
    // nothing to order and nothing to distinguish. No bucket column either —
    // which storage holds the bytes is deployment configuration.
    const nullable = new Map(rows.map((row) => [row.column_name, row.is_nullable]));
    assert.equal(nullable.get('package_id'), 'NO');
    assert.equal(nullable.get('media_asset_id'), 'NO');
    assert.equal(nullable.get('alt_text'), 'YES');
    assert.equal(nullable.get('created_at'), 'NO');
    assert.equal(nullable.get('updated_at'), 'NO');
  });

  it('names every constraint, and declares both foreign keys as RESTRICT', async () => {
    const { rows } = await dbPool.query<{ conname: string; contype: string }>(
      `SELECT constraint_name AS conname, constraint_type AS contype
         FROM information_schema.table_constraints
        WHERE table_schema = DATABASE() AND table_name = 'package_media'
        ORDER BY constraint_name`,
    );

    assert.deepEqual(
      rows.map((row) => row.conname).sort(),
      [
        'PRIMARY',
        'package_media_alt_text_check',
        'package_media_media_asset_id_fkey',
        'package_media_media_asset_id_key',
        'package_media_package_id_fkey',
        'package_media_package_id_key',
      ].sort(),
    );

    const { rows: rules } = await dbPool.query<{ conname: string; rule: string }>(
      `SELECT constraint_name AS conname, delete_rule AS rule
         FROM information_schema.referential_constraints
        WHERE constraint_schema = DATABASE() AND table_name = 'package_media'`,
    );

    for (const name of ['package_media_package_id_fkey', 'package_media_media_asset_id_fkey']) {
      const fk = rules.find((row) => row.conname === name);
      assert.equal(fk?.rule, 'RESTRICT', `${name} should be ON DELETE RESTRICT`);
    }
  });

  it('adds no index beyond the ones its constraints require', async () => {
    const { rows } = await dbPool.query<{ indexname: string }>(
      `SELECT DISTINCT index_name AS indexname FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'package_media'`,
    );

    assert.deepEqual(
      rows.map((row) => row.indexname).sort(),
      ['package_media_media_asset_id_key', 'package_media_package_id_key', 'PRIMARY'].sort(),
    );
  });
});

describe('package_media: integrity', () => {
  it('accepts one image for a journey, with alt text', async () => {
    const packageId = await createPackage();
    const assetId = await createAsset();

    const id = await insertMedia(packageId, assetId, 'Dawn over the plateau');

    const { rows } = await dbPool.query<{
      package_id: string;
      media_asset_id: string;
      alt_text: string | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT package_id, media_asset_id, alt_text, created_at, updated_at FROM package_media WHERE id = $1', [id]);

    assert.equal(rows[0]!.package_id, packageId);
    assert.equal(rows[0]!.media_asset_id, assetId);
    assert.equal(rows[0]!.alt_text, 'Dawn over the plateau');
    assert.ok(rows[0]!.created_at instanceof Date, 'created_at defaults to UTC_TIMESTAMP(3)');
    assert.ok(rows[0]!.updated_at instanceof Date, 'updated_at defaults to UTC_TIMESTAMP(3)');
  });

  it('accepts a null alt text, because a decorative image is a real case', async () => {
    const id = await insertMedia(await createPackage(), await createAsset(), null);

    const { rows } = await dbPool.query<{ alt_text: string | null }>(
      'SELECT alt_text FROM package_media WHERE id = $1',
      [id],
    );

    assert.equal(rows[0]!.alt_text, null);
  });

  it('accepts alt text of exactly 240 characters', async () => {
    const id = await insertMedia(await createPackage(), await createAsset(), 'x'.repeat(240));

    const { rows } = await dbPool.query<{ length: number }>(
      'SELECT CHAR_LENGTH(alt_text) AS length FROM package_media WHERE id = $1',
      [id],
    );

    assert.equal(Number(rows[0]!.length), 240, 'the ceiling itself is inside the rule, not outside it');
  });

  it('refuses alt text of 241 characters', async () => {
    const packageId = await createPackage();
    const assetId = await createAsset();

    assert.deepEqual(await violation(() => insertMedia(packageId, assetId, 'x'.repeat(241))), {
      code: '23514',
      constraint: 'package_media_alt_text_check',
    });
  });

  it('refuses a second image for the same journey', async () => {
    const packageId = await createPackage();
    await insertMedia(packageId, await createAsset());
    const secondAsset = await createAsset();

    // The whole of the one-image-per-journey rule, stated by the schema.
    assert.deepEqual(await violation(() => insertMedia(packageId, secondAsset)), {
      code: '23505',
      constraint: 'package_media_package_id_key',
    });
  });

  it('refuses the same asset placed on a second journey', async () => {
    const assetId = await createAsset();
    await insertMedia(await createPackage(), assetId);
    const otherPackage = await createPackage();

    // One asset, one placement — otherwise two rows could delete each
    // other's bytes.
    assert.deepEqual(await violation(() => insertMedia(otherPackage, assetId)), {
      code: '23505',
      constraint: 'package_media_media_asset_id_key',
    });
  });

  it('refuses a relation for a journey that does not exist', async () => {
    const assetId = await createAsset();

    // Not RESTRICT-mediated: an insert naming an absent parent is an ordinary
    // foreign-key violation on every server version, so the code stays pinned.
    assert.deepEqual(await violation(() => insertMedia('987654321', assetId)), {
      code: '23503',
      constraint: 'package_media_package_id_fkey',
    });
  });

  it('refuses to delete a journey while its image relation stands', async () => {
    const packageId = await createPackage();
    await insertMedia(packageId, await createAsset());

    // The obstacle the journey hard-delete path has to be taught about. A
    // CASCADE here would silently strand the media_assets row instead.
    assertRestrictRefusal(
      await violation(() => dbPool.query('DELETE FROM packages WHERE id = $1', [packageId])),
      'package_media_package_id_fkey',
    );
  });

  it('refuses to delete a media asset while its image relation stands', async () => {
    const assetId = await createAsset();
    await insertMedia(await createPackage(), assetId);

    assertRestrictRefusal(
      await violation(() => dbPool.query('DELETE FROM media_assets WHERE id = $1', [assetId])),
      'package_media_media_asset_id_fkey',
    );
  });

  it('lets both go once the relation is removed, in that order', async () => {
    const packageId = await createPackage();
    const assetId = await createAsset();
    const mediaId = await insertMedia(packageId, assetId);

    // This is the ordering the delete-image and journey-hard-delete
    // algorithms both follow: the relation first, then what it pointed at.
    await dbPool.query('DELETE FROM package_media WHERE id = $1', [mediaId]);
    await dbPool.query('DELETE FROM media_assets WHERE id = $1', [assetId]);
    await dbPool.query('DELETE FROM packages WHERE id = $1', [packageId]);

    const { rows } = await dbPool.query<{ media: number; assets: number; packages: number }>(
      `SELECT
         (SELECT CAST(COUNT(*) AS SIGNED) FROM package_media WHERE id = $1) AS media,
         (SELECT CAST(COUNT(*) AS SIGNED) FROM media_assets WHERE id = $2) AS assets,
         (SELECT CAST(COUNT(*) AS SIGNED) FROM packages WHERE id = $3) AS packages`,
      [mediaId, assetId, packageId],
    );

    assert.deepEqual({ media: Number(rows[0]!.media), assets: Number(rows[0]!.assets), packages: Number(rows[0]!.packages) }, { media: 0, assets: 0, packages: 0 });
  });

  it('leaves the asset alone when only the relation is removed', async () => {
    const assetId = await createAsset();
    const mediaId = await insertMedia(await createPackage(), assetId);

    await dbPool.query('DELETE FROM package_media WHERE id = $1', [mediaId]);

    const { rows } = await dbPool.query<{ n: number }>(
      'SELECT CAST(COUNT(*) AS SIGNED) AS n FROM media_assets WHERE id = $1',
      [assetId],
    );

    // No cascade in this direction either: removing a placement must never
    // discard the asset row on its own, because deleting the object from
    // storage is a separate, post-commit step the caller owns.
    assert.equal(Number(rows[0]!.n), 1);
  });
});
