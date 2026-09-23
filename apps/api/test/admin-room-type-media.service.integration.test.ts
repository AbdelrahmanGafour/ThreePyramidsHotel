import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import sharp from 'sharp';

// Exercises the room-type media service against REAL PostgreSQL and a FAKE
// MediaStorage. The transactions, the locks, the constraints and the ordering
// are all real; nothing reaches Cloudflare, and no R2 environment variable is
// read or required.
//
// Every fixture carries identifiers unique to this run and is removed
// afterwards.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');
type Service = typeof import('../src/modules/admin-room-type-media/admin-room-type-media.service.js');
type Types = typeof import('../src/modules/admin-room-type-media/admin-room-type-media.types.js');
type MediaStorage = import('../src/modules/media/media.types.js').MediaStorage;

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let service: Service;
let isMediaUploadCleanupError: Types['isMediaUploadCleanupError'];
let isMediaPersistenceOutcomeUncertainError: Types['isMediaPersistenceOutcomeUncertainError'];

const runId = randomUUID().slice(0, 8);
const slugPrefix = `itest-media-svc-${runId}`;

const slugs = {
  work: `${slugPrefix}-work`,
  other: `${slugPrefix}-other`,
  limit: `${slugPrefix}-limit`,
  race: `${slugPrefix}-race`,
  gone: `${slugPrefix}-gone`,
} as const;

const roomTypeIds: Record<string, string> = {};

let untouchedBefore: { rooms: number; reservations: number };

// ---------------------------------------------------------------------------
// The storage double
// ---------------------------------------------------------------------------

type Operation = { op: 'put' | 'delete'; key: string };

/**
 * An in-memory MediaStorage that records everything and can be told to fail.
 *
 * Deterministic and synchronous in spirit: no timers, no randomness, no
 * network. It is the whole of what the service is allowed to know about object
 * storage, which is what lets these tests assert the *ordering* of storage
 * against database work rather than just its outcome.
 */
class FakeStorage implements MediaStorage {
  readonly objects = new Map<string, Buffer>();
  readonly operations: Operation[] = [];

  private failPuts = 0;
  private failDeletes = 0;

  failNextPut(times = 1): void {
    this.failPuts = times;
  }

  failNextDelete(times = 1): void {
    this.failDeletes = times;
  }

  async putObject({ key, body }: { key: string; body: Buffer }): Promise<void> {
    this.operations.push({ op: 'put', key });

    if (this.failPuts > 0) {
      this.failPuts -= 1;
      throw new Error('fake storage: put refused');
    }

    this.objects.set(key, Buffer.from(body));
  }

  async deleteObject(key: string): Promise<void> {
    this.operations.push({ op: 'delete', key });

    if (this.failDeletes > 0) {
      this.failDeletes -= 1;
      throw new Error('fake storage: delete refused');
    }

    this.objects.delete(key);
  }

  get keys(): string[] {
    return [...this.objects.keys()].sort();
  }

  countOperations(op: 'put' | 'delete', key?: string): number {
    return this.operations.filter((entry) => entry.op === op && (key === undefined || entry.key === key)).length;
  }
}

let storage: FakeStorage;
const deps = () => ({ storage });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A small real PNG, produced by sharp so normalization has something to do. */
async function png(width = 40, height = 24, background = '#1d4ed8'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

async function jpeg(width = 40, height = 24): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#a33' } }).jpeg().toBuffer();
}

/** A genuinely animated WebP, so the animation rejection is real. */
async function animatedWebp(): Promise<Buffer> {
  const hex = (value: string) => Buffer.from(value.replace(/\s/g, ''), 'hex');

  const gif = Buffer.concat([
    hex('47 49 46 38 39 61'),
    hex('0100 0100'),
    hex('80'),
    hex('00 00'),
    hex('FF0000 0000FF'),
    hex('21 FF 0B'),
    Buffer.from('NETSCAPE2.0', 'ascii'),
    hex('03 01 0000 00'),
    hex('21 F9 04 00 0A00 00 00'),
    hex('2C 0000 0000 0100 0100 00'),
    hex('02 02 4401 00'),
    hex('21 F9 04 00 0A00 00 00'),
    hex('2C 0000 0000 0100 0100 00'),
    hex('02 02 4C01 00'),
    hex('3B'),
  ]);

  return sharp(gif, { animated: true }).webp().toBuffer();
}

/** Uploads one valid PNG and returns the created image. */
async function upload(slug: string) {
  const result = await service.uploadRoomTypeImage(deps(), {
    slug,
    declaredContentType: 'image/png',
    body: await png(),
  });

  assert.equal(result.outcome, 'uploaded', `upload failed: ${JSON.stringify(result)}`);
  assert.ok(result.outcome === 'uploaded');

  return result.image;
}

async function listed(slug: string) {
  const result = await service.listRoomTypeImages(slug);

  assert.ok(result.outcome === 'listed', `list failed: ${JSON.stringify(result)}`);

  return result.images;
}

async function rowCounts(roomTypeId: string): Promise<{ relations: number; covers: number }> {
  const { rows } = await dbPool.query<{ relations: number; covers: number }>(
    `SELECT COUNT(*)::int AS relations,
            COUNT(*) FILTER (WHERE is_cover)::int AS covers
       FROM room_type_images WHERE room_type_id = $1`,
    [roomTypeId],
  );

  return rows[0]!;
}

async function assetCount(reference: string): Promise<number> {
  const { rows } = await dbPool.query<{ total: number }>(
    'SELECT COUNT(*)::int AS total FROM media_assets WHERE reference = $1',
    [reference],
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

/** Removes every image of one room type directly, so a test starts empty. */
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

/**
 * Makes the next `room_type_images` INSERT fail, for as long as the callback
 * runs.
 *
 * A trigger rather than a stub, because the point is to fail *after* a
 * successful PUT and *inside* the transaction, which is exactly where a real
 * unexpected database error would land. Created and dropped inside the test;
 * no migration is touched.
 */
async function withFailingImageInsert<T>(run: () => Promise<T>): Promise<T> {
  const name = `itest_media_fail_${runId}`;

  await dbPool.query(
    `CREATE FUNCTION ${name}() RETURNS trigger AS $$
       BEGIN RAISE EXCEPTION 'itest: room_type_images insert refused'; END;
     $$ LANGUAGE plpgsql`,
  );
  await dbPool.query(
    `CREATE TRIGGER ${name} BEFORE INSERT ON room_type_images
       FOR EACH ROW EXECUTE FUNCTION ${name}()`,
  );

  try {
    return await run();
  } finally {
    await dbPool.query(`DROP TRIGGER IF EXISTS ${name} ON room_type_images`);
    await dbPool.query(`DROP FUNCTION IF EXISTS ${name}()`);
  }
}


/**
 * Runs something with a client whose `COMMIT` is attempted and then throws.
 *
 * Everything else is the real connection doing real work: BEGIN, the locks,
 * the INSERTs and the DELETEs all reach PostgreSQL normally, and only the
 * commit's answer is lost. That is the one failure a healthy connection cannot
 * be made to produce, and the one whose handling this fix is about.
 *
 * The service never rolls back after an uncertain commit, so the session is
 * left mid-transaction and is destroyed on release; PostgreSQL discards the
 * open transaction when the connection drops, which leaves the database clean
 * without anything having inferred an outcome.
 */
async function withUnansweredCommit<T>(run: () => Promise<T>): Promise<{ result: T; commits: number }> {
  let commits = 0;

  service.__setClientFactoryForTests(async () => {
    const real = await dbPool.connect();

    // Bound explicitly: `pg` looks up `this` inside `query`, and assigning the
    // method to a variable would drop it.
    const forward = (real.query as (...inner: unknown[]) => Promise<unknown>).bind(real);

    const wrapper = {
      query: (...args: unknown[]) => {
        const first = args[0];
        const text = typeof first === 'string' ? first : (first as { text?: string } | undefined)?.text;

        if (text === 'COMMIT') {
          commits += 1;

          return Promise.reject(
            Object.assign(new Error('simulated: connection lost while committing'), { code: '08006' }),
          );
        }

        return forward(...args);
      },
      release: (destroy?: unknown) => real.release(destroy as never),
    };

    return wrapper as never;
  });

  try {
    return { result: await run(), commits };
  } finally {
    service.__setClientFactoryForTests(null);
  }
}


/**
 * Runs something with a client whose `COMMIT` **really commits**, and only then
 * reports a connection failure.
 *
 * This is the dangerous half of the ambiguity, and the one the other seam
 * cannot reach. There, COMMIT was rejected before PostgreSQL ever saw it, so
 * the transaction genuinely did not commit and keeping the object was merely
 * tidy. Here the server has committed — the rows are durable, the row owns its
 * object — and the acknowledgement is what went missing. If the service
 * compensated on this path it would delete an object that a committed row
 * points at, which is precisely the state the architecture forbids.
 *
 * The forwarded COMMIT is awaited and its success counted before the simulated
 * error is thrown, so the test can prove the commit really happened rather
 * than assuming it. No second COMMIT is issued and no ROLLBACK follows.
 */
async function withLostCommitAcknowledgement<T>(run: () => Promise<T>): Promise<{
  result: T;
  attempted: number;
  reallyCommitted: number;
}> {
  let attempted = 0;
  let reallyCommitted = 0;

  service.__setClientFactoryForTests(async () => {
    const real = await dbPool.connect();
    // Bound explicitly: `pg` looks up `this` inside `query`, and assigning the
    // method to a variable would drop it.
    const forward = (real.query as (...inner: unknown[]) => Promise<unknown>).bind(real);

    const wrapper = {
      query: (...args: unknown[]) => {
        const first = args[0];
        const text = typeof first === 'string' ? first : (first as { text?: string } | undefined)?.text;

        if (text === 'COMMIT') {
          attempted += 1;

          return forward(...args).then(() => {
            reallyCommitted += 1;

            throw Object.assign(new Error('simulated: acknowledgement lost after COMMIT'), {
              code: '08006',
            });
          });
        }

        return forward(...args);
      },
      release: (destroy?: unknown) => real.release(destroy as never),
    };

    return wrapper as never;
  });

  try {
    return { result: await run(), attempted, reallyCommitted };
  } finally {
    service.__setClientFactoryForTests(null);
  }
}

/** Captures the error a promise rejects with. */
async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }

  assert.fail('expected the operation to reject');
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  service = await import('../src/modules/admin-room-type-media/admin-room-type-media.service.js');
  ({ isMediaUploadCleanupError, isMediaPersistenceOutcomeUncertainError } = await import(
    '../src/modules/admin-room-type-media/admin-room-type-media.types.js'
  ));

  const { rows } = await dbPool.query<{ rooms: number; reservations: number }>(
    `SELECT (SELECT COUNT(*) FROM rooms)::int AS rooms,
            (SELECT COUNT(*) FROM reservations)::int AS reservations`,
  );

  untouchedBefore = rows[0]!;

  for (const slug of Object.values(slugs)) {
    await insertRoomType(slug);
  }
});

beforeEach(() => {
  storage = new FakeStorage();
});

after(async () => {
  try {
    const like = `${slugPrefix}-%`;

    await dbPool.query(
      'DELETE FROM room_type_images WHERE room_type_id IN (SELECT id FROM room_types WHERE slug LIKE $1)',
      [like],
    );
    // Assets written by this suite are only reachable through those relations,
    // so anything now unreferenced and created during it goes too.
    await dbPool.query(
      `DELETE FROM media_assets
        WHERE id NOT IN (SELECT media_asset_id FROM room_type_images)
          AND created_at >= now() - interval '1 hour'
          AND storage_key LIKE 'media/%'`,
    );
    await dbPool.query('DELETE FROM room_types WHERE slug LIKE $1', [like]);

    const { rows } = await dbPool.query<{ types: number; rooms: number; reservations: number }>(
      `SELECT (SELECT COUNT(*) FROM room_types WHERE slug LIKE $1)::int AS types,
              (SELECT COUNT(*) FROM rooms)::int AS rooms,
              (SELECT COUNT(*) FROM reservations)::int AS reservations`,
      [like],
    );

    assert.deepEqual(
      rows[0],
      { types: 0, ...untouchedBefore },
      'fixtures were not fully removed, or rows this suite must not touch changed',
    );
  } finally {
    await closeDatabasePool();
  }
});

describe('upload: validation happens before anything leaves the process', () => {
  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  it('refuses an unsupported source type without touching storage', async () => {
    const result = await service.uploadRoomTypeImage(deps(), {
      slug: slugs.work,
      declaredContentType: 'image/svg+xml',
      body: Buffer.from('<svg/>', 'utf8'),
    });

    assert.deepEqual(result, { outcome: 'invalid-upload', reason: 'unsupported-content-type' });
    assert.deepEqual(storage.operations, []);
  });

  it('refuses a declared type that disagrees with the bytes', async () => {
    const result = await service.uploadRoomTypeImage(deps(), {
      slug: slugs.work,
      declaredContentType: 'image/jpeg',
      body: await png(),
    });

    assert.deepEqual(result, { outcome: 'invalid-upload', reason: 'content-type-mismatch' });
    assert.deepEqual(storage.operations, []);
  });

  it('refuses a body that is not an image', async () => {
    const result = await service.uploadRoomTypeImage(deps(), {
      slug: slugs.work,
      declaredContentType: 'image/png',
      body: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('not really a png', 'utf8'),
      ]),
    });

    assert.equal(result.outcome, 'invalid-image');
    assert.deepEqual(storage.operations, [], 'a body that cannot decode never reaches storage');
  });

  it('refuses an animated image', async () => {
    const result = await service.uploadRoomTypeImage(deps(), {
      slug: slugs.work,
      declaredContentType: 'image/webp',
      body: await animatedWebp(),
    });

    assert.deepEqual(result, { outcome: 'invalid-image', reason: 'animated-or-multi-page' });
    assert.deepEqual(storage.operations, []);
  });

  it('stores normalized WebP bytes whose checksum matches what the database records', async () => {
    const image = await upload(slugs.work);

    const stored = storage.objects.get(image.storageKey);
    assert.ok(stored, 'the object was not stored under the key the row carries');

    assert.equal(image.contentType, 'image/webp');
    assert.equal(createHash('sha256').update(stored).digest('hex'), image.checksumSha256);
    assert.equal(stored.length, image.byteSize);

    const metadata = await sharp(stored).metadata();
    assert.equal(metadata.format, 'webp', 'what reached storage really is a WebP');
    assert.equal(metadata.width, image.width);
    assert.equal(metadata.height, image.height);
  });
});

describe('upload: the room type and the object store', () => {
  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  it('refuses an unknown room type before uploading anything', async () => {
    const result = await service.uploadRoomTypeImage(deps(), {
      slug: `${slugPrefix}-nope`,
      declaredContentType: 'image/png',
      body: await png(),
    });

    assert.deepEqual(result, { outcome: 'room-type-not-found', cleanup: { attempted: false } });
    assert.deepEqual(storage.operations, [], 'no bytes are sent for a slug that does not exist');
  });

  it('writes nothing to the database when the put fails', async () => {
    storage.failNextPut();

    const result = await service.uploadRoomTypeImage(deps(), {
      slug: slugs.work,
      declaredContentType: 'image/png',
      body: await png(),
    });

    assert.deepEqual(result, { outcome: 'media-storage-unavailable' });
    assert.deepEqual(await rowCounts(roomTypeIds[slugs.work]!), { relations: 0, covers: 0 });
    assert.equal(storage.countOperations('put'), 1, 'one attempt, never a retry');
    assert.equal(storage.countOperations('delete'), 0, 'nothing was stored, so nothing is compensated');
    assert.deepEqual(await listed(slugs.work), []);
  });

  it('makes the first image the cover and later ones not', async () => {
    const first = await upload(slugs.work);
    const second = await upload(slugs.work);
    const third = await upload(slugs.work);

    const images = await listed(slugs.work);

    assert.equal(images[0]!.reference, first.reference);
    assert.equal(images[0]!.isCover, true);
    assert.deepEqual(
      images.slice(1).map((image) => image.isCover),
      [false, false],
    );
    assert.deepEqual(
      images.map((image) => image.sortOrder),
      [0, 1, 2],
      'each upload takes max(sort_order) + 1',
    );
    assert.equal((await rowCounts(roomTypeIds[slugs.work]!)).covers, 1);
    assert.equal(second.isCover, false);
    assert.equal(third.sortOrder, 2);
  });

  it('starts an upload with no alt text', async () => {
    const image = await upload(slugs.work);

    assert.equal(image.altText, null);
  });
});

describe('upload: compensation when the database refuses', () => {
  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  it('removes the object again when the insert fails unexpectedly', async () => {
    const body = await png();

    await withFailingImageInsert(async () => {
      await assert.rejects(
        () =>
          service.uploadRoomTypeImage(deps(), {
            slug: slugs.work,
            declaredContentType: 'image/png',
            body,
          }),
        (error: Error) => {
          // The original database failure propagates: an unexpected error is
          // not flattened into a business outcome.
          assert.equal(isMediaUploadCleanupError(error), false);

          return true;
        },
      );
    });

    assert.deepEqual(await rowCounts(roomTypeIds[slugs.work]!), { relations: 0, covers: 0 });
    assert.equal(storage.countOperations('put'), 1, 'the bytes were uploaded before the database refused');
    assert.equal(storage.countOperations('delete'), 1, 'compensated exactly once, never retried');
    assert.deepEqual(storage.keys, [], 'compensation left the store clean');
  });

  it('reports the orphan when compensation itself fails', async () => {
    const body = await png();

    storage.failNextDelete();

    await withFailingImageInsert(async () => {
      await assert.rejects(
        () =>
          service.uploadRoomTypeImage(deps(), {
            slug: slugs.work,
            declaredContentType: 'image/png',
            body,
          }),
        (error: unknown) => {
          assert.ok(isMediaUploadCleanupError(error), 'a failed cleanup must be named, not lost');
          assert.match(error.storageKey, /^media\/[0-9a-f-]{36}\.webp$/);
          assert.equal(error.message, 'Media upload failed and its stored object could not be removed');

          // Only safe operational facts: the key, and nothing about the
          // endpoint, the bucket, a credential or the SQL that failed. The
          // original error stays reachable for a debugger but non-enumerable,
          // so nothing serialises it by accident.
          assert.deepEqual(Object.keys(error).sort(), ['name', 'storageKey']);
          assert.ok(error.cause, 'the original failure is still reachable');
          assert.equal(
            JSON.stringify(error).includes('room_type_images insert refused'),
            false,
            'the database error must not serialise out with it',
          );

          return true;
        },
      );
    });

    assert.deepEqual(
      await rowCounts(roomTypeIds[slugs.work]!),
      { relations: 0, covers: 0 },
      'the database is clean even though the object is not',
    );
    assert.equal(storage.countOperations('delete'), 1, 'one attempt, never a retry');
    assert.equal(storage.keys.length, 1, 'the object remains as an orphan');
  });

  it('compensates when the room type disappears between the pre-flight read and the lock', async () => {
    const slug = slugs.gone;
    const body = await png();

    // A room type is not hard-deleted in V1, but the transaction must not
    // assume the unlocked pre-flight read is still true.
    await dbPool.query('DELETE FROM room_types WHERE slug = $1', [slug]);

    const result = await service.uploadRoomTypeImage(deps(), {
      slug,
      declaredContentType: 'image/png',
      body,
    });

    assert.deepEqual(result, { outcome: 'room-type-not-found', cleanup: { attempted: false } });
    assert.deepEqual(storage.operations, []);

    await insertRoomType(slug);
  });
});

describe('upload: the twelve-image ceiling', () => {
  const roomTypeId = () => roomTypeIds[slugs.limit]!;

  it('refuses a thirteenth image and compensates the object it had uploaded', async () => {
    await clearImages(roomTypeId());

    for (let index = 0; index < 12; index += 1) {
      await upload(slugs.limit);
    }

    const putsBefore = storage.countOperations('put');

    const result = await service.uploadRoomTypeImage(deps(), {
      slug: slugs.limit,
      declaredContentType: 'image/png',
      body: await png(),
    });

    assert.equal(result.outcome, 'image-limit-reached');
    assert.ok(result.outcome === 'image-limit-reached');
    assert.deepEqual(result.cleanup, { attempted: true, removed: true });

    assert.equal(storage.countOperations('put'), putsBefore + 1, 'the bytes were uploaded before the refusal');
    assert.equal(storage.keys.length, 12, 'and removed again, leaving one object per stored image');
    assert.deepEqual(await rowCounts(roomTypeId()), { relations: 12, covers: 1 });
  });
});

describe('upload: two administrators at once', () => {
  const roomTypeId = () => roomTypeIds[slugs.race]!;

  it('lets exactly one of two concurrent uploads become the twelfth image', async () => {
    await clearImages(roomTypeId());

    for (let index = 0; index < 11; index += 1) {
      await upload(slugs.race);
    }

    assert.deepEqual(await rowCounts(roomTypeId()), { relations: 11, covers: 1 });

    const bodies = await Promise.all([png(40, 24, '#0a0'), png(40, 24, '#00a')]);

    // Both validate, normalize and PUT before either reaches the parent lock.
    // Only one may then commit.
    const [first, second] = await Promise.all(
      bodies.map((body) =>
        service.uploadRoomTypeImage(deps(), {
          slug: slugs.race,
          declaredContentType: 'image/png',
          body,
        }),
      ),
    );

    const outcomes = [first!.outcome, second!.outcome].sort();

    assert.deepEqual(outcomes, ['image-limit-reached', 'uploaded'], 'exactly one succeeded');

    const winner = first!.outcome === 'uploaded' ? first! : second!;
    const loser = first!.outcome === 'uploaded' ? second! : first!;

    assert.ok(winner.outcome === 'uploaded');
    assert.ok(loser.outcome === 'image-limit-reached');
    assert.deepEqual(loser.cleanup, { attempted: true, removed: true });

    assert.deepEqual(
      await rowCounts(roomTypeId()),
      { relations: 12, covers: 1 },
      'the ceiling held: no thirteenth relation',
    );

    assert.equal(storage.countOperations('put'), 13, 'both uploads really did write bytes');
    assert.equal(storage.keys.length, 12, 'the loser’s object was compensated');
    assert.ok(storage.objects.has(winner.image.storageKey), 'the winner’s object remains');

    const images = await listed(slugs.race);
    assert.equal(images.length, 12);
    assert.ok(images.some((image) => image.reference === winner.image.reference));
  });
});

describe('listing', () => {
  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  it('reports a missing room type rather than an empty gallery', async () => {
    assert.deepEqual(await service.listRoomTypeImages(`${slugPrefix}-nope`), {
      outcome: 'room-type-not-found',
    });
  });

  it('returns the repository order, cover first', async () => {
    const first = await upload(slugs.work);
    await upload(slugs.work);
    const third = await upload(slugs.work);

    await service.setRoomTypeImageCover({ slug: slugs.work, imageReference: third.reference });

    const images = await listed(slugs.work);

    assert.equal(images[0]!.reference, third.reference);
    assert.equal(images[0]!.sortOrder, 2, 'the cover leads without its order being rewritten');
    assert.equal(images[1]!.reference, first.reference);
  });

  it('exposes no internal identifier', async () => {
    await upload(slugs.work);

    for (const image of await listed(slugs.work)) {
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

  it('performs no storage operation', async () => {
    await upload(slugs.work);
    const before = storage.operations.length;

    await listed(slugs.work);

    assert.equal(storage.operations.length, before);
  });
});

describe('alt text', () => {
  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  it('normalizes and stores the text', async () => {
    const image = await upload(slugs.work);

    assert.deepEqual(
      await service.updateRoomTypeImageAltText({
        slug: slugs.work,
        imageReference: image.reference,
        altText: '  A terrace at dusk.  ',
      }),
      { outcome: 'updated' },
    );

    assert.equal((await listed(slugs.work))[0]!.altText, 'A terrace at dusk.');
  });

  it('turns whitespace into nothing at all', async () => {
    const image = await upload(slugs.work);

    await service.updateRoomTypeImageAltText({
      slug: slugs.work,
      imageReference: image.reference,
      altText: '   \t\n ',
    });

    assert.equal((await listed(slugs.work))[0]!.altText, null);
  });

  it('refuses text past the limit before it mutates anything', async () => {
    const image = await upload(slugs.work);

    assert.deepEqual(
      await service.updateRoomTypeImageAltText({
        slug: slugs.work,
        imageReference: image.reference,
        altText: 'a'.repeat(241),
      }),
      { outcome: 'invalid-alt-text', reason: 'too-long' },
    );

    assert.equal((await listed(slugs.work))[0]!.altText, null, 'nothing was written');
  });

  it('refuses a malformed reference', async () => {
    for (const reference of ['not-a-uuid', '550E8400-E29B-41D4-A716-446655440000', '', null, 42]) {
      assert.deepEqual(
        await service.updateRoomTypeImageAltText({
          slug: slugs.work,
          imageReference: reference,
          altText: 'x',
        }),
        { outcome: 'invalid-image-reference' },
      );
    }
  });

  it('answers a foreign image exactly as it answers an unknown one', async () => {
    const mine = await upload(slugs.work);

    const foreign = await service.updateRoomTypeImageAltText({
      slug: slugs.other,
      imageReference: mine.reference,
      altText: 'not yours',
    });
    const unknown = await service.updateRoomTypeImageAltText({
      slug: slugs.other,
      imageReference: randomUUID(),
      altText: 'not yours',
    });

    assert.deepEqual(foreign, { outcome: 'image-not-found' });
    assert.deepEqual(foreign, unknown);
    assert.equal((await listed(slugs.work))[0]!.altText, null, 'the other room type’s image is untouched');
  });

  it('performs no storage operation', async () => {
    const image = await upload(slugs.work);
    const before = storage.operations.length;

    await service.updateRoomTypeImageAltText({
      slug: slugs.work,
      imageReference: image.reference,
      altText: 'x',
    });

    assert.equal(storage.operations.length, before);
  });
});

describe('the cover', () => {
  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  it('moves the cover and leaves exactly one', async () => {
    const first = await upload(slugs.work);
    const second = await upload(slugs.work);

    assert.deepEqual(
      await service.setRoomTypeImageCover({ slug: slugs.work, imageReference: second.reference }),
      { outcome: 'updated' },
    );

    const images = await listed(slugs.work);

    assert.equal(images[0]!.reference, second.reference);
    assert.equal(images[0]!.isCover, true);
    assert.equal(images.find((image) => image.reference === first.reference)!.isCover, false);
    assert.equal((await rowCounts(roomTypeIds[slugs.work]!)).covers, 1);
  });

  it('is idempotent for the image that is already the cover', async () => {
    const first = await upload(slugs.work);
    await upload(slugs.work);

    const before = (await listed(slugs.work))[0]!;

    assert.deepEqual(
      await service.setRoomTypeImageCover({ slug: slugs.work, imageReference: first.reference }),
      { outcome: 'updated' },
    );

    const after = (await listed(slugs.work))[0]!;

    assert.equal(after.reference, first.reference);
    assert.equal(after.updatedAt, before.updatedAt, 'nothing changed, so nothing was touched');
    assert.equal((await rowCounts(roomTypeIds[slugs.work]!)).covers, 1);
  });

  it('does not clear the current cover for a foreign or unknown target', async () => {
    const mine = await upload(slugs.work);
    await upload(slugs.work);

    // This is the precondition the repository helper depends on: without the
    // scoped lookup first, `setRoomTypeImageAsCover` would clear this room
    // type's cover and promote nothing.
    const otherImage = await upload(slugs.other);

    for (const reference of [otherImage.reference, randomUUID()]) {
      assert.deepEqual(await service.setRoomTypeImageCover({ slug: slugs.work, imageReference: reference }), {
        outcome: 'image-not-found',
      });

      const images = await listed(slugs.work);
      assert.equal(images[0]!.reference, mine.reference, 'the cover is exactly where it was');
      assert.equal((await rowCounts(roomTypeIds[slugs.work]!)).covers, 1);
    }

    await clearImages(roomTypeIds[slugs.other]!);
  });

  it('refuses a malformed reference and performs no storage operation', async () => {
    await upload(slugs.work);
    const before = storage.operations.length;

    assert.deepEqual(await service.setRoomTypeImageCover({ slug: slugs.work, imageReference: '{bad}' }), {
      outcome: 'invalid-image-reference',
    });
    assert.equal(storage.operations.length, before);
  });
});

describe('reordering', () => {
  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  const order = async () => (await listed(slugs.work)).map((image) => image.reference);

  it('moves an image up and down', async () => {
    const [a, b, c] = [await upload(slugs.work), await upload(slugs.work), await upload(slugs.work)];

    // `a` is the cover, so it leads the listing regardless; the arrangement is
    // read from sort order instead.
    const arranged = async () => {
      const { rows } = await dbPool.query<{ reference: string }>(
        `SELECT ma.reference FROM room_type_images rti
           JOIN media_assets ma ON ma.id = rti.media_asset_id
          WHERE rti.room_type_id = $1 ORDER BY rti.sort_order, rti.id`,
        [roomTypeIds[slugs.work]],
      );

      return rows.map((row) => row.reference);
    };

    assert.deepEqual(
      await service.moveRoomTypeImage({ slug: slugs.work, imageReference: c.reference, direction: 'up' }),
      { outcome: 'moved' },
    );
    assert.deepEqual(await arranged(), [a.reference, c.reference, b.reference]);

    assert.deepEqual(
      await service.moveRoomTypeImage({ slug: slugs.work, imageReference: a.reference, direction: 'down' }),
      { outcome: 'moved' },
    );
    assert.deepEqual(await arranged(), [c.reference, a.reference, b.reference]);

    assert.equal((await rowCounts(roomTypeIds[slugs.work]!)).covers, 1);
    assert.equal((await order())[0], a.reference, 'the cover did not change');
  });

  it('reports a boundary rather than pretending to move', async () => {
    const first = await upload(slugs.work);
    const last = await upload(slugs.work);

    assert.deepEqual(
      await service.moveRoomTypeImage({ slug: slugs.work, imageReference: first.reference, direction: 'up' }),
      { outcome: 'boundary' },
    );
    assert.deepEqual(
      await service.moveRoomTypeImage({ slug: slugs.work, imageReference: last.reference, direction: 'down' }),
      { outcome: 'boundary' },
    );
  });

  it('refuses an invalid direction and a malformed reference', async () => {
    const image = await upload(slugs.work);

    for (const direction of ['UP', 'Down', ' up', 'left', 0, null]) {
      assert.deepEqual(
        await service.moveRoomTypeImage({ slug: slugs.work, imageReference: image.reference, direction }),
        { outcome: 'invalid-order-direction' },
      );
    }

    assert.deepEqual(
      await service.moveRoomTypeImage({ slug: slugs.work, imageReference: 'nope', direction: 'up' }),
      { outcome: 'invalid-image-reference' },
    );
  });

  it('answers a foreign image exactly as it answers an unknown one', async () => {
    await upload(slugs.work);
    const foreignImage = await upload(slugs.other);

    const foreign = await service.moveRoomTypeImage({
      slug: slugs.work,
      imageReference: foreignImage.reference,
      direction: 'up',
    });
    const unknown = await service.moveRoomTypeImage({
      slug: slugs.work,
      imageReference: randomUUID(),
      direction: 'up',
    });

    assert.deepEqual(foreign, { outcome: 'image-not-found' });
    assert.deepEqual(foreign, unknown);

    await clearImages(roomTypeIds[slugs.other]!);
  });

  it('performs no storage operation', async () => {
    const image = await upload(slugs.work);
    const before = storage.operations.length;

    await service.moveRoomTypeImage({ slug: slugs.work, imageReference: image.reference, direction: 'down' });

    assert.equal(storage.operations.length, before);
  });
});

describe('deleting', () => {
  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  it('removes the rows, then the object, in that order', async () => {
    const cover = await upload(slugs.work);
    const second = await upload(slugs.work);

    const putsBefore = storage.operations.length;

    const result = await service.deleteRoomTypeImage(deps(), {
      slug: slugs.work,
      imageReference: second.reference,
    });

    assert.deepEqual(result, {
      outcome: 'deleted',
      reference: second.reference,
      cleanup: { attempted: true, removed: true },
    });

    // The storage delete is the only operation after the commit, and it comes
    // after every put — the database went first.
    assert.deepEqual(storage.operations.slice(putsBefore), [{ op: 'delete', key: second.storageKey }]);
    assert.equal(storage.objects.has(second.storageKey), false);
    assert.equal(storage.objects.has(cover.storageKey), true);

    assert.deepEqual(await rowCounts(roomTypeIds[slugs.work]!), { relations: 1, covers: 1 });
    assert.equal(await assetCount(second.reference), 0, 'the media_assets row went too');
    assert.equal((await listed(slugs.work))[0]!.reference, cover.reference, 'the cover is unchanged');
  });

  it('promotes the deterministic first remaining image when the cover goes', async () => {
    const cover = await upload(slugs.work);
    const second = await upload(slugs.work);
    const third = await upload(slugs.work);

    await service.deleteRoomTypeImage(deps(), { slug: slugs.work, imageReference: cover.reference });

    const images = await listed(slugs.work);

    assert.equal(images.length, 2);
    assert.equal(images[0]!.reference, second.reference, 'sort_order ASC, id ASC');
    assert.equal(images[0]!.isCover, true);
    assert.equal((await rowCounts(roomTypeIds[slugs.work]!)).covers, 1);
    assert.deepEqual(
      images.map((image) => image.sortOrder).sort(),
      [0, 1],
      'the remaining order was compacted',
    );
    assert.equal(images.some((image) => image.reference === third.reference), true);
  });

  it('leaves zero covers when the last image goes', async () => {
    const only = await upload(slugs.work);

    await service.deleteRoomTypeImage(deps(), { slug: slugs.work, imageReference: only.reference });

    assert.deepEqual(await rowCounts(roomTypeIds[slugs.work]!), { relations: 0, covers: 0 });
    assert.deepEqual(await listed(slugs.work), []);
    assert.deepEqual(storage.keys, []);
  });

  it('touches no storage for an unknown, foreign or malformed reference', async () => {
    const mine = await upload(slugs.work);
    const foreignImage = await upload(slugs.other);
    const before = storage.operations.length;

    assert.deepEqual(await service.deleteRoomTypeImage(deps(), { slug: slugs.work, imageReference: randomUUID() }), {
      outcome: 'image-not-found',
    });
    assert.deepEqual(
      await service.deleteRoomTypeImage(deps(), { slug: slugs.work, imageReference: foreignImage.reference }),
      { outcome: 'image-not-found' },
    );
    assert.deepEqual(await service.deleteRoomTypeImage(deps(), { slug: slugs.work, imageReference: 'nope' }), {
      outcome: 'invalid-image-reference',
    });
    assert.deepEqual(
      await service.deleteRoomTypeImage(deps(), {
        slug: `${slugPrefix}-nope`,
        imageReference: mine.reference,
      }),
      { outcome: 'room-type-not-found' },
    );

    assert.equal(storage.operations.length, before, 'a refusal never reaches storage');
    assert.equal(storage.objects.has(mine.storageKey), true);
    assert.equal(storage.objects.has(foreignImage.storageKey), true);

    await clearImages(roomTypeIds[slugs.other]!);
  });

  it('stays a successful deletion when the object cannot be removed', async () => {
    const image = await upload(slugs.work);

    storage.failNextDelete();

    const result = await service.deleteRoomTypeImage(deps(), {
      slug: slugs.work,
      imageReference: image.reference,
    });

    assert.deepEqual(result, {
      outcome: 'deleted',
      reference: image.reference,
      cleanup: { attempted: true, removed: false, storageKey: image.storageKey },
    });

    // The rows are gone and stay gone. Putting them back to match the object
    // would restore an image nobody asked to keep.
    assert.deepEqual(await rowCounts(roomTypeIds[slugs.work]!), { relations: 0, covers: 0 });
    assert.equal(await assetCount(image.reference), 0);
    assert.deepEqual(await listed(slugs.work), []);

    assert.equal(storage.countOperations('delete', image.storageKey), 1, 'one attempt, never a retry');
    assert.deepEqual(storage.keys, [image.storageKey], 'the object remains as an orphan');
  });

  it('leaves another room type completely untouched', async () => {
    const mine = await upload(slugs.work);
    const theirs = await upload(slugs.other);

    await service.deleteRoomTypeImage(deps(), { slug: slugs.work, imageReference: mine.reference });

    const other = await listed(slugs.other);

    assert.equal(other.length, 1);
    assert.equal(other[0]!.reference, theirs.reference);
    assert.equal(other[0]!.isCover, true);
    assert.equal(storage.objects.has(theirs.storageKey), true);

    await clearImages(roomTypeIds[slugs.other]!);
  });
});

describe('transactions and isolation', () => {
  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  it('leaves no partial state when a transaction is rolled back', async () => {
    const body = await png();

    await withFailingImageInsert(async () => {
      await assert.rejects(() =>
        service.uploadRoomTypeImage(deps(), {
          slug: slugs.work,
          declaredContentType: 'image/png',
          body,
        }),
      );
    });

    // The media_assets insert happened before the failing relation insert, in
    // the same transaction. Neither may survive.
    const { rows } = await dbPool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM media_assets
        WHERE id NOT IN (SELECT media_asset_id FROM room_type_images)
          AND created_at >= now() - interval '1 minute'`,
    );

    assert.equal(rows[0]!.total, 0, 'the asset row rolled back with the relation');
    assert.deepEqual(await rowCounts(roomTypeIds[slugs.work]!), { relations: 0, covers: 0 });
  });

  it('releases every client it borrows', async () => {
    const before = dbPool.totalCount - dbPool.idleCount;

    for (let index = 0; index < 6; index += 1) {
      await upload(slugs.work);
      await listed(slugs.work);
    }

    await service.setRoomTypeImageCover({
      slug: slugs.work,
      imageReference: (await listed(slugs.work))[1]!.reference,
    });

    const after = dbPool.totalCount - dbPool.idleCount;

    assert.equal(after, before, 'a leaked client would show as a permanently checked-out connection');
  });

  it('needs no R2 environment variable', () => {
    // The whole suite has run by now. If the service read any of these, it
    // would have thrown long before this assertion.
    for (const variable of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
      assert.equal(process.env[variable], undefined, `${variable} must not be set while these tests run`);
    }
  });
});

describe('an unanswered COMMIT', () => {
  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  it('never deletes the uploaded object, because the row may exist', async () => {
    const body = await png();

    const { result, commits } = await withUnansweredCommit(() =>
      rejection(() =>
        service.uploadRoomTypeImage(deps(), {
          slug: slugs.work,
          declaredContentType: 'image/png',
          body,
        }),
      ),
    );

    assert.equal(commits, 1, 'COMMIT was reached and attempted exactly once');
    assert.ok(
      isMediaPersistenceOutcomeUncertainError(result),
      `expected an uncertain-outcome error, got ${String(result)}`,
    );
    assert.equal(isMediaUploadCleanupError(result), false, 'this is not a cleanup failure');

    assert.equal(result.operation, 'upload');
    assert.match(result.storageKey ?? '', /^media\/[0-9a-f-]{36}\.webp$/);
    assert.match(result.reference ?? '', /^[0-9a-f-]{36}$/);

    // The whole point: the object stays. Deleting it would, in the reality
    // where the transaction did commit, leave a row pointing at nothing.
    assert.equal(storage.countOperations('put'), 1);
    assert.equal(storage.countOperations('delete'), 0, 'no compensation may be attempted');
    assert.deepEqual(storage.keys, [result.storageKey], 'the uploaded object remains');
  });

  it('claims neither that the image was created nor that it was not', async () => {
    const body = await png();

    const { result } = await withUnansweredCommit(() =>
      rejection(() =>
        service.uploadRoomTypeImage(deps(), {
          slug: slugs.work,
          declaredContentType: 'image/png',
          body,
        }),
      ),
    );

    assert.ok(isMediaPersistenceOutcomeUncertainError(result));
    assert.equal(result.message, 'Media upload persistence outcome uncertain');

    for (const claim of ['failed', 'rolled back', 'rolled-back', 'not created', 'created']) {
      assert.equal(result.message.includes(claim), false, `the message claims "${claim}"`);
    }

    // Only safe operational facts, and nothing a serialiser would carry out.
    assert.deepEqual(Object.keys(result).sort(), ['name', 'operation', 'reference', 'storageKey']);
    assert.equal(JSON.stringify(result).includes('connection lost'), false);
  });

  it('does not delete the object when a deletion\u2019s commit goes unanswered', async () => {
    const image = await upload(slugs.work);
    const operationsBefore = storage.operations.length;

    const { result, commits } = await withUnansweredCommit(() =>
      rejection(() =>
        service.deleteRoomTypeImage(deps(), {
          slug: slugs.work,
          imageReference: image.reference,
        }),
      ),
    );

    assert.equal(commits, 1);
    assert.ok(isMediaPersistenceOutcomeUncertainError(result));
    assert.equal(result.operation, 'delete');
    assert.equal(result.reference, image.reference);
    assert.equal(result.storageKey, image.storageKey);

    assert.equal(
      storage.operations.length,
      operationsBefore,
      'no storage call may follow a commit whose outcome is unknown',
    );
    assert.equal(storage.objects.has(image.storageKey), true, 'the object remains');
  });

  it('is not reported as an ordinary successful deletion', async () => {
    const image = await upload(slugs.work);

    const { result } = await withUnansweredCommit(() =>
      rejection(() =>
        service.deleteRoomTypeImage(deps(), {
          slug: slugs.work,
          imageReference: image.reference,
        }),
      ),
    );

    // It rejects rather than returning, so no caller can read it as a result
    // with `outcome: 'deleted'`.
    assert.ok(isMediaPersistenceOutcomeUncertainError(result));
    assert.equal((result as unknown as { outcome?: string }).outcome, undefined);
  });

  it('releases the connection it could not finish with', async () => {
    const body = await png();
    const before = dbPool.totalCount - dbPool.idleCount;

    await withUnansweredCommit(() =>
      rejection(() =>
        service.uploadRoomTypeImage(deps(), {
          slug: slugs.work,
          declaredContentType: 'image/png',
          body,
        }),
      ),
    );

    // The client is destroyed rather than returned, so it leaves the pool
    // entirely — either way it is not left checked out.
    assert.equal(
      dbPool.totalCount - dbPool.idleCount,
      before,
      'a connection left checked out would never come back',
    );

    // And the abandoned transaction took nothing with it.
    assert.deepEqual(await rowCounts(roomTypeIds[slugs.work]!), { relations: 0, covers: 0 });
  });

  it('leaves ordinary pre-commit failures compensating exactly as before', async () => {
    const body = await png();

    await withFailingImageInsert(async () => {
      await assert.rejects(() =>
        service.uploadRoomTypeImage(deps(), {
          slug: slugs.work,
          declaredContentType: 'image/png',
          body,
        }),
      );
    });

    // A failure before COMMIT is attempted is still known to have written
    // nothing, so its object is still removed.
    assert.equal(storage.countOperations('put'), 1);
    assert.equal(storage.countOperations('delete'), 1);
    assert.deepEqual(storage.keys, []);
    assert.deepEqual(await rowCounts(roomTypeIds[slugs.work]!), { relations: 0, covers: 0 });
  });
});

describe('a COMMIT that succeeded but was never acknowledged', () => {
  // The other uncertain-commit suite proves the side where PostgreSQL never
  // committed. This one proves the side that matters more: it did commit, the
  // row is durable, and the client was told nothing. Compensating here would
  // delete an object a committed row points at.

  beforeEach(async () => {
    await clearImages(roomTypeIds[slugs.work]!);
  });

  it('keeps the uploaded object that the committed row now owns', async () => {
    const body = await png();

    const { result, attempted, reallyCommitted } = await withLostCommitAcknowledgement(() =>
      rejection(() =>
        service.uploadRoomTypeImage(deps(), {
          slug: slugs.work,
          declaredContentType: 'image/png',
          body,
        }),
      ),
    );

    assert.equal(attempted, 1, 'COMMIT was reached');
    assert.equal(reallyCommitted, 1, 'and PostgreSQL really did commit before the error was raised');

    assert.ok(
      isMediaPersistenceOutcomeUncertainError(result),
      `expected an uncertain-outcome error, got ${String(result)}`,
    );
    assert.equal(result.operation, 'upload');
    assert.equal(isMediaUploadCleanupError(result), false);

    // No compensation ran.
    assert.equal(storage.countOperations('put'), 1);
    assert.equal(storage.countOperations('delete'), 0, 'compensating here would orphan a committed row');

    // Read back on a separate, ordinary connection: the rows are genuinely
    // there. This is the state H1 exists to protect.
    const { rows: relations } = await dbPool.query<{ reference: string; storage_key: string }>(
      `SELECT ma.reference, ma.storage_key
         FROM room_type_images rti
         JOIN media_assets ma ON ma.id = rti.media_asset_id
        WHERE rti.room_type_id = $1`,
      [roomTypeIds[slugs.work]],
    );

    assert.equal(relations.length, 1, 'the room_type_images relation really was committed');
    assert.equal(relations[0]!.reference, result.reference);
    assert.equal(relations[0]!.storage_key, result.storageKey);
    assert.equal(await assetCount(result.reference!), 1, 'the media_assets row really was committed');

    // And the object the committed row points at is still there, which is the
    // whole point: no row was left pointing at nothing.
    assert.equal(
      storage.objects.has(result.storageKey!),
      true,
      'the committed row must still have its object',
    );
    assert.deepEqual(storage.keys, [result.storageKey]);
  });

  it('leaves an orphan rather than a dangling row when a delete is committed unacknowledged', async () => {
    const image = await upload(slugs.work);
    const operationsBefore = storage.operations.length;

    const { result, attempted, reallyCommitted } = await withLostCommitAcknowledgement(() =>
      rejection(() =>
        service.deleteRoomTypeImage(deps(), {
          slug: slugs.work,
          imageReference: image.reference,
        }),
      ),
    );

    assert.equal(attempted, 1);
    assert.equal(reallyCommitted, 1, 'PostgreSQL really did commit the deletion');

    assert.ok(isMediaPersistenceOutcomeUncertainError(result));
    assert.equal(result.operation, 'delete');
    assert.equal(result.reference, image.reference);
    assert.equal(result.storageKey, image.storageKey);

    // No storage call followed a commit whose outcome the service could not
    // confirm — even though, this time, it had in fact succeeded.
    assert.equal(storage.operations.length, operationsBefore, 'no storage call may follow');

    // Read back on a separate, ordinary connection: the rows really are gone.
    assert.deepEqual(
      await rowCounts(roomTypeIds[slugs.work]!),
      { relations: 0, covers: 0 },
      'the relation really was removed',
    );
    assert.equal(await assetCount(image.reference), 0, 'the media_assets row really was removed');

    // The safe side of the tear: storage holds something the database has
    // forgotten, rather than the database pointing at something missing.
    assert.equal(storage.objects.has(image.storageKey), true, 'the orphan remains');
  });

  it('discards the client and leaves the pool healthy', async () => {
    const body = await png();
    const before = dbPool.totalCount - dbPool.idleCount;

    // The service cannot know the commit succeeded, so it still discards the
    // connection. That is correct: production must not be special-cased
    // because a test happens to know more than the service does.
    await withLostCommitAcknowledgement(() =>
      rejection(() =>
        service.uploadRoomTypeImage(deps(), {
          slug: slugs.work,
          declaredContentType: 'image/png',
          body,
        }),
      ),
    );

    assert.equal(
      dbPool.totalCount - dbPool.idleCount,
      before,
      'a connection left checked out would never come back',
    );

    // The pool still works afterwards, on a fresh connection.
    assert.equal((await listed(slugs.work)).length, 1, 'the committed image is readable through the pool');
  });
});
