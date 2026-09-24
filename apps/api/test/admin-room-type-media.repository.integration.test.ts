import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { after, before, beforeEach, describe, it } from 'node:test';

// Exercises the room-type media repository against real PostgreSQL: the real
// SQL, the real constraints, the real partial unique index and the real row
// locks. Nothing is mocked, and nothing contacts object storage — this layer
// never does.
//
// Every fixture carries identifiers unique to this run and is removed
// afterwards. No other data is read for assertions or deleted.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');
type MediaRepository = typeof import('../src/modules/media/media.repository.js');
type Repository = typeof import('../src/modules/admin-room-type-media/admin-room-type-media.repository.js');
type ScopedRoomTypeImage =
  import('../src/modules/admin-room-type-media/admin-room-type-media.types.js').ScopedRoomTypeImage;

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let repository: Repository;
let mediaRepository: MediaRepository;

const runId = randomUUID().slice(0, 8);
const slugPrefix = `itest-media-repo-${runId}`;
const keyPrefix = `media/${runId}`;

const slugs = {
  gallery: `${slugPrefix}-gallery`,
  other: `${slugPrefix}-other`,
  work: `${slugPrefix}-work`,
  locks: `${slugPrefix}-locks`,
  empty: `${slugPrefix}-empty`,
} as const;

const roomTypeIds: Record<string, string> = {};

/** Row counts of the tables this suite must not disturb, taken before it runs. */
let untouchedBefore: { rooms: number; reservations: number };

let keySeq = 0;

/** Normalized-WebP metadata, as the pipeline would have measured it. */
function assetInput() {
  const reference = randomUUID();
  const seq = (keySeq += 1);

  return {
    reference,
    storageKey: `${keyPrefix}-${seq}.webp`,
    contentType: 'image/webp' as never,
    byteSize: 100_000 + seq,
    checksumSha256: createHash('sha256').update(`${runId}-${seq}`).digest('hex'),
    width: 1600,
    height: 900,
  };
}

/**
 * Adds one image to a room type, exercising the real insert path.
 *
 * Deliberately takes explicit `sortOrder` and `isCover`: choosing either is
 * the service's job, and a test helper that decided them would be testing
 * itself.
 */
async function addImage(
  client: PoolClient,
  roomTypeId: string,
  options: { sortOrder: number; isCover?: boolean; altText?: string | null } = { sortOrder: 0 },
): Promise<ScopedRoomTypeImage> {
  const asset = await mediaRepository.insertMediaAsset(client, assetInput());

  return repository.insertRoomTypeImage(client, {
    roomTypeId,
    mediaAssetId: asset.mediaAssetId,
    altText: options.altText ?? null,
    sortOrder: options.sortOrder,
    isCover: options.isCover ?? false,
  });
}

/** Runs something on its own client inside a transaction, then commits. */
async function inTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');

    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** The gallery as the repository reports it, by reference. */
async function references(roomTypeId: string): Promise<string[]> {
  const images = await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId));

  return images.map((image) => image.reference);
}

async function sortOrders(roomTypeId: string): Promise<number[]> {
  const { rows } = await dbPool.query<{ sort_order: number }>(
    `SELECT sort_order FROM room_type_images WHERE room_type_id = $1 ORDER BY sort_order ASC, id ASC`,
    [roomTypeId],
  );

  return rows.map((row) => row.sort_order);
}

async function coverCount(roomTypeId: string): Promise<number> {
  const { rows } = await dbPool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM room_type_images WHERE room_type_id = $1 AND is_cover`,
    [roomTypeId],
  );

  return rows[0]!.total;
}

async function insertRoomType(slug: string): Promise<string> {
  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, 2, '1500.00', false, 0)
     RETURNING id`,
    [slug, `Fixture ${slug}`],
  );

  roomTypeIds[slug] = rows[0]!.id;

  return rows[0]!.id;
}

/**
 * Removes every image of one room type, so a test can start from empty.
 *
 * Relations first, then the assets they pointed at — the other order is
 * refused by the RESTRICT foreign key, which is itself worth relying on here.
 */
async function clearImages(roomTypeId: string): Promise<void> {
  const { rows } = await dbPool.query<{ media_asset_id: string }>(
    'SELECT media_asset_id FROM room_type_images WHERE room_type_id = $1',
    [roomTypeId],
  );

  await dbPool.query('DELETE FROM room_type_images WHERE room_type_id = $1', [roomTypeId]);

  if (rows.length > 0) {
    await dbPool.query('DELETE FROM media_assets WHERE id = ANY($1)', [rows.map((row) => row.media_asset_id)]);
  }
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  mediaRepository = await import('../src/modules/media/media.repository.js');
  repository = await import('../src/modules/admin-room-type-media/admin-room-type-media.repository.js');

  const { rows } = await dbPool.query<{ rooms: number; reservations: number }>(
    `SELECT (SELECT COUNT(*) FROM rooms)::int AS rooms,
            (SELECT COUNT(*) FROM reservations)::int AS reservations`,
  );

  untouchedBefore = rows[0]!;

  for (const slug of Object.values(slugs)) {
    await insertRoomType(slug);
  }
});

after(async () => {
  try {
    const like = `${slugPrefix}-%`;

    await dbPool.query(
      'DELETE FROM room_type_images WHERE room_type_id IN (SELECT id FROM room_types WHERE slug LIKE $1)',
      [like],
    );
    await dbPool.query('DELETE FROM media_assets WHERE storage_key LIKE $1', [`${keyPrefix}-%`]);
    await dbPool.query('DELETE FROM room_types WHERE slug LIKE $1', [like]);

    const { rows } = await dbPool.query<{
      types: number;
      assets: number;
      images: number;
      rooms: number;
      reservations: number;
    }>(
      `SELECT (SELECT COUNT(*) FROM room_types WHERE slug LIKE $1)::int AS types,
              (SELECT COUNT(*) FROM media_assets WHERE storage_key LIKE $2)::int AS assets,
              (SELECT COUNT(*) FROM room_type_images)::int AS images,
              (SELECT COUNT(*) FROM rooms)::int AS rooms,
              (SELECT COUNT(*) FROM reservations)::int AS reservations`,
      [like, `${keyPrefix}-%`],
    );

    assert.deepEqual(
      { types: rows[0]!.types, assets: rows[0]!.assets, rooms: rows[0]!.rooms, reservations: rows[0]!.reservations },
      { types: 0, assets: 0, ...untouchedBefore },
      'fixtures were not fully removed, or rows this suite must not touch changed',
    );
  } finally {
    await closeDatabasePool();
  }
});

describe('resolving and locking a room type', () => {
  it('finds a room type by its canonical slug', async () => {
    const resolved = await inTransaction((client) => repository.findRoomTypeForMedia(client, slugs.gallery));

    assert.deepEqual(resolved, { roomTypeId: roomTypeIds[slugs.gallery], slug: slugs.gallery });
  });

  it('returns null for a slug nobody has used', async () => {
    const resolved = await inTransaction((client) =>
      repository.findRoomTypeForMedia(client, `${slugPrefix}-nope`),
    );

    assert.equal(resolved, null);
  });

  it('matches the slug exactly, without repairing it', async () => {
    for (const slug of [slugs.gallery.toUpperCase(), ` ${slugs.gallery}`, `${slugs.gallery} `]) {
      assert.equal(await inTransaction((client) => repository.findRoomTypeForMedia(client, slug)), null);
    }
  });

  it('returns null from the locking lookup too, taking no lock', async () => {
    const resolved = await inTransaction((client) =>
      repository.lockRoomTypeForMediaChange(client, `${slugPrefix}-nope`),
    );

    assert.equal(resolved, null);
  });

  it('takes a real row lock that a second transaction must wait for', async () => {
    const holder = await dbPool.connect();
    const contender = await dbPool.connect();

    try {
      await holder.query('BEGIN');
      const locked = await repository.lockRoomTypeForMediaChange(holder, slugs.locks);
      assert.ok(locked);

      // NOWAIT turns "would block" into an error, which is how a lock can be
      // observed without the test hanging if it were absent.
      await contender.query('BEGIN');
      await assert.rejects(
        () => contender.query(`SELECT id FROM room_types WHERE slug = $1 FOR UPDATE NOWAIT`, [slugs.locks]),
        (error: { code?: string }) => {
          assert.equal(error.code, '55P03', 'lock_not_available');

          return true;
        },
        'the parent row was not locked FOR UPDATE',
      );
      await contender.query('ROLLBACK');

      // Once the holder commits, the same statement succeeds.
      await holder.query('COMMIT');

      await contender.query('BEGIN');
      const { rowCount } = await contender.query(
        `SELECT id FROM room_types WHERE slug = $1 FOR UPDATE NOWAIT`,
        [slugs.locks],
      );
      assert.equal(rowCount, 1);
      await contender.query('ROLLBACK');
    } finally {
      holder.release();
      contender.release();
    }
  });

  it('does not lock the row on the read-only lookup', async () => {
    const reader = await dbPool.connect();
    const contender = await dbPool.connect();

    try {
      await reader.query('BEGIN');
      await repository.findRoomTypeForMedia(reader, slugs.locks);

      await contender.query('BEGIN');
      const { rowCount } = await contender.query(
        `SELECT id FROM room_types WHERE slug = $1 FOR UPDATE NOWAIT`,
        [slugs.locks],
      );

      assert.equal(rowCount, 1, 'a plain read must not block a writer');
      await contender.query('ROLLBACK');
      await reader.query('ROLLBACK');
    } finally {
      reader.release();
      contender.release();
    }
  });
});

describe('inserting, counting and the next order', () => {
  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  it('persists exactly the metadata it was given', async () => {
    const input = assetInput();

    const record = await inTransaction((client) => mediaRepository.insertMediaAsset(client, input));

    assert.equal(record.reference, input.reference);
    assert.equal(record.storageKey, input.storageKey);
    assert.equal(record.contentType, 'image/webp');
    assert.equal(record.byteSize, input.byteSize);
    assert.equal(record.checksumSha256, input.checksumSha256);
    assert.equal(record.width, 1600);
    assert.equal(record.height, 900);
    assert.match(record.mediaAssetId, /^[1-9]\d*$/, 'a bigint id kept as a string');
    assert.ok(record.createdAt instanceof Date);
  });

  it('inserts a relation and reports its scoped identity', async () => {
    const image = await inTransaction((client) =>
      addImage(client, roomTypeIds[slugs.work]!, { sortOrder: 0, isCover: true, altText: 'A terrace at dusk.' }),
    );

    assert.match(image.imageId, /^[1-9]\d*$/);
    assert.match(image.mediaAssetId, /^[1-9]\d*$/);
    assert.match(image.reference, /^[0-9a-f-]{36}$/);
    assert.equal(image.sortOrder, 0);
    assert.equal(image.isCover, true);
  });

  it('counts what is there', async () => {
    const roomTypeId = roomTypeIds[slugs.work]!;

    assert.equal(await inTransaction((client) => repository.countRoomTypeImages(client, roomTypeId)), 0);

    await inTransaction(async (client) => {
      await addImage(client, roomTypeId, { sortOrder: 0 });
      await addImage(client, roomTypeId, { sortOrder: 1 });
    });

    assert.equal(await inTransaction((client) => repository.countRoomTypeImages(client, roomTypeId)), 2);
  });

  it('starts an empty room type at sort order 0', async () => {
    assert.equal(
      await inTransaction((client) => repository.nextRoomTypeImageSortOrder(client, roomTypeIds[slugs.empty]!)),
      0,
    );
  });

  it('derives the next order from the maximum, not from the count', async () => {
    const roomTypeId = roomTypeIds[slugs.work]!;

    // Two images, but a gap: count is 2 and the next order must be 8, not 2.
    await inTransaction(async (client) => {
      await addImage(client, roomTypeId, { sortOrder: 0 });
      await addImage(client, roomTypeId, { sortOrder: 7 });
    });

    assert.equal(await inTransaction((client) => repository.countRoomTypeImages(client, roomTypeId)), 2);
    assert.equal(
      await inTransaction((client) => repository.nextRoomTypeImageSortOrder(client, roomTypeId)),
      8,
      'count and max(sort_order) are not the same question',
    );
  });
});

describe('listing', () => {
  const roomTypeId = () => roomTypeIds[slugs.gallery]!;
  let inserted: ScopedRoomTypeImage[];

  before(async () => {
    inserted = await inTransaction(async (client) => [
      await addImage(client, roomTypeId(), { sortOrder: 0, altText: 'first' }),
      await addImage(client, roomTypeId(), { sortOrder: 1 }),
      await addImage(client, roomTypeId(), { sortOrder: 2, isCover: true }),
      await addImage(client, roomTypeId(), { sortOrder: 3 }),
    ]);

    // One image on a different room type, which must never appear below.
    await inTransaction((client) => addImage(client, roomTypeIds[slugs.other]!, { sortOrder: 0, isCover: true }));
  });

  it('joins the asset metadata onto each relation', async () => {
    const images = await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId()));
    const first = images.find((image) => image.altText === 'first');

    assert.ok(first);
    assert.equal(first.contentType, 'image/webp');
    assert.equal(first.width, 1600);
    assert.equal(first.height, 900);
    assert.match(first.checksumSha256, /^[0-9a-f]{64}$/);
    assert.ok(first.byteSize > 0);
    assert.ok(first.storageKey.startsWith('media/'));
    assert.match(first.createdAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.match(first.updatedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('exposes no internal identifier', async () => {
    const images = await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId()));

    for (const image of images) {
      assert.deepEqual(Object.keys(image).sort(), [
        'altText',
        'byteSize',
        'checksumSha256',
        'contentType',
        'createdAt',
        'height',
        'isCover',
        'reference',
        'sortOrder',
        'storageKey',
        'updatedAt',
        'width',
      ]);
    }
  });

  it('puts the cover first even though its sort order is not lowest', async () => {
    const images = await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId()));
    const cover = inserted[2]!;

    assert.equal(images[0]!.reference, cover.reference);
    assert.equal(images[0]!.isCover, true);
    assert.equal(images[0]!.sortOrder, 2, 'the cover leads without its sort order being rewritten');
  });

  it('orders the rest by sort order then id', async () => {
    const images = await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId()));

    assert.deepEqual(
      images.slice(1).map((image) => image.reference),
      [inserted[0]!.reference, inserted[1]!.reference, inserted[3]!.reference],
    );
  });

  it('excludes another room type’s images', async () => {
    const mine = await references(roomTypeId());
    const theirs = await references(roomTypeIds[slugs.other]!);

    assert.equal(mine.length, 4);
    assert.equal(theirs.length, 1);
    assert.equal(mine.includes(theirs[0]!), false);
  });
});

describe('scoped lookup: the authorization boundary', () => {
  it('finds an image inside its own room type', async () => {
    const [mine] = await references(roomTypeIds[slugs.gallery]!);
    const found = await inTransaction((client) =>
      repository.findScopedRoomTypeImage(client, roomTypeIds[slugs.gallery]!, mine!),
    );

    assert.ok(found);
    assert.equal(found.reference, mine);
  });

  it('returns null for a real reference under the wrong room type', async () => {
    const [mine] = await references(roomTypeIds[slugs.gallery]!);

    // The reference exists; it simply is not this room type's.
    const found = await inTransaction((client) =>
      repository.findScopedRoomTypeImage(client, roomTypeIds[slugs.other]!, mine!),
    );

    assert.equal(found, null, 'an image must never be reachable from a room type that does not own it');
  });

  it('returns null for a reference that does not exist', async () => {
    const found = await inTransaction((client) =>
      repository.findScopedRoomTypeImage(client, roomTypeIds[slugs.gallery]!, randomUUID()),
    );

    assert.equal(found, null);
  });

  it('answers a foreign reference and an unknown one identically', async () => {
    const [mine] = await references(roomTypeIds[slugs.gallery]!);

    const foreign = await inTransaction((client) =>
      repository.findScopedRoomTypeImage(client, roomTypeIds[slugs.other]!, mine!),
    );
    const unknown = await inTransaction((client) =>
      repository.findScopedRoomTypeImage(client, roomTypeIds[slugs.other]!, randomUUID()),
    );

    assert.deepEqual(foreign, unknown, 'the two must be indistinguishable, or references can be enumerated');
  });

  it('locks the relation when asked, and still refuses a foreign reference', async () => {
    const [mine] = await references(roomTypeIds[slugs.gallery]!);

    const locked = await inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.gallery);

      return repository.lockScopedRoomTypeImage(client, roomTypeIds[slugs.gallery]!, mine!);
    });

    assert.ok(locked);

    const foreign = await inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.other);

      return repository.lockScopedRoomTypeImage(client, roomTypeIds[slugs.other]!, mine!);
    });

    assert.equal(foreign, null);
  });
});

describe('alt text', () => {
  const roomTypeId = () => roomTypeIds[slugs.work]!;

  beforeEach(async () => {
    await clearImages(roomTypeId());
  });

  it('sets text, then clears it to null', async () => {
    const image = await inTransaction((client) => addImage(client, roomTypeId(), { sortOrder: 0 }));

    const set = await inTransaction((client) =>
      repository.updateRoomTypeImageAltText(client, roomTypeId(), image.imageId, '  already normalized  '),
    );
    assert.equal(set, true);

    let images = await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId()));
    assert.equal(
      images[0]!.altText,
      '  already normalized  ',
      'the repository stores what it is given and normalizes nothing',
    );

    const cleared = await inTransaction((client) =>
      repository.updateRoomTypeImageAltText(client, roomTypeId(), image.imageId, null),
    );
    assert.equal(cleared, true);

    images = await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId()));
    assert.equal(images[0]!.altText, null);
  });

  it('moves updated_at when it changes something', async () => {
    const image = await inTransaction((client) => addImage(client, roomTypeId(), { sortOrder: 0 }));
    const before = (await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId())))[0]!;

    await inTransaction((client) =>
      repository.updateRoomTypeImageAltText(client, roomTypeId(), image.imageId, 'changed'),
    );

    const after = (await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId())))[0]!;

    assert.ok(Date.parse(after.updatedAt) >= Date.parse(before.updatedAt));
    assert.equal(after.createdAt, before.createdAt, 'created_at must not move');
  });

  it('cannot reach an image through the wrong room type', async () => {
    const image = await inTransaction((client) => addImage(client, roomTypeId(), { sortOrder: 0 }));

    const changed = await inTransaction((client) =>
      repository.updateRoomTypeImageAltText(client, roomTypeIds[slugs.other]!, image.imageId, 'not yours'),
    );

    assert.equal(changed, false);

    const images = await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId()));
    assert.equal(images[0]!.altText, null, 'the row must be untouched');
  });
});

describe('the cover', () => {
  const roomTypeId = () => roomTypeIds[slugs.work]!;
  let images: ScopedRoomTypeImage[];

  beforeEach(async () => {
    await clearImages(roomTypeId());

    images = await inTransaction(async (client) => [
      await addImage(client, roomTypeId(), { sortOrder: 0, isCover: true }),
      await addImage(client, roomTypeId(), { sortOrder: 1 }),
      await addImage(client, roomTypeId(), { sortOrder: 2 }),
    ]);
  });

  it('clears the previous cover and promotes the target in one transaction', async () => {
    const changed = await inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.work);

      return repository.setRoomTypeImageAsCover(client, roomTypeId(), images[2]!.imageId);
    });

    assert.equal(changed, true);
    assert.equal(await coverCount(roomTypeId()), 1);

    const listed = await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId()));
    assert.equal(listed[0]!.reference, images[2]!.reference);
    assert.equal(listed[0]!.isCover, true);
  });

  it('never trips the partial unique index on the way', async () => {
    // Moving the cover twice in one transaction is the sequence that would
    // fail if the two rows were ever both flagged at once.
    await inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.work);
      await repository.setRoomTypeImageAsCover(client, roomTypeId(), images[1]!.imageId);
      await repository.setRoomTypeImageAsCover(client, roomTypeId(), images[2]!.imageId);
      await repository.setRoomTypeImageAsCover(client, roomTypeId(), images[0]!.imageId);
    });

    assert.equal(await coverCount(roomTypeId()), 1);
    assert.equal((await references(roomTypeId()))[0], images[0]!.reference);
  });

  it('is idempotent, and does not churn updated_at', async () => {
    const before = (await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId())))[0]!;

    const changed = await inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.work);

      return repository.setRoomTypeImageAsCover(client, roomTypeId(), images[0]!.imageId);
    });

    const after = (await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId())))[0]!;

    assert.equal(changed, false, 'asking the cover to become the cover changes nothing');
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(await coverCount(roomTypeId()), 1);
  });

  it('leaves another room type’s cover alone', async () => {
    const otherBefore = await coverCount(roomTypeIds[slugs.other]!);

    await inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.work);
      await repository.setRoomTypeImageAsCover(client, roomTypeId(), images[1]!.imageId);
    });

    assert.equal(await coverCount(roomTypeIds[slugs.other]!), otherBefore);
    assert.equal(await coverCount(roomTypeId()), 1);
  });

  it('finds the deterministic first image for promotion', async () => {
    const first = await inTransaction((client) => repository.findFirstRoomTypeImageId(client, roomTypeId()));

    assert.equal(first, images[0]!.imageId, 'sort_order then id');

    const none = await inTransaction((client) =>
      repository.findFirstRoomTypeImageId(client, roomTypeIds[slugs.empty]!),
    );

    assert.equal(none, null, 'an empty room type has nothing to promote');
  });
});

describe('reordering', () => {
  const roomTypeId = () => roomTypeIds[slugs.work]!;
  let images: ScopedRoomTypeImage[];

  const move = (reference: string, direction: 'up' | 'down') =>
    inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.work);

      return repository.moveRoomTypeImage(client, roomTypeId(), reference, direction);
    });

  beforeEach(async () => {
    await clearImages(roomTypeId());

    images = await inTransaction(async (client) => [
      await addImage(client, roomTypeId(), { sortOrder: 0, isCover: true }),
      await addImage(client, roomTypeId(), { sortOrder: 1 }),
      await addImage(client, roomTypeId(), { sortOrder: 2 }),
    ]);
  });

  /** The gallery order ignoring the cover's leading position. */
  const arranged = async () => (await sortOrdersWithReferences()).map((row) => row.reference);

  async function sortOrdersWithReferences(): Promise<{ reference: string; sort_order: number }[]> {
    const { rows } = await dbPool.query<{ reference: string; sort_order: number }>(
      `SELECT ma.reference, rti.sort_order
         FROM room_type_images rti
         JOIN media_assets ma ON ma.id = rti.media_asset_id
        WHERE rti.room_type_id = $1
        ORDER BY rti.sort_order ASC, rti.id ASC`,
      [roomTypeId()],
    );

    return rows;
  }

  it('swaps with the nearest neighbour on the way up', async () => {
    assert.deepEqual(await move(images[2]!.reference, 'up'), { outcome: 'moved' });
    assert.deepEqual(await arranged(), [images[0]!.reference, images[2]!.reference, images[1]!.reference]);
  });

  it('swaps with the nearest neighbour on the way down', async () => {
    assert.deepEqual(await move(images[0]!.reference, 'down'), { outcome: 'moved' });
    assert.deepEqual(await arranged(), [images[1]!.reference, images[0]!.reference, images[2]!.reference]);
  });

  it('reports a boundary rather than moving the first image up', async () => {
    assert.deepEqual(await move(images[0]!.reference, 'up'), { outcome: 'boundary' });
    assert.deepEqual(await arranged(), images.map((image) => image.reference));
  });

  it('reports a boundary rather than moving the last image down', async () => {
    assert.deepEqual(await move(images[2]!.reference, 'down'), { outcome: 'boundary' });
    assert.deepEqual(await arranged(), images.map((image) => image.reference));
  });

  it('reports not-found for a reference outside this room type', async () => {
    const [foreign] = await references(roomTypeIds[slugs.other]!);

    assert.deepEqual(await move(foreign!, 'up'), { outcome: 'not-found' });
    assert.deepEqual(await move(randomUUID(), 'down'), { outcome: 'not-found' });
  });

  it('handles duplicate sort orders deterministically', async () => {
    await clearImages(roomTypeId());

    // Every image at 0: an increment-based move would change nothing at all.
    const tied = await inTransaction(async (client) => [
      await addImage(client, roomTypeId(), { sortOrder: 0 }),
      await addImage(client, roomTypeId(), { sortOrder: 0 }),
      await addImage(client, roomTypeId(), { sortOrder: 0 }),
    ]);

    assert.deepEqual(await sortOrders(roomTypeId()), [0, 0, 0]);
    assert.deepEqual(await move(tied[2]!.reference, 'up'), { outcome: 'moved' });
    assert.deepEqual(await arranged(), [tied[0]!.reference, tied[2]!.reference, tied[1]!.reference]);
  });

  it('leaves the order compact at 0..N-1', async () => {
    await clearImages(roomTypeId());

    const sparse = await inTransaction(async (client) => [
      await addImage(client, roomTypeId(), { sortOrder: 4 }),
      await addImage(client, roomTypeId(), { sortOrder: 9 }),
      await addImage(client, roomTypeId(), { sortOrder: 40 }),
    ]);

    assert.deepEqual(await move(sparse[0]!.reference, 'down'), { outcome: 'moved' });
    assert.deepEqual(await sortOrders(roomTypeId()), [0, 1, 2]);
    assert.deepEqual(await arranged(), [sparse[1]!.reference, sparse[0]!.reference, sparse[2]!.reference]);
  });

  it('does not change which image is the cover', async () => {
    assert.equal(await coverCount(roomTypeId()), 1);

    await move(images[2]!.reference, 'up');
    await move(images[0]!.reference, 'down');

    assert.equal(await coverCount(roomTypeId()), 1);

    const listed = await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId()));
    assert.equal(listed[0]!.reference, images[0]!.reference, 'the cover is still the cover');
  });

  it('leaves another room type’s ordering untouched', async () => {
    const otherBefore = await references(roomTypeIds[slugs.other]!);
    const galleryBefore = await references(roomTypeIds[slugs.gallery]!);

    await move(images[2]!.reference, 'up');

    assert.deepEqual(await references(roomTypeIds[slugs.other]!), otherBefore);
    assert.deepEqual(await references(roomTypeIds[slugs.gallery]!), galleryBefore);
  });
});

describe('deleting', () => {
  const roomTypeId = () => roomTypeIds[slugs.work]!;
  let images: ScopedRoomTypeImage[];

  beforeEach(async () => {
    await clearImages(roomTypeId());

    images = await inTransaction(async (client) => [
      await addImage(client, roomTypeId(), { sortOrder: 0, isCover: true }),
      await addImage(client, roomTypeId(), { sortOrder: 1 }),
      await addImage(client, roomTypeId(), { sortOrder: 2 }),
    ]);
  });

  it('removes a non-cover relation and then its asset', async () => {
    const target = images[1]!;

    await inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.work);

      const scoped = await repository.lockScopedRoomTypeImage(client, roomTypeId(), target.reference);
      assert.ok(scoped);

      assert.equal(await repository.deleteRoomTypeImageRelation(client, roomTypeId(), scoped.imageId), true);
      assert.equal(await mediaRepository.deleteMediaAssetById(client, scoped.mediaAssetId), true);
    });

    assert.deepEqual(await references(roomTypeId()), [images[0]!.reference, images[2]!.reference]);
    assert.equal(await coverCount(roomTypeId()), 1);
  });

  it('refuses to delete an asset a relation still points at', async () => {
    await assert.rejects(
      () =>
        inTransaction(async (client) => {
          await repository.lockRoomTypeForMediaChange(client, slugs.work);
          await mediaRepository.deleteMediaAssetById(client, images[1]!.mediaAssetId);
        }),
      (error: { code?: string; constraint?: string }) => {
        assert.equal(error.constraint, 'room_type_images_media_asset_id_fkey');
        // PostgreSQL 16 reports 23503 (foreign_key_violation) for a delete a
        // RESTRICT foreign key refuses; PostgreSQL 18 reports the more
        // specific 23001 (restrict_violation). Both mean that constraint
        // refused this delete, which is what this test is about; the
        // constraint name above is what keeps the assertion exact.
        assert.ok(
          error.code === '23001' || error.code === '23503',
          `expected 23001 or 23503 from RESTRICT, got ${error.code}`,
        );

        return true;
      },
      'RESTRICT must make this loud rather than silent',
    );
  });

  it('hands back the reference and key the caller needs after the commit', async () => {
    const target = images[2]!;

    const removed = await inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.work);

      const scoped = await repository.lockScopedRoomTypeImage(client, roomTypeId(), target.reference);
      assert.ok(scoped);

      await repository.deleteRoomTypeImageRelation(client, roomTypeId(), scoped.imageId);
      await mediaRepository.deleteMediaAssetById(client, scoped.mediaAssetId);

      return { reference: scoped.reference, storageKey: scoped.storageKey };
    });

    assert.equal(removed.reference, target.reference);
    assert.equal(removed.storageKey, target.storageKey);
    assert.match(removed.storageKey, /^media\/.+\.webp$/, 'enough to delete the object after the commit');
  });

  it('lets a deterministic replacement cover be promoted', async () => {
    const cover = images[0]!;

    await inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.work);

      const scoped = await repository.lockScopedRoomTypeImage(client, roomTypeId(), cover.reference);
      assert.ok(scoped);
      assert.equal(scoped.isCover, true);

      await repository.deleteRoomTypeImageRelation(client, roomTypeId(), scoped.imageId);
      await mediaRepository.deleteMediaAssetById(client, scoped.mediaAssetId);

      const replacement = await repository.findFirstRoomTypeImageId(client, roomTypeId());
      assert.ok(replacement);
      await repository.setRoomTypeImageAsCover(client, roomTypeId(), replacement);
      await repository.compactRoomTypeImageOrder(client, roomTypeId());
    });

    assert.equal(await coverCount(roomTypeId()), 1);
    assert.deepEqual(await sortOrders(roomTypeId()), [0, 1]);

    const listed = await inTransaction((client) => repository.listRoomTypeImages(client, roomTypeId()));
    assert.equal(listed[0]!.reference, images[1]!.reference, 'the next image by sort_order then id');
    assert.equal(listed[0]!.isCover, true);
  });

  it('leaves zero covers when the last image goes', async () => {
    await inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.work);

      for (const image of images) {
        const scoped = await repository.lockScopedRoomTypeImage(client, roomTypeId(), image.reference);
        assert.ok(scoped);
        await repository.deleteRoomTypeImageRelation(client, roomTypeId(), scoped.imageId);
        await mediaRepository.deleteMediaAssetById(client, scoped.mediaAssetId);
      }
    });

    assert.equal(await inTransaction((client) => repository.countRoomTypeImages(client, roomTypeId())), 0);
    assert.equal(await coverCount(roomTypeId()), 0, 'zero images means zero covers');
    assert.deepEqual(await references(roomTypeId()), []);
    assert.equal(await inTransaction((client) => repository.findFirstRoomTypeImageId(client, roomTypeId())), null);
  });

  it('cannot delete through the wrong room type', async () => {
    const deleted = await inTransaction((client) =>
      repository.deleteRoomTypeImageRelation(client, roomTypeIds[slugs.other]!, images[1]!.imageId),
    );

    assert.equal(deleted, false);
    assert.equal((await references(roomTypeId())).length, 3);
  });

  it('leaves another room type untouched', async () => {
    const otherBefore = await references(roomTypeIds[slugs.other]!);

    await inTransaction(async (client) => {
      await repository.lockRoomTypeForMediaChange(client, slugs.work);

      const scoped = await repository.lockScopedRoomTypeImage(client, roomTypeId(), images[1]!.reference);
      await repository.deleteRoomTypeImageRelation(client, roomTypeId(), scoped!.imageId);
      await mediaRepository.deleteMediaAssetById(client, scoped!.mediaAssetId);
    });

    assert.deepEqual(await references(roomTypeIds[slugs.other]!), otherBefore);
  });
});

describe('the caller owns the transaction', () => {
  const roomTypeId = () => roomTypeIds[slugs.work]!;

  beforeEach(async () => {
    await clearImages(roomTypeId());
  });

  it('rolls back every write made inside a transaction the caller abandons', async () => {
    const client = await dbPool.connect();

    try {
      await client.query('BEGIN');

      await repository.lockRoomTypeForMediaChange(client, slugs.work);
      const image = await addImage(client, roomTypeId(), { sortOrder: 0, isCover: true });
      await repository.updateRoomTypeImageAltText(client, roomTypeId(), image.imageId, 'gone after rollback');

      // Visible inside the transaction...
      assert.equal(await repository.countRoomTypeImages(client, roomTypeId()), 1);

      await client.query('ROLLBACK');

      // ...and nowhere afterwards. Nothing in the repository committed on its
      // own behalf, so the caller's rollback is the whole story.
      assert.deepEqual(await references(roomTypeId()), []);

      const { rows } = await dbPool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM media_assets WHERE reference = $1`,
        [image.reference],
      );

      assert.equal(rows[0]!.total, 0, 'the asset must not survive either');
    } finally {
      client.release();
    }
  });

  it('participates in a transaction it did not open', async () => {
    const client = await dbPool.connect();

    try {
      await client.query('BEGIN');
      await repository.lockRoomTypeForMediaChange(client, slugs.work);
      await addImage(client, roomTypeId(), { sortOrder: 0 });
      await client.query('COMMIT');

      assert.equal((await references(roomTypeId())).length, 1);
    } finally {
      client.release();
    }
  });
});

describe('the parent lock is what makes a ceiling enforceable', () => {
  const roomTypeId = () => roomTypeIds[slugs.locks]!;

  beforeEach(async () => {
    await clearImages(roomTypeId());
  });

  it('serializes two count-then-insert windows', async () => {
    // Both transactions want to read the count and decide from it. Without the
    // parent lock they would both read the same number and both insert; with
    // it, the second cannot read until the first has committed.
    const first = await dbPool.connect();
    const second = await dbPool.connect();

    try {
      await inTransaction(async (client) => {
        await addImage(client, roomTypeId(), { sortOrder: 0, isCover: true });
      });

      await first.query('BEGIN');
      await repository.lockRoomTypeForMediaChange(first, slugs.locks);
      const firstCount = await repository.countRoomTypeImages(first, roomTypeId());
      assert.equal(firstCount, 1);

      // The second transaction blocks on the parent, so it cannot reach its
      // own count while the first still holds the row.
      await second.query('BEGIN');
      await assert.rejects(
        () => second.query(`SELECT id FROM room_types WHERE slug = $1 FOR UPDATE NOWAIT`, [slugs.locks]),
        (error: { code?: string }) => error.code === '55P03',
        'the second decision window opened while the first was still deciding',
      );
      await second.query('ROLLBACK');

      // The first commits its insert...
      await addImage(first, roomTypeId(), { sortOrder: 1 });
      await first.query('COMMIT');

      // ...and only now does the second get the lock, and reads the count the
      // first produced rather than the one it started from.
      await second.query('BEGIN');
      await repository.lockRoomTypeForMediaChange(second, slugs.locks);
      const secondCount = await repository.countRoomTypeImages(second, roomTypeId());
      await second.query('ROLLBACK');

      assert.equal(secondCount, 2, 'the second window sees the first window’s insert');
      assert.equal(
        secondCount,
        firstCount + 1,
        'two windows that both read 1 would each have been allowed to insert a second image',
      );
    } finally {
      first.release();
      second.release();
    }
  });
});
