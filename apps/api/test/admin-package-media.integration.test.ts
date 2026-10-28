import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';

// A journey's one image, against real PostgreSQL.
//
// The unit suite models the transactions; this proves the parts only the
// schema can settle: that `UNIQUE (package_id)` is what makes one image per
// journey true, that the two RESTRICT foreign keys force the statement order
// the service uses, that a replacement really does leave exactly one
// relation and one live asset, and that two writers racing the same journey
// serialize on the package row rather than both winning.
//
// Storage is an in-memory double throughout. **Nothing here contacts R2** —
// the point of these tests is the database half of the seam, and the object
// half is covered by the mocked-storage unit suite.
//
// Every row this suite writes carries an identifier unique to the run, and
// exactly those rows are removed afterwards.

// Uses the dedicated migrated disposable cluster, never hotel development.
const target = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(process.env.PACKAGES_DISPOSABLE_TEST, '1');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '3307');
assert.match(target.pathname, /^\/hotel_[a-z_]*test$/);
assert.equal(target.search, '');

type Pool = typeof import('../src/db/pool.js');
type ServiceModule = typeof import('../src/modules/admin-package-media/admin-package-media.service.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let uploadPackageImage: ServiceModule['uploadPackageImage'];
let replacePackageImage: ServiceModule['replacePackageImage'];
let deletePackageImage: ServiceModule['deletePackageImage'];
let updatePackageImageAltText: ServiceModule['updatePackageImageAltText'];

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-PKGIMG-${runId}`;
const slugPrefix = `itest-pkgimg-${runId}`;

let sequence = 0;
let jpegBody: Buffer;

/** An in-memory `MediaStorage`. No network, no SDK, no R2. */
function fakeStorage(options: { failDelete?: boolean } = {}) {
  const objects = new Set<string>();
  const puts: string[] = [];
  const deletes: string[] = [];

  return {
    objects,
    puts,
    deletes,
    storage: {
      async putObject(input: { key: string }) {
        puts.push(input.key);
        objects.add(input.key);
      },
      async deleteObject(key: string) {
        deletes.push(key);
        if (options.failDelete) {
          throw new Error('storage unavailable');
        }
        objects.delete(key);
      },
    } as never,
  };
}

async function createJourney(): Promise<{ packageId: string; slug: string }> {
  sequence += 1;
  const slug = `${slugPrefix}-${sequence}`;

  const inserted = await dbPool.query(
    `INSERT INTO packages (code, slug, title, is_active, seed_managed)
     VALUES ($1, $2, 'Journey image fixture', false, true)`,
    [`${codePrefix}-${sequence}`, slug],
  );

  return { packageId: inserted.insertId!, slug };
}

async function mediaState(packageId: string): Promise<{
  relations: number;
  assets: number;
  reference: string | null;
  altText: string | null;
  storageKey: string | null;
}> {
  const { rows } = await dbPool.query<{
    relations: number;
    assets: number;
    reference: string | null;
    alt_text: string | null;
    storage_key: string | null;
  }>(
    `SELECT
       (SELECT CAST(COUNT(*) AS SIGNED) FROM package_media WHERE package_id = $1) AS relations,
       (SELECT CAST(COUNT(*) AS SIGNED) FROM package_media pm
          JOIN media_assets ma ON ma.id = pm.media_asset_id
         WHERE pm.package_id = $1) AS assets,
       (SELECT ma.reference FROM package_media pm
          JOIN media_assets ma ON ma.id = pm.media_asset_id
         WHERE pm.package_id = $1) AS reference,
       (SELECT alt_text FROM package_media WHERE package_id = $1) AS alt_text,
       (SELECT ma.storage_key FROM package_media pm
          JOIN media_assets ma ON ma.id = pm.media_asset_id
         WHERE pm.package_id = $1) AS storage_key`,
    [packageId],
  );

  const row = rows[0]!;

  return {
    relations: Number(row.relations),
    assets: Number(row.assets),
    reference: row.reference,
    altText: row.alt_text,
    storageKey: row.storage_key,
  };
}

/** The whole of the asset row a journey's image points at. */
async function assetRow(packageId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await dbPool.query(
    `SELECT ma.id, ma.reference, ma.storage_key, ma.content_type, CAST(ma.byte_size AS CHAR) AS byte_size,
            ma.checksum_sha256, ma.width, ma.height, ma.created_at
       FROM package_media pm
       JOIN media_assets ma ON ma.id = pm.media_asset_id
      WHERE pm.package_id = $1`,
    [packageId],
  );

  return rows[0] ?? null;
}

async function seedManaged(packageId: string): Promise<boolean> {
  const { rows } = await dbPool.query<{ seed_managed: boolean }>(
    'SELECT seed_managed FROM packages WHERE id = $1',
    [packageId],
  );

  return rows[0]!.seed_managed;
}

/** How many `media_assets` rows exist for the keys this run created. */
async function assetCount(keys: string[]): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }

  const { rows } = await dbPool.query<{ n: number }>(
    'SELECT CAST(COUNT(*) AS SIGNED) AS n FROM media_assets WHERE storage_key IN ($1)',
    [keys],
  );

  return Number(rows[0]!.n);
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  ({ uploadPackageImage, replacePackageImage, deletePackageImage, updatePackageImageAltText } =
    await import('../src/modules/admin-package-media/admin-package-media.service.js'));

  jpegBody = await sharp({
    create: { width: 32, height: 20, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
    .jpeg()
    .toBuffer();
});

after(async () => {
  // Relations first: both foreign keys are RESTRICT, so neither the journey
  // nor the asset can go while one still stands.
  const { rows: assetRows } = await dbPool.query<{ media_asset_id: string }>(
    `SELECT pm.media_asset_id
       FROM package_media pm
       JOIN packages p ON p.id = pm.package_id
      WHERE p.code LIKE $1`,
    [`${codePrefix}%`],
  );

  await dbPool.query(
    `DELETE FROM package_media
      WHERE package_id IN (SELECT id FROM packages WHERE code LIKE $1)`,
    [`${codePrefix}%`],
  );

  if (assetRows.length > 0) {
    await dbPool.query('DELETE FROM media_assets WHERE id IN ($1)', [
      assetRows.map((row) => row.media_asset_id),
    ]);
  }

  await dbPool.query('DELETE FROM packages WHERE code LIKE $1', [`${codePrefix}%`]);

  const { rows } = await dbPool.query<{ n: number }>(
    'SELECT CAST(COUNT(*) AS SIGNED) AS n FROM packages WHERE code LIKE $1',
    [`${codePrefix}%`],
  );
  assert.equal(Number(rows[0]!.n), 0, 'every fixture this run created was removed');

  await closeDatabasePool();
});

const upload = (slug: string, storage: never) =>
  uploadPackageImage({ storage }, { slug, declaredContentType: 'image/jpeg', body: jpegBody });

const replace = (slug: string, storage: never) =>
  replacePackageImage({ storage }, { slug, declaredContentType: 'image/jpeg', body: jpegBody });

describe('journey image: adding one', () => {
  it('creates exactly one relation and one asset', async () => {
    const journey = await createJourney();
    const fake = fakeStorage();

    const result = await upload(journey.slug, fake.storage);

    assert.equal(result.outcome, 'uploaded');

    const state = await mediaState(journey.packageId);
    assert.equal(state.relations, 1);
    assert.equal(state.assets, 1, 'the relation resolves to a live asset');
    assert.equal(state.altText, null, 'an upload carries bytes, never a description');

    // The object the row names is the one that was written.
    assert.deepEqual(fake.puts, [state.storageKey]);
    assert.deepEqual(fake.deletes, [], 'nothing is removed on a clean upload');
  });

  it('refuses a second one, and takes its object back', async () => {
    const journey = await createJourney();
    const first = fakeStorage();
    await upload(journey.slug, first.storage);

    const before = await mediaState(journey.packageId);
    const second = fakeStorage();

    const result = await upload(journey.slug, second.storage);

    assert.equal(result.outcome, 'image-exists');

    const after = await mediaState(journey.packageId);
    assert.equal(after.relations, 1, 'still exactly one');
    assert.equal(after.reference, before.reference, 'and still the first one');

    // The second upload wrote its object before it could know, and removed
    // it again when the lock told it the answer.
    assert.equal(second.puts.length, 1);
    assert.deepEqual(second.deletes, second.puts);
    assert.equal(second.objects.size, 0);
  });

  it('refuses a journey nothing matches', async () => {
    const fake = fakeStorage();

    const result = await upload(`${slugPrefix}-absent`, fake.storage);

    assert.equal(result.outcome, 'package-not-found');
    assert.deepEqual(fake.deletes, fake.puts, 'the object it wrote first is taken back');
  });

  it('leaves seed_managed exactly as it was', async () => {
    const journey = await createJourney();
    assert.equal(await seedManaged(journey.packageId), true, 'the fixture starts seed-owned');

    await upload(journey.slug, fakeStorage().storage);

    assert.equal(
      await seedManaged(journey.packageId),
      true,
      'an image says nothing about who owns the catalogue text',
    );
  });
});

describe('journey image: replacing it', () => {
  it('leaves exactly one relation and one live asset, and drops the old row', async () => {
    const journey = await createJourney();
    const fake = fakeStorage();

    await upload(journey.slug, fake.storage);
    const before = await mediaState(journey.packageId);

    const result = await replace(journey.slug, fake.storage);

    assert.equal(result.outcome, 'replaced');

    const after = await mediaState(journey.packageId);
    assert.equal(after.relations, 1, 'still exactly one relation');
    assert.equal(after.assets, 1, 'pointing at exactly one live asset');
    assert.notEqual(after.reference, before.reference, 'and it is the new one');

    // The displaced asset row is gone, not merely unreferenced.
    assert.equal(await assetCount([before.storageKey!]), 0);
    assert.equal(await assetCount([after.storageKey!]), 1);

    // The old object was removed, the new one kept.
    assert.deepEqual(fake.deletes, [before.storageKey]);
    assert.deepEqual([...fake.objects], [after.storageKey]);
  });

  it('preserves the alt text through the swap', async () => {
    const journey = await createJourney();
    const fake = fakeStorage();

    await upload(journey.slug, fake.storage);
    await dbPool.query('UPDATE package_media SET alt_text = $2 WHERE package_id = $1', [
      journey.packageId,
      'Dawn over the plateau',
    ]);

    await replace(journey.slug, fake.storage);

    assert.equal((await mediaState(journey.packageId)).altText, 'Dawn over the plateau');
  });

  it('refuses a journey with no image, and takes the new object back', async () => {
    const journey = await createJourney();
    const fake = fakeStorage();

    const result = await replace(journey.slug, fake.storage);

    assert.equal(result.outcome, 'image-not-found');
    assert.equal((await mediaState(journey.packageId)).relations, 0);
    assert.deepEqual(fake.deletes, fake.puts);
    assert.equal(fake.objects.size, 0);
  });

  it('still succeeds when the displaced object cannot be removed', async () => {
    const journey = await createJourney();
    const writer = fakeStorage();
    await upload(journey.slug, writer.storage);
    const before = await mediaState(journey.packageId);

    const failing = fakeStorage({ failDelete: true });
    const result = await replace(journey.slug, failing.storage);

    assert.equal(result.outcome, 'replaced', 'an orphan does not undo a committed swap');
    assert.equal(failing.deletes.length, 1, 'exactly one attempt');
    assert.equal((await mediaState(journey.packageId)).relations, 1);
    assert.equal(await assetCount([before.storageKey!]), 0, 'the old row still went');
  });

  it('leaves seed_managed exactly as it was', async () => {
    const journey = await createJourney();
    const fake = fakeStorage();

    await upload(journey.slug, fake.storage);
    await replace(journey.slug, fake.storage);

    assert.equal(await seedManaged(journey.packageId), true);
  });
});

describe('journey image: removing it', () => {
  it('removes the relation and the asset, then the object', async () => {
    const journey = await createJourney();
    const fake = fakeStorage();

    await upload(journey.slug, fake.storage);
    const before = await mediaState(journey.packageId);

    const result = await deletePackageImage({ storage: fake.storage }, { slug: journey.slug });

    assert.equal(result.outcome, 'deleted');
    assert.deepEqual(await mediaState(journey.packageId), {
      relations: 0,
      assets: 0,
      reference: null,
      altText: null,
      storageKey: null,
    });
    assert.equal(await assetCount([before.storageKey!]), 0, 'the asset row went too');
    assert.deepEqual(fake.deletes, [before.storageKey]);
    assert.equal(fake.objects.size, 0);
  });

  it('refuses a journey with no image', async () => {
    const journey = await createJourney();
    const fake = fakeStorage();

    const result = await deletePackageImage({ storage: fake.storage }, { slug: journey.slug });

    assert.equal(result.outcome, 'image-not-found');
    assert.deepEqual(fake.deletes, [], 'nothing committed, nothing removed');
  });

  it('refuses a journey nothing matches', async () => {
    const fake = fakeStorage();

    const result = await deletePackageImage(
      { storage: fake.storage },
      { slug: `${slugPrefix}-absent` },
    );

    assert.equal(result.outcome, 'package-not-found');
    assert.deepEqual(fake.deletes, []);
  });

  it('leaves seed_managed exactly as it was', async () => {
    const journey = await createJourney();
    const fake = fakeStorage();

    await upload(journey.slug, fake.storage);
    await deletePackageImage({ storage: fake.storage }, { slug: journey.slug });

    assert.equal(await seedManaged(journey.packageId), true);
  });
});

describe('journey image: the package row serializes everything', () => {
  it('lets only one of two concurrent first uploads create a row', async () => {
    const journey = await createJourney();
    const left = fakeStorage();
    const right = fakeStorage();

    // Both write their object, then queue on `packages … FOR UPDATE`. The
    // loser sees the winner's committed row and takes its own object back.
    const [a, b] = await Promise.all([
      upload(journey.slug, left.storage),
      upload(journey.slug, right.storage),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    assert.deepEqual(outcomes, ['image-exists', 'uploaded']);

    const state = await mediaState(journey.packageId);
    assert.equal(state.relations, 1, 'the unique constraint is never even reached');
    assert.equal(state.assets, 1);

    // Two objects written, exactly one removed, and the survivor is the one
    // the row names.
    const written = [...left.puts, ...right.puts];
    const removed = [...left.deletes, ...right.deletes];
    assert.equal(written.length, 2);
    assert.equal(removed.length, 1);
    assert.ok(written.includes(state.storageKey!));
    assert.ok(!removed.includes(state.storageKey!), 'the live object is never the one removed');
  });

  it('leaves exactly one image after two concurrent replacements', async () => {
    const journey = await createJourney();
    const seed = fakeStorage();
    await upload(journey.slug, seed.storage);

    const left = fakeStorage();
    const right = fakeStorage();

    const [a, b] = await Promise.all([
      replace(journey.slug, left.storage),
      replace(journey.slug, right.storage),
    ]);

    assert.deepEqual([a.outcome, b.outcome], ['replaced', 'replaced']);

    const state = await mediaState(journey.packageId);
    assert.equal(state.relations, 1, 'still exactly one');
    assert.equal(state.assets, 1, 'pointing at a live asset');

    // Three objects existed across the run; the two displaced ones were each
    // removed once, and the survivor is the one the row names.
    const written = [...seed.puts, ...left.puts, ...right.puts];
    assert.equal(written.length, 3);
    assert.ok(written.includes(state.storageKey!));
  });

  it('serializes a replacement against the journey hard delete', async () => {
    // Both take `packages … FOR UPDATE` first, so whichever loses observes
    // the other's committed state instead of writing over it.
    const { deleteAdminPackage } = await import(
      '../src/modules/admin-packages/admin-packages.repository.js'
    );

    const journey = await createJourney();
    const fake = fakeStorage();
    await upload(journey.slug, fake.storage);

    const [replaced, deleted] = await Promise.all([
      replace(journey.slug, fake.storage),
      deleteAdminPackage(journey.slug),
    ]);

    if (deleted.outcome === 'deleted') {
      // The journey went. Whatever the replacement did, no relation survives
      // it — the hard delete removes the media rows inside its own
      // transaction, and `package_media_package_id_fkey` would have refused
      // the delete otherwise.
      const { rows } = await dbPool.query<{ n: number }>(
        'SELECT CAST(COUNT(*) AS SIGNED) AS n FROM package_media WHERE package_id = $1',
        [journey.packageId],
      );
      assert.equal(Number(rows[0]!.n), 0);
    } else {
      // The replacement won the lock and the delete then refused, or the
      // delete refused for its own reasons. Either way exactly one image.
      assert.equal(replaced.outcome, 'replaced');
      assert.equal((await mediaState(journey.packageId)).relations, 1);
    }
  });
});

describe('journey image: describing it', () => {
  it('persists a description, and the asset it describes does not move', async () => {
    const journey = await createJourney();
    const fake = fakeStorage();
    await upload(journey.slug, fake.storage);

    const before = await mediaState(journey.packageId);
    const beforeAsset = await assetRow(journey.packageId);

    const result = await updatePackageImageAltText({
      slug: journey.slug,
      altText: '  Dawn over the plateau  ',
    });

    assert.equal(result.outcome, 'updated');

    const after = await mediaState(journey.packageId);
    assert.equal(after.altText, 'Dawn over the plateau', 'trimmed by the shared rule');
    assert.equal(after.reference, before.reference, 'the same image is still placed');
    assert.equal(after.relations, 1);

    // `package_media` keeps its asset, and `media_assets` is untouched: an
    // asset is immutable and the description belongs to the placement.
    assert.deepEqual(await assetRow(journey.packageId), beforeAsset);

    // No object was written or removed by describing one.
    assert.deepEqual(fake.deletes, []);
    assert.equal(fake.puts.length, 1, 'still just the upload');
  });

  it('clears the description back to NULL', async () => {
    const journey = await createJourney();
    await upload(journey.slug, fakeStorage().storage);

    await updatePackageImageAltText({ slug: journey.slug, altText: 'Something' });
    assert.equal((await mediaState(journey.packageId)).altText, 'Something');

    const result = await updatePackageImageAltText({ slug: journey.slug, altText: null });

    assert.equal(result.outcome, 'updated');
    assert.equal((await mediaState(journey.packageId)).altText, null);
  });

  it('stores whitespace-only as NULL, the way the shared rule decides', async () => {
    const journey = await createJourney();
    await upload(journey.slug, fakeStorage().storage);

    await updatePackageImageAltText({ slug: journey.slug, altText: '   ' });

    assert.equal((await mediaState(journey.packageId)).altText, null);
  });

  it('accepts the column ceiling and is refused one character past it', async () => {
    const { MAX_ALT_TEXT_LENGTH } = await import('../src/modules/media/media.types.js');
    const journey = await createJourney();
    await upload(journey.slug, fakeStorage().storage);

    const atLimit = 'x'.repeat(MAX_ALT_TEXT_LENGTH);
    assert.equal(
      (await updatePackageImageAltText({ slug: journey.slug, altText: atLimit })).outcome,
      'updated',
    );
    assert.equal((await mediaState(journey.packageId)).altText, atLimit);

    // Refused by the application before the column's own CHECK is reached,
    // so the two can never disagree about where 240 is.
    assert.equal(
      (await updatePackageImageAltText({ slug: journey.slug, altText: `${atLimit}x` })).outcome,
      'invalid-alt-text',
    );
    assert.equal((await mediaState(journey.packageId)).altText, atLimit, 'unchanged');
  });

  it('refuses a journey with no image', async () => {
    const journey = await createJourney();

    const result = await updatePackageImageAltText({ slug: journey.slug, altText: 'text' });

    assert.equal(result.outcome, 'image-not-found');
    assert.equal((await mediaState(journey.packageId)).relations, 0);
  });

  it('refuses a journey nothing matches', async () => {
    const result = await updatePackageImageAltText({
      slug: `${slugPrefix}-absent`,
      altText: 'text',
    });

    assert.equal(result.outcome, 'package-not-found');
  });

  it('leaves seed_managed exactly as it was', async () => {
    const journey = await createJourney();
    await upload(journey.slug, fakeStorage().storage);

    await updatePackageImageAltText({ slug: journey.slug, altText: 'text' });

    assert.equal(await seedManaged(journey.packageId), true);
  });

  it('survives a replacement, which never names alt_text', async () => {
    const journey = await createJourney();
    const fake = fakeStorage();
    await upload(journey.slug, fake.storage);

    await updatePackageImageAltText({ slug: journey.slug, altText: 'Written first' });
    const before = await mediaState(journey.packageId);

    await replace(journey.slug, fake.storage);

    const after = await mediaState(journey.packageId);
    assert.equal(after.altText, 'Written first', 'the words outlive the picture');
    assert.notEqual(after.reference, before.reference, 'and the picture really did change');
  });

  it('serializes against a competing replacement on the package row', async () => {
    // Both take `packages … FOR UPDATE` first. Whichever is second sees the
    // other's committed state, so the end state is always one image with one
    // description rather than a half-applied mixture.
    const journey = await createJourney();
    const fake = fakeStorage();
    await upload(journey.slug, fake.storage);

    const [described, replaced] = await Promise.all([
      updatePackageImageAltText({ slug: journey.slug, altText: 'Racing description' }),
      replace(journey.slug, fake.storage),
    ]);

    assert.equal(described.outcome, 'updated');
    assert.equal(replaced.outcome, 'replaced');

    const state = await mediaState(journey.packageId);
    assert.equal(state.relations, 1, 'exactly one relation');
    assert.equal(state.assets, 1, 'pointing at a live asset');
    // Whichever order they landed in, the description is there: a
    // replacement never clears it, and the PATCH only ever sets it.
    assert.equal(state.altText, 'Racing description');
  });

  it('serializes against a competing delete on the package row', async () => {
    const journey = await createJourney();
    const fake = fakeStorage();
    await upload(journey.slug, fake.storage);

    const [described, deleted] = await Promise.all([
      updatePackageImageAltText({ slug: journey.slug, altText: 'Racing description' }),
      deletePackageImage({ storage: fake.storage }, { slug: journey.slug }),
    ]);

    assert.equal(deleted.outcome, 'deleted', 'the delete always wins eventually');

    const state = await mediaState(journey.packageId);
    assert.equal(state.relations, 0, 'and the image is gone either way');

    // If the PATCH got the lock first it described an image that was then
    // removed; if the delete got there first the PATCH found nothing. Both
    // are correct, and neither leaves a row behind.
    assert.ok(
      described.outcome === 'updated' || described.outcome === 'image-not-found',
      `unexpected ${described.outcome}`,
    );
  });
});
