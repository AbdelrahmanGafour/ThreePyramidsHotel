import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

// Proves the media schema against real PostgreSQL: the tables, the named
// constraints and the two indexes the T03-B migration creates, and the
// behaviour each of them actually produces.
//
// There is no repository, service or route yet, so every statement here is
// written directly. That is the point: these are the guarantees the database
// gives on its own, and the layers above are entitled to rely on them without
// re-proving them.
//
// Nothing is mocked, nothing contacts object storage, and no R2 variable is
// read. The suite creates room types, media assets and links carrying
// identifiers unique to this run, and removes exactly those afterwards.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];

const MIGRATION_NAME = '1790106929800_create-media-assets-and-room-type-images';

const runId = randomUUID().slice(0, 8);
const slugPrefix = `itest-media-${runId}`;

/** Every asset this suite writes shares this prefix, so cleanup is exact. */
const keyPrefix = `media/${runId}`;

let keySeq = 0;
const nextKey = () => `${keyPrefix}-${(keySeq += 1)}.webp`;

/** A real lowercase-hex SHA-256 digest, as node's crypto produces one. */
const checksum = (seed: string) => createHash('sha256').update(seed).digest('hex');

/** The columns the three pre-existing tables had before this migration. */
const EXISTING_COLUMNS: Record<string, string[]> = {
  room_types: [
    'id', 'slug', 'name', 'short_description', 'description', 'capacity', 'bed_type',
    'bed_count', 'size_sqm', 'view', 'base_nightly_rate', 'is_active', 'sort_order',
    'created_at', 'updated_at',
  ],
  rooms: ['id', 'room_type_id', 'room_number', 'is_active', 'created_at', 'updated_at'],
  reservations: [
    'id', 'booking_reference', 'room_type_id', 'room_id', 'guest_first_name', 'guest_last_name',
    'guest_email', 'guest_phone', 'guest_country', 'adults', 'children', 'check_in', 'check_out',
    'status', 'currency', 'nightly_rate_snapshot', 'total_amount', 'special_requests',
    'created_at', 'updated_at',
  ],
};

const roomTypeIds: Record<string, string> = {};

/** Row counts of the tables this suite must not disturb, taken before it runs. */
let untouchedCountsBefore: { rooms: number; reservations: number };

/**
 * A well-formed `media_assets` row: a normalized WebP, which is the only thing
 * the pipeline ever stores. Overrides replace one field so a single rule can
 * be broken at a time.
 */
function assetValues(overrides: Record<string, unknown> = {}): unknown[] {
  const values = {
    reference: randomUUID(),
    storage_key: nextKey(),
    content_type: 'image/webp',
    byte_size: 184_320,
    checksum_sha256: checksum(`${runId}-${keySeq}`),
    width: 2560,
    height: 1707,
    ...overrides,
  };

  return [
    values.reference,
    values.storage_key,
    values.content_type,
    values.byte_size,
    values.checksum_sha256,
    values.width,
    values.height,
  ];
}

const INSERT_ASSET = `INSERT INTO media_assets
     (reference, storage_key, content_type, byte_size, checksum_sha256, width, height)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   RETURNING id`;

async function insertAsset(overrides: Record<string, unknown> = {}): Promise<string> {
  const { rows } = await dbPool.query<{ id: string }>(INSERT_ASSET, assetValues(overrides));

  const row = rows[0];
  assert.ok(row, 'failed to insert fixture media asset');

  return row.id;
}

const INSERT_IMAGE = `INSERT INTO room_type_images
     (room_type_id, media_asset_id, alt_text, sort_order, is_cover)
   VALUES ($1, $2, $3, $4, $5)
   RETURNING id`;

type LinkInput = {
  roomTypeId: string;
  mediaAssetId: string;
  altText?: string | null;
  sortOrder?: number;
  isCover?: boolean;
};

function linkValues(input: LinkInput): unknown[] {
  return [
    input.roomTypeId,
    input.mediaAssetId,
    input.altText ?? null,
    input.sortOrder ?? 0,
    input.isCover ?? false,
  ];
}

async function linkImage(input: LinkInput): Promise<string> {
  const { rows } = await dbPool.query<{ id: string }>(INSERT_IMAGE, linkValues(input));

  const row = rows[0];
  assert.ok(row, 'failed to insert fixture room-type image');

  return row.id;
}

type Violation = { code: string; constraint: string };

/**
 * Runs a statement that must be refused, and reports which rule refused it.
 *
 * A test that only asserted "this threw" would pass for the wrong reason the
 * first time an unrelated constraint, a typo or a missing column produced an
 * error instead. Naming the constraint is what makes the assertion mean
 * something.
 */
async function violation(run: () => Promise<unknown>): Promise<Violation> {
  try {
    await run();
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };

    return { code: pgError.code ?? '(none)', constraint: pgError.constraint ?? '(none)' };
  }

  assert.fail('expected PostgreSQL to reject the statement');
}

/**
 * The two SQLSTATEs a RESTRICT-mediated delete refusal can carry.
 *
 * PostgreSQL 16 reports 23503 (foreign_key_violation) when a RESTRICT
 * foreign key refuses a delete; PostgreSQL 18 reports the more specific
 * 23001 (restrict_violation). Both say the same thing — that constraint
 * refused that delete — so pinning one of them would assert which server
 * major is running rather than anything about this schema.
 *
 * Deliberately not used for the insert-side foreign-key tests: inserting a
 * child row whose parent does not exist is an ordinary foreign_key_violation
 * on every version, is not RESTRICT-mediated, and stays pinned to 23503.
 */
const RESTRICT_REFUSAL_CODES = ['23001', '23503'];

/**
 * Asserts a delete was refused by one exact constraint, without pinning the
 * server's choice of integrity SQLSTATE.
 *
 * The constraint name stays exact, so this still fails if the wrong rule —
 * or no rule — refused the statement. That RESTRICT rather than CASCADE is
 * declared at all is pinned separately and structurally, by the
 * `confdeltype = 'r'` catalog assertion below, which no SQLSTATE affects.
 */
function assertRestrictRefusal(actual: Violation, constraint: string): void {
  assert.equal(actual.constraint, constraint);
  assert.ok(
    RESTRICT_REFUSAL_CODES.includes(actual.code),
    `expected ${RESTRICT_REFUSAL_CODES.join(' or ')} from ${constraint}, got ${actual.code}`,
  );
}

/** The columns one index covers, in index order, plus what kind of index it is. */
async function indexShape(name: string): Promise<{
  columns: string[];
  unique: boolean;
  partial: boolean;
}> {
  const { rows } = await dbPool.query<{ columns: string[]; unique: boolean; partial: boolean }>(
    `SELECT (SELECT array_agg(a.attname::text ORDER BY k.ord)
               FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS columns,
            i.indisunique AS unique,
            i.indpred IS NOT NULL AS partial
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = $1`,
    [name],
  );

  const row = rows[0];
  assert.ok(row, `index ${name} does not exist`);

  return row;
}

async function tableNames(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );

  return rows.map((row) => row.tablename);
}

async function indexNames(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
  );

  return rows.map((row) => row.indexname);
}

async function insertRoomType(slug: string): Promise<string> {
  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, 2, '1500.00', false, 0)
     RETURNING id`,
    [slug, `Fixture ${slug}`],
  );

  const row = rows[0];
  assert.ok(row, `failed to insert fixture room type ${slug}`);
  roomTypeIds[slug] = row.id;

  return row.id;
}

const slugs = {
  a: `${slugPrefix}-a`,
  b: `${slugPrefix}-b`,
  covers: `${slugPrefix}-covers`,
  order: `${slugPrefix}-order`,
  restrict: `${slugPrefix}-restrict`,
} as const;

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));

  const { rows } = await dbPool.query<{ rooms: number; reservations: number }>(
    `SELECT (SELECT COUNT(*) FROM rooms)::int AS rooms,
            (SELECT COUNT(*) FROM reservations)::int AS reservations`,
  );

  const counts = rows[0];
  assert.ok(counts, 'failed to read the baseline row counts');
  untouchedCountsBefore = counts;

  for (const slug of Object.values(slugs)) {
    await insertRoomType(slug);
  }
});

after(async () => {
  try {
    const like = `${slugPrefix}-%`;

    // Dependency-safe order, scoped to this run's own identifiers. The links
    // go first because they hold both foreign keys, then the assets they
    // referenced, then the room types.
    await dbPool.query(
      'DELETE FROM room_type_images WHERE room_type_id IN (SELECT id FROM room_types WHERE slug LIKE $1)',
      [like],
    );
    await dbPool.query('DELETE FROM media_assets WHERE storage_key LIKE $1', [`${keyPrefix}-%`]);
    await dbPool.query('DELETE FROM room_types WHERE slug LIKE $1', [like]);

    const { rows } = await dbPool.query<{ types: number; assets: number; rooms: number; reservations: number }>(
      `SELECT (SELECT COUNT(*) FROM room_types WHERE slug LIKE $1)::int AS types,
              (SELECT COUNT(*) FROM media_assets WHERE storage_key LIKE $2)::int AS assets,
              (SELECT COUNT(*) FROM rooms)::int AS rooms,
              (SELECT COUNT(*) FROM reservations)::int AS reservations`,
      [like, `${keyPrefix}-%`],
    );

    assert.deepEqual(
      rows[0],
      { types: 0, assets: 0, ...untouchedCountsBefore },
      'fixtures were not fully removed, or rows this suite must not touch changed',
    );
  } finally {
    await closeDatabasePool();
  }
});

describe('the migration', () => {
  it('is recorded as applied', async () => {
    const { rows } = await dbPool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM pgmigrations WHERE name = $1',
      [MIGRATION_NAME],
    );

    assert.equal(rows[0]?.count, 1);
  });

  it('created both tables with exactly the agreed columns', async () => {
    const { rows } = await dbPool.query<{ table_name: string; columns: string[] }>(
      `SELECT table_name, array_agg(column_name::text ORDER BY ordinal_position) AS columns
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('media_assets', 'room_type_images')
        GROUP BY table_name`,
    );

    const columns = Object.fromEntries(rows.map((row) => [row.table_name, row.columns]));

    assert.deepEqual(columns.media_assets, [
      'id',
      'reference',
      'storage_key',
      'content_type',
      'byte_size',
      'checksum_sha256',
      'width',
      'height',
      'created_at',
    ]);

    // No updated_at on media_assets above, and one here: an asset is
    // immutable, a placement is not.
    assert.deepEqual(columns.room_type_images, [
      'id',
      'room_type_id',
      'media_asset_id',
      'alt_text',
      'sort_order',
      'is_cover',
      'created_at',
      'updated_at',
    ]);
  });

  it('left room_types, rooms and reservations exactly as they were', async () => {
    const { rows } = await dbPool.query<{ table_name: string; columns: string[] }>(
      `SELECT table_name, array_agg(column_name::text ORDER BY ordinal_position) AS columns
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)
        GROUP BY table_name`,
      [Object.keys(EXISTING_COLUMNS)],
    );

    for (const row of rows) {
      assert.deepEqual(row.columns, EXISTING_COLUMNS[row.table_name], `${row.table_name} columns changed`);
    }

    assert.equal(rows.length, 3, 'one of the pre-existing tables is missing');

    // The reservations exclusion constraint is the one this project would
    // least like to lose silently, so it is named rather than counted.
    const { rows: constraints } = await dbPool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM pg_constraint
        WHERE conname IN ('reservations_no_overlapping_active_stays', 'rooms_room_type_id_fkey', 'room_types_slug_key')`,
    );

    assert.equal(constraints[0]?.count, 3, 'a pre-existing constraint is missing');
  });

  it('added no trigger to either new table', async () => {
    const { rows } = await dbPool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid IN ('media_assets'::regclass, 'room_type_images'::regclass)`,
    );

    assert.equal(rows[0]?.count, 0, 'the cover invariant is the service layer’s, not a trigger’s');
  });
});

describe('media_assets', () => {
  it('accepts a normalized WebP metadata row', async () => {
    const id = await insertAsset();

    const { rows } = await dbPool.query<{
      content_type: string;
      byte_size: string;
      width: number;
      height: number;
      created_at: Date;
    }>('SELECT content_type, byte_size, width, height, created_at FROM media_assets WHERE id = $1', [id]);

    const row = rows[0];
    assert.ok(row);
    assert.equal(row.content_type, 'image/webp');
    // bigint arrives as a string from pg, and is never silently a float.
    assert.equal(row.byte_size, '184320');
    assert.equal(row.width, 2560);
    assert.equal(row.height, 1707);
    assert.ok(row.created_at instanceof Date, 'created_at defaults to now()');
  });

  it('rejects any content type but WebP', async () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/svg+xml', 'image/gif', 'IMAGE/WEBP', '']) {
      assert.deepEqual(
        await violation(() => dbPool.query(INSERT_ASSET, assetValues({ content_type: contentType }))),
        { code: '23514', constraint: 'media_assets_content_type_check' },
        `${contentType || '(empty)'} was accepted`,
      );
    }
  });

  it('rejects a byte size that is not positive', async () => {
    for (const byteSize of [0, -1]) {
      assert.deepEqual(
        await violation(() => dbPool.query(INSERT_ASSET, assetValues({ byte_size: byteSize }))),
        { code: '23514', constraint: 'media_assets_byte_size_check' },
      );
    }
  });

  it('accepts only a 64-character checksum', async () => {
    const digest = checksum('length');

    // Both values are valid hexadecimal, so the alphabet rule cannot be what
    // refuses them — only the length rule can be, and it is named to prove it.
    for (const value of [digest.slice(0, 63), `${digest}a`]) {
      assert.deepEqual(
        await violation(() => dbPool.query(INSERT_ASSET, assetValues({ checksum_sha256: value }))),
        { code: '23514', constraint: 'media_assets_checksum_sha256_length_check' },
      );
    }
  });

  it('rejects an empty checksum', async () => {
    // An empty string breaks both rules at once, and PostgreSQL is free to
    // report either. The assertion is therefore about the rejection, not about
    // which of the two constraints got there first.
    const { code } = await violation(() =>
      dbPool.query(INSERT_ASSET, assetValues({ checksum_sha256: '' })),
    );

    assert.equal(code, '23514');
  });

  it('accepts only lowercase hexadecimal in a checksum', async () => {
    const digest = checksum('format');

    // Each is exactly 64 characters, so the length rule cannot be what refuses
    // them — the alphabet rule has to be, and it is named to prove it.
    for (const value of [digest.toUpperCase(), `g${digest.slice(1)}`, `${digest.slice(0, 63)} `]) {
      assert.equal(value.length, 64);
      assert.deepEqual(
        await violation(() => dbPool.query(INSERT_ASSET, assetValues({ checksum_sha256: value }))),
        { code: '23514', constraint: 'media_assets_checksum_sha256_format_check' },
      );
    }
  });

  it('rejects a width or height that is not positive', async () => {
    for (const width of [0, -1]) {
      assert.deepEqual(
        await violation(() => dbPool.query(INSERT_ASSET, assetValues({ width }))),
        { code: '23514', constraint: 'media_assets_width_check' },
      );
    }

    for (const height of [0, -1]) {
      assert.deepEqual(
        await violation(() => dbPool.query(INSERT_ASSET, assetValues({ height }))),
        { code: '23514', constraint: 'media_assets_height_check' },
      );
    }
  });

  it('imposes no maximum width or height of its own', async () => {
    // The pixel ceiling is the processing layer's, applied before an image is
    // decoded. The database must not hold a second, quietly different one.
    const id = await insertAsset({ width: 20_000, height: 20_000 });

    assert.ok(id);
  });

  it('refuses a duplicate reference', async () => {
    const reference = randomUUID();
    await insertAsset({ reference });

    assert.deepEqual(
      await violation(() => dbPool.query(INSERT_ASSET, assetValues({ reference }))),
      { code: '23505', constraint: 'media_assets_reference_key' },
    );
  });

  it('refuses a duplicate storage key', async () => {
    const storageKey = nextKey();
    await insertAsset({ storage_key: storageKey });

    assert.deepEqual(
      await violation(() => dbPool.query(INSERT_ASSET, assetValues({ storage_key: storageKey }))),
      { code: '23505', constraint: 'media_assets_storage_key_key' },
    );
  });

  it('has no default for reference, so the application must supply one', async () => {
    const { rows } = await dbPool.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'reference'`,
    );

    assert.equal(rows[0]?.column_default, null, 'reference is generated by crypto.randomUUID(), not by PostgreSQL');
  });

  it('needed no uuid extension', async () => {
    const { rows } = await dbPool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto')`,
    );

    assert.equal(rows[0]?.count, 0);
  });
});

describe('room_type_images ownership', () => {
  it('links a room type to an asset', async () => {
    const mediaAssetId = await insertAsset();
    const id = await linkImage({ roomTypeId: roomTypeIds[slugs.a]!, mediaAssetId });

    const { rows } = await dbPool.query<{
      room_type_id: string;
      media_asset_id: string;
      sort_order: number;
      is_cover: boolean;
      alt_text: string | null;
    }>(
      `SELECT room_type_id, media_asset_id, sort_order, is_cover, alt_text
         FROM room_type_images WHERE id = $1`,
      [id],
    );

    assert.deepEqual(rows[0], {
      room_type_id: roomTypeIds[slugs.a],
      media_asset_id: mediaAssetId,
      sort_order: 0,
      is_cover: false,
      alt_text: null,
    });
  });

  it('refuses a link to a room type that does not exist', async () => {
    const mediaAssetId = await insertAsset();

    assert.deepEqual(
      await violation(() =>
        dbPool.query(INSERT_IMAGE, linkValues({ roomTypeId: '9223372036854775807', mediaAssetId })),
      ),
      { code: '23503', constraint: 'room_type_images_room_type_id_fkey' },
    );
  });

  it('refuses a link to an asset that does not exist', async () => {
    assert.deepEqual(
      await violation(() =>
        dbPool.query(
          INSERT_IMAGE,
          linkValues({ roomTypeId: roomTypeIds[slugs.a]!, mediaAssetId: '9223372036854775807' }),
        ),
      ),
      { code: '23503', constraint: 'room_type_images_media_asset_id_fkey' },
    );
  });

  it('restricts deleting a room type that still has images', async () => {
    const mediaAssetId = await insertAsset();
    await linkImage({ roomTypeId: roomTypeIds[slugs.restrict]!, mediaAssetId });

    assertRestrictRefusal(
      await violation(() => dbPool.query('DELETE FROM room_types WHERE id = $1', [roomTypeIds[slugs.restrict]])),
      'room_type_images_room_type_id_fkey',
    );
  });

  it('restricts deleting an asset that is still linked', async () => {
    const mediaAssetId = await insertAsset();
    await linkImage({ roomTypeId: roomTypeIds[slugs.restrict]!, mediaAssetId });

    assertRestrictRefusal(
      await violation(() => dbPool.query('DELETE FROM media_assets WHERE id = $1', [mediaAssetId])),
      'room_type_images_media_asset_id_fkey',
    );
  });

  it('declares RESTRICT rather than CASCADE on both foreign keys', async () => {
    const { rows } = await dbPool.query<{ conname: string; confdeltype: string }>(
      `SELECT conname, confdeltype FROM pg_constraint
        WHERE conrelid = 'room_type_images'::regclass AND contype = 'f'
        ORDER BY conname`,
    );

    // 'r' is RESTRICT; 'c' would be CASCADE, and would discard an
    // administrator's media as a side effect of a delete V1 does not offer.
    assert.deepEqual(rows, [
      { conname: 'room_type_images_media_asset_id_fkey', confdeltype: 'r' },
      { conname: 'room_type_images_room_type_id_fkey', confdeltype: 'r' },
    ]);
  });

  it('places one asset at most once', async () => {
    const mediaAssetId = await insertAsset();
    await linkImage({ roomTypeId: roomTypeIds[slugs.a]!, mediaAssetId });

    assert.deepEqual(
      await violation(() => dbPool.query(INSERT_IMAGE, linkValues({ roomTypeId: roomTypeIds[slugs.a]!, mediaAssetId }))),
      { code: '23505', constraint: 'room_type_images_media_asset_id_key' },
      'the same asset twice on one room type',
    );

    assert.deepEqual(
      await violation(() => dbPool.query(INSERT_IMAGE, linkValues({ roomTypeId: roomTypeIds[slugs.b]!, mediaAssetId }))),
      { code: '23505', constraint: 'room_type_images_media_asset_id_key' },
      'sharing one asset between two room types is not a V1 design',
    );
  });
});

describe('alt text', () => {
  it('accepts NULL', async () => {
    const id = await linkImage({
      roomTypeId: roomTypeIds[slugs.a]!,
      mediaAssetId: await insertAsset(),
      altText: null,
    });

    assert.ok(id, 'a decorative image is a real case, not a missing value');
  });

  it('accepts 240 characters', async () => {
    const id = await linkImage({
      roomTypeId: roomTypeIds[slugs.a]!,
      mediaAssetId: await insertAsset(),
      altText: 'a'.repeat(240),
    });

    assert.ok(id);
  });

  it('rejects 241 characters', async () => {
    const mediaAssetId = await insertAsset();

    assert.deepEqual(
      await violation(() =>
        dbPool.query(
          INSERT_IMAGE,
          linkValues({ roomTypeId: roomTypeIds[slugs.a]!, mediaAssetId, altText: 'a'.repeat(241) }),
        ),
      ),
      { code: '23514', constraint: 'room_type_images_alt_text_check' },
    );
  });

  it('accepts an empty string, which the application resolves to NULL before it arrives', async () => {
    // Stated as a fact about the database, not as an endorsement: the check
    // deliberately does not require non-empty text, because "" and NULL both
    // mean decorative and the application settles that once.
    const id = await linkImage({
      roomTypeId: roomTypeIds[slugs.a]!,
      mediaAssetId: await insertAsset(),
      altText: '',
    });

    assert.ok(id);
  });
});

describe('ordering', () => {
  it('rejects a negative sort order', async () => {
    const mediaAssetId = await insertAsset();

    assert.deepEqual(
      await violation(() =>
        dbPool.query(INSERT_IMAGE, linkValues({ roomTypeId: roomTypeIds[slugs.order]!, mediaAssetId, sortOrder: -1 })),
      ),
      { code: '23514', constraint: 'room_type_images_sort_order_check' },
    );
  });

  it('accepts zero and allows duplicate sort orders within one room type', async () => {
    const first = await linkImage({
      roomTypeId: roomTypeIds[slugs.order]!,
      mediaAssetId: await insertAsset(),
      sortOrder: 0,
    });
    const second = await linkImage({
      roomTypeId: roomTypeIds[slugs.order]!,
      mediaAssetId: await insertAsset(),
      sortOrder: 0,
    });

    // Ties are legal so a reorder never has to rewrite every row to stay valid
    // part-way through. The repository breaks them by id.
    const { rows } = await dbPool.query<{ id: string }>(
      `SELECT id FROM room_type_images
        WHERE room_type_id = $1
        ORDER BY sort_order, id`,
      [roomTypeIds[slugs.order]],
    );

    assert.deepEqual(
      rows.map((row) => row.id),
      [first, second].sort((a, b) => Number(a) - Number(b)),
    );
  });

  it('indexes (room_type_id, sort_order, id) non-uniquely', async () => {
    assert.deepEqual(await indexShape('room_type_images_room_type_id_sort_order_id_idx'), {
      columns: ['room_type_id', 'sort_order', 'id'],
      unique: false,
      partial: false,
    });
  });

  it('has no unique constraint on (room_type_id, sort_order)', async () => {
    const { rows } = await dbPool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'room_type_images' AND indexdef LIKE '%UNIQUE%'
        ORDER BY indexname`,
    );

    assert.deepEqual(
      rows.map((row) => row.indexname),
      ['room_type_images_cover_key', 'room_type_images_media_asset_id_key', 'room_type_images_pkey'],
      'a unique (room_type_id, sort_order) would make every reorder a deferred-constraint problem',
    );
  });
});

describe('the cover invariant', () => {
  it('allows several non-cover images for one room type', async () => {
    for (let index = 0; index < 3; index += 1) {
      await linkImage({
        roomTypeId: roomTypeIds[slugs.covers]!,
        mediaAssetId: await insertAsset(),
        sortOrder: index,
        isCover: false,
      });
    }

    const { rows } = await dbPool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM room_type_images WHERE room_type_id = $1',
      [roomTypeIds[slugs.covers]],
    );

    assert.equal(rows[0]?.count, 3, 'a room type with images but no cover is legal to the database');
  });

  it('allows one cover', async () => {
    const id = await linkImage({
      roomTypeId: roomTypeIds[slugs.covers]!,
      mediaAssetId: await insertAsset(),
      sortOrder: 3,
      isCover: true,
    });

    assert.ok(id);
  });

  it('refuses a second cover for the same room type', async () => {
    const mediaAssetId = await insertAsset();

    assert.deepEqual(
      await violation(() =>
        dbPool.query(
          INSERT_IMAGE,
          linkValues({ roomTypeId: roomTypeIds[slugs.covers]!, mediaAssetId, sortOrder: 4, isCover: true }),
        ),
      ),
      { code: '23505', constraint: 'room_type_images_cover_key' },
    );
  });

  it('refuses promoting a second image to cover by UPDATE as well as by INSERT', async () => {
    const { rows } = await dbPool.query<{ id: string }>(
      'SELECT id FROM room_type_images WHERE room_type_id = $1 AND NOT is_cover ORDER BY id LIMIT 1',
      [roomTypeIds[slugs.covers]],
    );

    const id = rows[0]?.id;
    assert.ok(id, 'expected a non-cover image to promote');

    assert.deepEqual(
      await violation(() => dbPool.query('UPDATE room_type_images SET is_cover = true WHERE id = $1', [id])),
      { code: '23505', constraint: 'room_type_images_cover_key' },
    );
  });

  it('lets each room type hold its own cover', async () => {
    const a = await linkImage({
      roomTypeId: roomTypeIds[slugs.a]!,
      mediaAssetId: await insertAsset(),
      isCover: true,
    });
    const b = await linkImage({
      roomTypeId: roomTypeIds[slugs.b]!,
      mediaAssetId: await insertAsset(),
      isCover: true,
    });

    assert.ok(a);
    assert.ok(b);

    const { rows } = await dbPool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM room_type_images WHERE is_cover AND room_type_id = ANY($1)',
      [[roomTypeIds[slugs.a], roomTypeIds[slugs.b]]],
    );

    assert.equal(rows[0]?.count, 2);
  });

  it('is a partial unique index on (room_type_id)', async () => {
    assert.deepEqual(await indexShape('room_type_images_cover_key'), {
      columns: ['room_type_id'],
      unique: true,
      partial: true,
    });
  });
});

describe('the down migration', () => {
  // The migration's own down path is not run here: rolling the schema back
  // under a suite that shares this database would take it away from everything
  // else. What is proven instead is the claim that path makes — that dropping
  // these two tables, in this order, removes these objects and nothing else —
  // by doing exactly that inside a transaction and rolling it back.
  it('removes only the two new tables and their own indexes', async () => {
    const client = await dbPool.connect();

    try {
      await client.query('BEGIN');

      const tablesBefore = await tableNames(client);
      const indexesBefore = await indexNames(client);

      await client.query('DROP TABLE room_type_images');
      await client.query('DROP TABLE media_assets');

      const tablesAfter = await tableNames(client);
      const indexesAfter = await indexNames(client);

      assert.deepEqual(
        tablesBefore.filter((name) => !tablesAfter.includes(name)),
        ['media_assets', 'room_type_images'],
      );

      assert.deepEqual(
        indexesBefore.filter((name) => !indexesAfter.includes(name)),
        [
          'media_assets_pkey',
          'media_assets_reference_key',
          'media_assets_storage_key_key',
          'room_type_images_cover_key',
          'room_type_images_media_asset_id_key',
          'room_type_images_pkey',
          'room_type_images_room_type_id_sort_order_id_idx',
        ],
      );

      assert.ok(tablesAfter.includes('room_types'));
      assert.ok(tablesAfter.includes('rooms'));
      assert.ok(tablesAfter.includes('reservations'));
      assert.ok(tablesAfter.includes('admin_users'));
      assert.ok(tablesAfter.includes('admin_sessions'));
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('must drop the tables in that order', async () => {
    const client = await dbPool.connect();

    try {
      await client.query('BEGIN');

      const error = await violation(() => client.query('DROP TABLE media_assets'));

      // 2BP01 is dependent_objects_still_exist: the link table's foreign key
      // is why down names room_type_images first, and this is the proof that
      // the order is load-bearing rather than stylistic.
      assert.equal(error.code, '2BP01');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('left the schema intact after both rollbacks', async () => {
    const { rows } = await dbPool.query<{ tables: number }>(
      `SELECT COUNT(*)::int AS tables FROM pg_tables
        WHERE schemaname = 'public' AND tablename IN ('media_assets', 'room_type_images')`,
    );

    assert.equal(rows[0]?.tables, 2);
  });
});
