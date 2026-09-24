import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

// The public room media read path against real PostgreSQL.
//
// What is proved here is only what a database can prove: that the ordering
// clause produces cover-first, then sort_order, then id; that a room type
// with no rows comes back with an empty gallery; and that a list covering
// several room types attaches each image to the right one. Query counts,
// response field selection and the media-configuration rules are unit-tested
// in rooms.media.test.ts, where they can be observed directly.
//
// Nothing is mocked, nothing contacts object storage, and no R2 variable is
// read: the repository returns references, never URLs. Every row this suite
// writes carries an identifier unique to the run, and exactly those rows are
// removed afterwards.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');
type RepositoryModule = typeof import('../src/modules/rooms/rooms.repository.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let findActiveRoomTypes: RepositoryModule['findActiveRoomTypes'];
let findActiveRoomTypeBySlug: RepositoryModule['findActiveRoomTypeBySlug'];

const runId = randomUUID().slice(0, 8);
const slugPrefix = `itest-roommedia-${runId}`;
const keyPrefix = `media/${runId}-roommedia`;

const GALLERY_SLUG = `${slugPrefix}-gallery`;
const SINGLE_SLUG = `${slugPrefix}-single`;
const EMPTY_SLUG = `${slugPrefix}-empty`;

const roomTypeIds: Record<string, string> = {};

let keySeq = 0;

/** One media asset, unique to this run, returning its id and reference. */
async function insertAsset(): Promise<{ id: string; reference: string }> {
  const reference = randomUUID();
  const key = `${keyPrefix}-${(keySeq += 1)}.webp`;
  const checksum = createHash('sha256').update(key).digest('hex');

  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO media_assets (reference, storage_key, content_type, byte_size, checksum_sha256, width, height)
     VALUES ($1, $2, 'image/webp', 2048, $3, 1600, 900)
     RETURNING id`,
    [reference, key, checksum],
  );

  const row = rows[0];
  assert.ok(row, 'failed to insert fixture media asset');

  return { id: row.id, reference };
}

async function insertRoomType(slug: string): Promise<string> {
  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, 2, '1500.00', true, 0)
     RETURNING id`,
    [slug, `Fixture ${slug}`],
  );

  const row = rows[0];
  assert.ok(row, `failed to insert fixture room type ${slug}`);
  roomTypeIds[slug] = row.id;

  return row.id;
}

async function linkImage(
  roomTypeId: string,
  options: { sortOrder: number; isCover?: boolean; altText?: string | null },
): Promise<string> {
  const asset = await insertAsset();

  await dbPool.query(
    `INSERT INTO room_type_images (room_type_id, media_asset_id, alt_text, sort_order, is_cover)
     VALUES ($1, $2, $3, $4, $5)`,
    [roomTypeId, asset.id, options.altText ?? null, options.sortOrder, options.isCover ?? false],
  );

  return asset.reference;
}

/** Filled in setup, then asserted against — the order each gallery must read in. */
let galleryExpectedOrder: string[] = [];
let singleReference = '';

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  ({ findActiveRoomTypes, findActiveRoomTypeBySlug } = await import(
    '../src/modules/rooms/rooms.repository.js'
  ));

  const galleryId = await insertRoomType(GALLERY_SLUG);
  await insertRoomType(SINGLE_SLUG);
  await insertRoomType(EMPTY_SLUG);

  // Inserted in an order that is NOT the order they must read in, so passing
  // cannot be an accident of insertion sequence.
  //
  //   middle : sort_order 1, inserted first  -> lower id
  //   tie    : sort_order 1, inserted second -> higher id, so it follows
  //   cover  : sort_order 9, the highest     -> leads anyway, being the cover
  //   first  : sort_order 0                  -> leads the non-cover images
  const middle = await linkImage(galleryId, { sortOrder: 1, altText: 'Middle' });
  const tie = await linkImage(galleryId, { sortOrder: 1, altText: null });
  const cover = await linkImage(galleryId, { sortOrder: 9, isCover: true, altText: 'Cover' });
  const first = await linkImage(galleryId, { sortOrder: 0, altText: 'First' });

  galleryExpectedOrder = [cover, first, middle, tie];

  singleReference = await linkImage(roomTypeIds[SINGLE_SLUG], { sortOrder: 0, isCover: true });
});

after(async () => {
  // Images first: they hold the foreign keys, and both sides are RESTRICT.
  await dbPool.query(
    `DELETE FROM room_type_images
      WHERE room_type_id IN (SELECT id FROM room_types WHERE slug LIKE $1)`,
    [`${slugPrefix}%`],
  );
  await dbPool.query('DELETE FROM media_assets WHERE storage_key LIKE $1', [`${keyPrefix}%`]);
  await dbPool.query('DELETE FROM room_types WHERE slug LIKE $1', [`${slugPrefix}%`]);

  await closeDatabasePool();
});

describe('public room media against PostgreSQL', () => {
  it('orders a gallery cover first, then by sort order, then by id', async () => {
    const room = await findActiveRoomTypeBySlug(GALLERY_SLUG);

    assert.ok(room, 'the fixture room type should be active and findable');
    assert.deepEqual(
      room.images.map((image) => image.reference),
      galleryExpectedOrder,
      'is_cover DESC, sort_order ASC, id ASC',
    );

    // The cover leads despite holding the HIGHEST sort order, which is the
    // whole point: the cover is a role, not a position.
    assert.equal(room.images[0].isCover, true);
    assert.deepEqual(
      room.images.slice(1).map((image) => image.isCover),
      [false, false, false],
    );
  });

  it('returns an empty gallery for a room type with no images', async () => {
    const room = await findActiveRoomTypeBySlug(EMPTY_SLUG);

    assert.ok(room);
    assert.deepEqual(room.images, [], 'no rows means [], never null and never a missing key');
  });

  it('attaches each image to its own room type across a multi-room list', async () => {
    const rooms = await findActiveRoomTypes();
    const bySlug = new Map(rooms.map((room) => [room.slug, room]));

    const gallery = bySlug.get(GALLERY_SLUG);
    const single = bySlug.get(SINGLE_SLUG);
    const empty = bySlug.get(EMPTY_SLUG);

    assert.ok(gallery && single && empty, 'all three fixtures should be listed');

    assert.deepEqual(
      gallery.images.map((image) => image.reference),
      galleryExpectedOrder,
      'the list endpoint reads a gallery in the same order the detail endpoint does',
    );
    assert.deepEqual(
      single.images.map((image) => image.reference),
      [singleReference],
    );
    assert.deepEqual(empty.images, []);
  });

  it('carries the stored dimensions and nullable alt text through unchanged', async () => {
    const room = await findActiveRoomTypeBySlug(GALLERY_SLUG);
    assert.ok(room);

    const [cover] = room.images;
    assert.equal(cover.altText, 'Cover');
    assert.equal(cover.width, 1600);
    assert.equal(cover.height, 900);

    // A decorative image stores NULL rather than an empty string.
    const decorative = room.images.find((image) => image.altText === null);
    assert.ok(decorative, 'the null-alt-text fixture should survive the read');
  });

  it('reports references, never URLs, so no media configuration is read here', async () => {
    const room = await findActiveRoomTypeBySlug(SINGLE_SLUG);
    assert.ok(room);

    const [image] = room.images;
    assert.deepEqual(Object.keys(image).sort(), ['altText', 'height', 'isCover', 'reference', 'width']);
    assert.match(image.reference, /^[0-9a-f-]{36}$/);
  });

  it('excludes an inactive room type and its images from the list', async () => {
    await dbPool.query('UPDATE room_types SET is_active = false WHERE slug = $1', [SINGLE_SLUG]);

    try {
      const rooms = await findActiveRoomTypes();
      assert.equal(
        rooms.some((room) => room.slug === SINGLE_SLUG),
        false,
      );
      assert.equal(await findActiveRoomTypeBySlug(SINGLE_SLUG), null);
    } finally {
      await dbPool.query('UPDATE room_types SET is_active = true WHERE slug = $1', [SINGLE_SLUG]);
    }
  });
});
