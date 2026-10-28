import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Request, Response } from 'express';
import sharp from 'sharp';

// A journey's one image, without a database and without R2.
//
// The load-bearing parts of this feature are orderings, not values: which
// system is written first, which statement runs before which, and — above
// all — when an object may and may not be removed. So the fake client below
// records every statement in order and models the two RESTRICT foreign keys
// `package_media` really has, and the fake storage records every call. A
// test that asserted only the outcome would pass for the wrong reason the
// first time an ordering slipped.
//
// The real Sharp pipeline runs. The images are tiny, built here rather than
// checked in, and normalizing them is fast — mocking the decoder would mean
// the upload path was never actually exercised end to end.

type ServiceModule = typeof import('../src/modules/admin-package-media/admin-package-media.service.js');
type ControllerModule = typeof import('../src/modules/admin-package-media/admin-package-media.controller.js');
type RoutesModule = typeof import('../src/modules/admin-package-media/admin-package-media.routes.js');

let __setClientFactoryForTests: ServiceModule['__setClientFactoryForTests'];
let createUploadPackageImageHandler: ControllerModule['createUploadPackageImageHandler'];
let createReplacePackageImageHandler: ControllerModule['createReplacePackageImageHandler'];
let createDeletePackageImageHandler: ControllerModule['createDeletePackageImageHandler'];
let updatePackageImageAltTextHandler: ControllerModule['updatePackageImageAltTextHandler'];
let createAdminPackageMediaUploadRouter: RoutesModule['createAdminPackageMediaUploadRouter'];
let createAdminPackageMediaRouter: RoutesModule['createAdminPackageMediaRouter'];

const SLUG = 'admin-made-journey';
const PACKAGE_ID = '42';
const OLD_ASSET_ID = '900';
const OLD_KEY = 'media/11111111-2222-4333-8444-555555555555.webp';
const OLD_REFERENCE = '11111111-2222-4333-8444-555555555555';

let jpegBody: Buffer;

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';

  ({ __setClientFactoryForTests } = await import(
    '../src/modules/admin-package-media/admin-package-media.service.js'
  ));
  ({
    createUploadPackageImageHandler,
    createReplacePackageImageHandler,
    createDeletePackageImageHandler,
    updatePackageImageAltTextHandler,
  } = await import('../src/modules/admin-package-media/admin-package-media.controller.js'));
  ({ createAdminPackageMediaUploadRouter, createAdminPackageMediaRouter } = await import(
    '../src/modules/admin-package-media/admin-package-media.routes.js'
  ));

  jpegBody = await sharp({
    create: { width: 24, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .jpeg()
    .toBuffer();
});

afterEach(() => {
  __setClientFactoryForTests(null);
});

type Recorded = { text: string; values: unknown[] | undefined };

/** A foreign key violation shaped the way `pg` reports one. */
function foreignKeyViolation(constraint: string): Error {
  return Object.assign(new Error('violates foreign key constraint'), {
    code: '23503',
    constraint,
  });
}

/** A unique violation shaped the way `pg` reports one. */
function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
}

/**
 * One journey, its optional image, and the two RESTRICT keys modelled.
 *
 * `assets` is the shared `media_assets` table: a replacement inserts into it
 * before repointing the relation, and deletes the displaced row afterwards,
 * so a test that got that order wrong trips the same violation PostgreSQL
 * would raise.
 */
function storedJourney(
  options: {
    packageExists?: boolean;
    image?: { assetId: string; storageKey: string; reference: string; altText: string | null } | null;
    failOn?: (text: string) => Error | null;
    failCommit?: boolean;
    seedManaged?: boolean;
  } = {},
) {
  const image = options.image ?? null;

  const state = {
    packageExists: options.packageExists ?? true,
    relation: image
      ? { assetId: image.assetId, altText: image.altText }
      : (null as { assetId: string; altText: string | null } | null),
    assets: new Map<string, { reference: string; storageKey: string; width: number; height: number }>(
      image ? [[image.assetId, { reference: image.reference, storageKey: image.storageKey, width: 100, height: 80 }]] : [],
    ),
    seedManaged: options.seedManaged ?? true,
    nextAssetId: 1000,
    released: false,
    discarded: false,
    calls: [] as Recorded[],
  };

  __setClientFactoryForTests(async () => ({
    async query(text: string, values?: unknown[]) {
      state.calls.push({ text, values });

      const injected = options.failOn?.(text);

      if (injected) {
        throw injected;
      }

      if (text.startsWith('BEGIN') || text.startsWith('ROLLBACK')) {
        return { rows: [] } as never;
      }

      if (text.startsWith('COMMIT')) {
        if (options.failCommit) {
          throw new Error('commit failed');
        }
        return { rows: [] } as never;
      }

      if (text.includes('FROM packages WHERE slug')) {
        return { rows: state.packageExists ? [{ id: PACKAGE_ID }] : [] } as never;
      }

      // The read-back of the asset row just inserted (MySQL has no RETURNING).
      if (text.includes('FROM media_assets ma WHERE ma.id')) {
        const id = String((values as string[])[0]);
        const asset = state.assets.get(id)!;

        return {
          rows: [
            {
              id,
              reference: asset.reference,
              storage_key: asset.storageKey,
              content_type: 'image/webp',
              byte_size: '1000',
              checksum_sha256: 'a'.repeat(64),
              width: asset.width,
              height: asset.height,
              created_at: new Date('2026-01-01T00:00:00.000Z'),
            },
          ],
        } as never;
      }

      // The under-the-lock read of the current relation.
      if (text.includes('pm.media_asset_id') && text.includes('ma.storage_key')) {
        if (!state.relation) {
          return { rows: [] } as never;
        }

        const asset = state.assets.get(state.relation.assetId)!;

        return {
          rows: [
            {
              media_asset_id: state.relation.assetId,
              reference: asset.reference,
              storage_key: asset.storageKey,
              alt_text: state.relation.altText,
            },
          ],
        } as never;
      }

      // The admin-facing read-back.
      if (text.includes('ma.reference') && text.includes('ma.width')) {
        if (!state.relation) {
          return { rows: [] } as never;
        }

        const asset = state.assets.get(state.relation.assetId)!;

        return {
          rows: [
            {
              reference: asset.reference,
              alt_text: state.relation.altText,
              width: asset.width,
              height: asset.height,
            },
          ],
        } as never;
      }

      if (text.includes('INSERT INTO media_assets')) {
        const id = String(state.nextAssetId++);
        const [reference, storageKey, , , , width, height] =
          values as [string, string, string, number, string, number, number];

        state.assets.set(id, { reference, storageKey, width, height });

        return { rows: [], rowCount: 1, insertId: id } as never;
      }

      if (text.includes('INSERT INTO package_media')) {
        if (state.relation) {
          throw uniqueViolation('package_media_package_id_key');
        }
        const [, assetId] = values as [string, string];
        state.relation = { assetId, altText: null };
        return { rows: [] } as never;
      }

      if (text.includes('UPDATE package_media') && text.includes('alt_text')) {
        const [, altText] = values as [string, string | null];

        if (!state.relation) {
          return { rowCount: 0, rows: [] } as never;
        }

        state.relation = { assetId: state.relation.assetId, altText };
        return { rowCount: 1, rows: [] } as never;
      }

      if (text.includes('UPDATE package_media')) {
        const [, assetId] = values as [string, string];

        if (!state.assets.has(assetId)) {
          // The FK is checked immediately: repointing at an asset that does
          // not exist yet is refused, which is what pins the INSERT-first
          // ordering.
          throw foreignKeyViolation('package_media_media_asset_id_fkey');
        }

        state.relation = { assetId, altText: state.relation?.altText ?? null };
        return { rowCount: 1, rows: [] } as never;
      }

      if (text.includes('DELETE FROM package_media')) {
        const had = state.relation !== null;
        state.relation = null;
        return { rowCount: had ? 1 : 0, rows: [] } as never;
      }

      if (text.includes('DELETE FROM media_assets')) {
        const [assetId] = values as [string];

        // RESTRICT from the relation: the asset cannot go while something
        // still points at it.
        if (state.relation?.assetId === assetId) {
          throw foreignKeyViolation('package_media_media_asset_id_fkey');
        }

        state.assets.delete(assetId);
        return { rowCount: 1, rows: [] } as never;
      }

      return { rows: [] } as never;
    },
    release(discard?: boolean) {
      state.released = true;
      state.discarded = discard === true;
    },
  }) as never);

  return state;
}

/** A `MediaStorage` that records, and can be told to fail either operation. */
function recordingStorage(options: { failPut?: boolean; failDelete?: string | true } = {}) {
  const puts: string[] = [];
  const deletes: string[] = [];

  const storage = {
    async putObject(input: { key: string }) {
      puts.push(input.key);
      if (options.failPut) {
        throw new Error('R2 unavailable');
      }
    },
    async deleteObject(key: string) {
      deletes.push(key);
      if (options.failDelete === true || options.failDelete === key) {
        throw new Error('R2 unavailable');
      }
    },
  };

  return { puts, deletes, provider: (() => storage) as never };
}

type Captured = { status: number | undefined; body: unknown; ended: boolean };

function fakeResponse(): { res: Response; captured: Captured } {
  const captured: Captured = { status: undefined, body: undefined, ended: false };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
    end() {
      captured.ended = true;
      return this;
    },
  } as unknown as Response;

  return { res, captured };
}

function binaryRequest(
  slug: string,
  body: unknown,
  contentType: string | null = 'image/jpeg',
): Request<{ slug: string }> {
  return {
    params: { slug },
    // `null` means the request declared no Content-Type at all, which is its
    // own rejection reason. `undefined` would have fallen through to the
    // default above and tested nothing.
    headers: contentType === null ? {} : { 'content-type': contentType },
    body,
  } as unknown as Request<{ slug: string }>;
}

async function post(
  slug: string,
  provider: never,
  body: unknown = jpegBody,
  contentType?: string | null,
): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await createUploadPackageImageHandler(provider)(binaryRequest(slug, body, contentType), res);
  return captured;
}

async function put(
  slug: string,
  provider: never,
  body: unknown = jpegBody,
  contentType?: string | null,
): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await createReplacePackageImageHandler(provider)(binaryRequest(slug, body, contentType), res);
  return captured;
}

async function remove(slug: string, provider: never): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await createDeletePackageImageHandler(provider)(
    { params: { slug }, headers: {} } as unknown as Request<{ slug: string }>,
    res,
  );
  return captured;
}

const withImage = {
  assetId: OLD_ASSET_ID,
  storageKey: OLD_KEY,
  reference: OLD_REFERENCE,
  altText: 'Dawn over the plateau' as string | null,
};

/** The order the statements ran in, as coarse labels. */
function shape(calls: Recorded[]): string[] {
  return calls.map((call) => {
    if (call.text.startsWith('BEGIN')) return 'BEGIN';
    if (call.text.startsWith('COMMIT')) return 'COMMIT';
    if (call.text.startsWith('ROLLBACK')) return 'ROLLBACK';
    if (call.text.includes('FROM packages WHERE slug')) return 'LOCK';
    if (call.text.includes('FROM media_assets ma WHERE ma.id')) return 'READ-ASSET';
    if (call.text.includes('ma.storage_key')) return 'READ-IMAGE';
    if (call.text.includes('INSERT INTO media_assets')) return 'INSERT-ASSET';
    if (call.text.includes('INSERT INTO package_media')) return 'INSERT-RELATION';
    if (call.text.includes('UPDATE package_media')) {
      return call.text.includes('alt_text') ? 'ALT-TEXT' : 'REPOINT';
    }
    if (call.text.includes('DELETE FROM package_media')) return 'DELETE-RELATION';
    if (call.text.includes('DELETE FROM media_assets')) return 'DELETE-ASSET';
    if (call.text.includes('ma.width')) return 'READ-BACK';
    return 'OTHER';
  });
}

// ---------------------------------------------------------------------------
// Routing and validation
// ---------------------------------------------------------------------------

describe('journey media routes', () => {
  type Layer = { route?: { path: string; stack: { name: string }[]; methods: Record<string, boolean> } };

  const routesOf = (router: { stack: Layer[] }) =>
    router.stack
      .filter((layer): layer is Required<Layer> => layer.route !== undefined)
      .map((layer) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
        chain: layer.route.stack.map((entry) => entry.name),
      }));

  it('guards the two binary routes, in the fixed order', () => {
    const routes = routesOf(createAdminPackageMediaUploadRouter(recordingStorage().provider) as never);

    assert.deepEqual(
      routes.map((route) => `${route.method} ${route.path}`),
      ['post /:slug/image', 'put /:slug/image'],
    );

    for (const route of routes) {
      // requireAdminSession first, then the raw parser, then the handler. An
      // unauthenticated caller must not be able to make Express touch the
      // body at all.
      assert.equal(route.chain.length, 3, `${route.method} has three steps`);
      assert.equal(route.chain[0], 'requireAdminSession');
      assert.match(String(route.chain[2]), /PackageImageHandler$/);
    }
  });

  it('guards the two routes that need no raw parser', () => {
    const routes = routesOf(createAdminPackageMediaRouter(recordingStorage().provider) as never);

    assert.deepEqual(
      routes.map((route) => `${route.method} ${route.path}`),
      ['patch /:slug/image/alt-text', 'delete /:slug/image'],
    );

    for (const route of routes) {
      assert.equal(route.chain.length, 2, `${route.method}: guard and handler, nothing between`);
      assert.equal(route.chain[0], 'requireAdminSession');
    }
  });

  it('mounts the binary routes before express.json, and the delete after', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync('src/app.ts', 'utf8');

    const uploadMount = app.indexOf('createAdminPackageMediaUploadRouter(mediaStorageProvider)');
    const jsonMount = app.indexOf('app.use(express.json());');
    const deleteMount = app.indexOf('createAdminPackageMediaRouter(mediaStorageProvider)');

    assert.ok(uploadMount > 0 && jsonMount > 0 && deleteMount > 0, 'all three are mounted');
    assert.ok(uploadMount < jsonMount, 'raw bytes are read before the JSON parser can see them');
    assert.ok(deleteMount > jsonMount, 'the bodyless route sits with every other admin route');
  });

  it('refuses a malformed slug the way every other admin package route does', async () => {
    const storage = recordingStorage();

    for (const handler of [post, put]) {
      const captured = await handler('Not A Slug', storage.provider);

      assert.equal(captured.status, 400);
      assert.match(JSON.stringify(captured.body), /INVALID_/);
    }

    const deleted = await remove('Not A Slug', storage.provider);
    assert.equal(deleted.status, 400);

    assert.deepEqual(storage.puts, [], 'a malformed address writes nothing');
    assert.deepEqual(storage.deletes, []);
  });
});

describe('journey media: what the bytes must be', () => {
  it('refuses a body past the 8 MiB ceiling', async () => {
    const { MAX_SOURCE_BYTES } = await import('../src/modules/media/media.types.js');
    storedJourney();
    const storage = recordingStorage();

    // One byte past the domain rule. In a real request the raw parser stops
    // this first; the service must refuse it too, so the two can never
    // disagree about where the ceiling is.
    const oversized = Buffer.alloc(MAX_SOURCE_BYTES + 1, 0xff);
    oversized.set([0xff, 0xd8, 0xff], 0);

    const captured = await post(SLUG, storage.provider, oversized);

    assert.equal(captured.status, 413);
    assert.match(JSON.stringify(captured.body), /IMAGE_TOO_LARGE/);
    assert.deepEqual(storage.puts, [], 'nothing reaches storage');
  });

  it('refuses a type this API does not take', async () => {
    storedJourney();
    const storage = recordingStorage();

    for (const declared of ['image/gif', 'image/svg+xml', 'application/json']) {
      const captured = await post(SLUG, storage.provider, jpegBody, declared);

      assert.equal(captured.status, 415, declared);
      assert.match(JSON.stringify(captured.body), /UNSUPPORTED_IMAGE_TYPE/);
    }

    const missing = await post(SLUG, storage.provider, jpegBody, null);
    assert.equal(missing.status, 415, 'no declaration at all is also refused');

    assert.deepEqual(storage.puts, []);
  });

  it('refuses bytes that disagree with the declared type', async () => {
    storedJourney();
    const storage = recordingStorage();

    // Real JPEG bytes, declared as PNG. Both are accepted types, so this is
    // caught by the declared-versus-sniffed rule rather than by the type list.
    const captured = await post(SLUG, storage.provider, jpegBody, 'image/png');

    assert.equal(captured.status, 400);
    assert.match(JSON.stringify(captured.body), /INVALID_IMAGE_UPLOAD/);
    assert.deepEqual(storage.puts, []);
  });

  it('refuses an empty body and a non-buffer body', async () => {
    storedJourney();
    const storage = recordingStorage();

    assert.equal((await post(SLUG, storage.provider, Buffer.alloc(0))).status, 400);
    assert.equal((await post(SLUG, storage.provider, { not: 'a buffer' })).status, 400);
    assert.deepEqual(storage.puts, []);
  });

  it('applies the same rules to a replacement', async () => {
    storedJourney({ image: { ...withImage } });
    const storage = recordingStorage();

    assert.equal((await put(SLUG, storage.provider, jpegBody, 'image/gif')).status, 415);
    assert.equal((await put(SLUG, storage.provider, jpegBody, 'image/png')).status, 400);
    assert.deepEqual(storage.puts, [], 'the existing image is never at risk from a bad request');
  });
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe('journey media: adding the first image', () => {
  it('stores the object, then the rows, and answers 201', async () => {
    const stored = storedJourney();
    const storage = recordingStorage();

    const captured = await post(SLUG, storage.provider);

    assert.equal(captured.status, 201);
    assert.deepEqual(shape(stored.calls), [
      'BEGIN',
      'LOCK',
      'READ-IMAGE',
      'INSERT-ASSET',
      'READ-ASSET',
      'INSERT-RELATION',
      'READ-BACK',
      'COMMIT',
    ]);
    assert.equal(storage.puts.length, 1, 'one object written');
    assert.deepEqual(storage.deletes, [], 'and nothing removed');
    assert.match(storage.puts[0]!, /^media\/[0-9a-f-]{36}\.webp$/, 'the shared key format, unchanged');
  });

  it('writes the object before the transaction opens', async () => {
    const stored = storedJourney();
    const storage = recordingStorage();
    let putBeforeBegin: boolean | null = null;

    const recorded = stored.calls;
    const push = recorded.push.bind(recorded);
    recorded.push = ((call: Recorded) => {
      if (call.text.startsWith('BEGIN') && putBeforeBegin === null) {
        putBeforeBegin = storage.puts.length === 1;
      }
      return push(call);
    }) as typeof recorded.push;

    await post(SLUG, storage.provider);

    assert.equal(putBeforeBegin, true, 'no row lock is held across the network call');
  });

  it('refuses a journey that already has one, and takes its object back', async () => {
    const stored = storedJourney({ image: { ...withImage } });
    const storage = recordingStorage();

    const captured = await post(SLUG, storage.provider);

    assert.equal(captured.status, 409);
    assert.match(JSON.stringify(captured.body), /JOURNEY_IMAGE_EXISTS/);
    assert.equal(storage.puts.length, 1, 'the new object was written before the lock was taken');
    assert.deepEqual(storage.deletes, storage.puts, 'and removed again, exactly once');
    assert.deepEqual(shape(stored.calls), ['BEGIN', 'LOCK', 'READ-IMAGE', 'ROLLBACK']);
    assert.ok(!storage.deletes.includes(OLD_KEY), 'the existing object is never touched');
  });

  it('compensates once when the journey disappeared after the object was written', async () => {
    const stored = storedJourney({ packageExists: false });
    const storage = recordingStorage();

    const captured = await post(SLUG, storage.provider);

    assert.equal(captured.status, 404);
    assert.match(JSON.stringify(captured.body), /PACKAGE_NOT_FOUND/);
    assert.equal(storage.puts.length, 1);
    assert.deepEqual(storage.deletes, storage.puts, 'exactly one attempt');
    assert.deepEqual(shape(stored.calls), ['BEGIN', 'LOCK', 'ROLLBACK']);
  });

  it('compensates once when a statement fails before COMMIT', async () => {
    const storage = recordingStorage();
    const stored = storedJourney({
      failOn: (text) => (text.includes('INSERT INTO package_media') ? new Error('deadlock detected') : null),
    });

    const { res } = fakeResponse();
    await assert.rejects(
      createUploadPackageImageHandler(storage.provider)(binaryRequest(SLUG, jpegBody), res),
      /deadlock detected/,
    );

    assert.ok(shape(stored.calls).includes('ROLLBACK'));
    assert.ok(!shape(stored.calls).includes('COMMIT'));
    assert.deepEqual(storage.deletes, storage.puts, 'the orphan is taken back, once');
  });

  it('names the orphan when compensation itself fails', async () => {
    const storage = recordingStorage({ failDelete: true });
    storedJourney({
      failOn: (text) => (text.includes('INSERT INTO package_media') ? new Error('deadlock detected') : null),
    });

    const { res, captured } = fakeResponse();
    await createUploadPackageImageHandler(storage.provider)(binaryRequest(SLUG, jpegBody), res).catch(
      () => undefined,
    );

    // The handler maps MediaUploadCleanupError onto the generic 500; the
    // original failure travels as its cause and the key stays server-side.
    assert.equal(captured.status, 500);
    assert.match(JSON.stringify(captured.body), /MEDIA_OPERATION_FAILED/);
    assert.equal(storage.deletes.length, 1, 'one attempt, never retried');
    assert.ok(!JSON.stringify(captured.body).includes('media/'), 'the key is not in the response');
  });

  it('keeps the object when COMMIT does not answer', async () => {
    const stored = storedJourney({ failCommit: true });
    const storage = recordingStorage();

    const captured = await post(SLUG, storage.provider);

    // The row may exist, and if it does it owns this object. Deleting it here
    // would leave a committed row pointing at nothing.
    assert.equal(captured.status, 503);
    assert.match(JSON.stringify(captured.body), /MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN/);
    assert.deepEqual(storage.deletes, [], 'an unanswered COMMIT removes nothing');
    assert.equal(stored.discarded, true, 'the connection is poisoned rather than reused');
    assert.ok(!shape(stored.calls).slice(shape(stored.calls).indexOf('COMMIT') + 1).includes('ROLLBACK'));
  });

  it('answers 503 when storage itself refuses the write', async () => {
    const stored = storedJourney();
    const storage = recordingStorage({ failPut: true });

    const captured = await post(SLUG, storage.provider);

    assert.equal(captured.status, 503);
    assert.match(JSON.stringify(captured.body), /MEDIA_STORAGE_UNAVAILABLE/);
    assert.deepEqual(stored.calls, [], 'no transaction is ever opened');
  });

  it('never reads or writes seed_managed', async () => {
    const stored = storedJourney();

    await post(SLUG, recordingStorage().provider);

    for (const call of stored.calls) {
      assert.ok(!/seed_managed/.test(call.text), 'media ownership is not catalogue ownership');
    }
    assert.ok(!stored.calls.some((call) => /UPDATE packages/.test(call.text)));
  });
});

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

describe('journey media: replacing the image', () => {
  it('swaps the relation in one transaction and answers 200', async () => {
    const stored = storedJourney({ image: { ...withImage } });
    const storage = recordingStorage();

    const captured = await put(SLUG, storage.provider);

    assert.equal(captured.status, 200);
    assert.deepEqual(shape(stored.calls), [
      'BEGIN',
      'LOCK',
      'READ-IMAGE',
      'INSERT-ASSET',
      'READ-ASSET',
      'REPOINT',
      'DELETE-ASSET',
      'READ-BACK',
      'COMMIT',
    ]);
  });

  it('inserts the new asset before repointing the relation', async () => {
    // The foreign key is checked immediately. The fake refuses a repoint at
    // an asset that does not exist yet, exactly as PostgreSQL would, so this
    // ordering is pinned by behaviour and not only by a label.
    const stored = storedJourney({ image: { ...withImage } });

    await put(SLUG, recordingStorage().provider);

    const order = shape(stored.calls);
    assert.ok(order.indexOf('INSERT-ASSET') < order.indexOf('REPOINT'));
  });

  it('deletes the old asset only after the relation points at the new one', async () => {
    // RESTRICT in the other direction: the fake refuses deleting an asset the
    // relation still references.
    const stored = storedJourney({ image: { ...withImage } });

    await put(SLUG, recordingStorage().provider);

    const order = shape(stored.calls);
    assert.ok(order.indexOf('REPOINT') < order.indexOf('DELETE-ASSET'));

    const assetDelete = stored.calls.find((call) => call.text.includes('DELETE FROM media_assets'))!;
    assert.deepEqual(assetDelete.values, [OLD_ASSET_ID], 'the displaced asset, by id');
  });

  it('removes the old object only after COMMIT, and only that one', async () => {
    const stored = storedJourney({ image: { ...withImage } });
    const storage = recordingStorage();
    let deletedBeforeCommit: boolean | null = null;

    const recorded = stored.calls;
    const push = recorded.push.bind(recorded);
    recorded.push = ((call: Recorded) => {
      if (call.text.startsWith('COMMIT') && deletedBeforeCommit === null) {
        deletedBeforeCommit = storage.deletes.length > 0;
      }
      return push(call);
    }) as typeof recorded.push;

    await put(SLUG, storage.provider);

    assert.equal(deletedBeforeCommit, false, 'the old object survives the whole transaction');
    assert.deepEqual(storage.deletes, [OLD_KEY], 'and only the displaced one is removed');
    assert.equal(storage.puts.length, 1);
    assert.ok(!storage.deletes.includes(storage.puts[0]!), 'the new object stays');
  });

  it('preserves the alt text somebody wrote for the old picture', async () => {
    const stored = storedJourney({ image: { ...withImage, altText: 'Dawn over the plateau' } });

    const captured = await put(SLUG, recordingStorage().provider);

    assert.equal(captured.status, 200);
    assert.match(JSON.stringify(captured.body), /Dawn over the plateau/);

    const repoint = stored.calls.find((call) => call.text.includes('UPDATE package_media'))!;
    assert.ok(!/alt_text/.test(repoint.text), 'alt_text is not in the SET list at all');
  });

  it('refuses a journey with no image, and takes the new object back', async () => {
    const stored = storedJourney({ image: null });
    const storage = recordingStorage();

    const captured = await put(SLUG, storage.provider);

    assert.equal(captured.status, 404);
    assert.match(JSON.stringify(captured.body), /JOURNEY_IMAGE_NOT_FOUND/);
    assert.deepEqual(storage.deletes, storage.puts, 'compensated exactly once');
    assert.deepEqual(shape(stored.calls), ['BEGIN', 'LOCK', 'READ-IMAGE', 'ROLLBACK']);
  });

  it('refuses a journey that is gone, and takes the new object back', async () => {
    storedJourney({ packageExists: false });
    const storage = recordingStorage();

    const captured = await put(SLUG, storage.provider);

    assert.equal(captured.status, 404);
    assert.match(JSON.stringify(captured.body), /PACKAGE_NOT_FOUND/);
    assert.deepEqual(storage.deletes, storage.puts);
  });

  it('leaves everything alone when the new object cannot be written', async () => {
    const stored = storedJourney({ image: { ...withImage } });
    const storage = recordingStorage({ failPut: true });

    const captured = await put(SLUG, storage.provider);

    assert.equal(captured.status, 503);
    assert.deepEqual(stored.calls, [], 'no transaction is opened');
    assert.deepEqual(storage.deletes, [], 'and the old object is never touched');
    assert.equal(stored.relation?.assetId, OLD_ASSET_ID, 'the journey still shows what it showed');
  });

  it('keeps the old image intact when a statement fails before COMMIT', async () => {
    const storage = recordingStorage();
    const stored = storedJourney({
      image: { ...withImage },
      failOn: (text) => (text.includes('UPDATE package_media') ? new Error('deadlock detected') : null),
    });

    const { res } = fakeResponse();
    await assert.rejects(
      createReplacePackageImageHandler(storage.provider)(binaryRequest(SLUG, jpegBody), res),
      /deadlock detected/,
    );

    assert.ok(shape(stored.calls).includes('ROLLBACK'));
    assert.deepEqual(storage.deletes, storage.puts, 'only the new object is taken back');
    assert.ok(!storage.deletes.includes(OLD_KEY), 'the old object is never touched');
  });

  it('deletes neither object when COMMIT does not answer', async () => {
    const stored = storedJourney({ image: { ...withImage }, failCommit: true });
    const storage = recordingStorage();

    const captured = await put(SLUG, storage.provider);

    // In one reality the new object is live; in the other the old one still
    // is. Removing either would break the page in one of them.
    assert.equal(captured.status, 503);
    assert.match(JSON.stringify(captured.body), /MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN/);
    assert.deepEqual(storage.deletes, [], 'neither old nor new is removed');
    assert.equal(stored.discarded, true);
  });

  it('still succeeds when the displaced object cannot be removed', async () => {
    const storage = recordingStorage({ failDelete: OLD_KEY });
    storedJourney({ image: { ...withImage } });

    const captured = await put(SLUG, storage.provider);

    assert.equal(captured.status, 200, 'an orphan does not undo a committed replacement');
    assert.equal(storage.deletes.length, 1, 'exactly one attempt, never retried');
  });

  it('never reads or writes seed_managed', async () => {
    const stored = storedJourney({ image: { ...withImage } });

    await put(SLUG, recordingStorage().provider);

    for (const call of stored.calls) {
      assert.ok(!/seed_managed/.test(call.text));
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe('journey media: removing the image', () => {
  it('removes the rows, then the object, and answers 204', async () => {
    const stored = storedJourney({ image: { ...withImage } });
    const storage = recordingStorage();

    const captured = await remove(SLUG, storage.provider);

    assert.equal(captured.status, 204);
    assert.equal(captured.ended, true);
    assert.equal(captured.body, undefined, 'no body at all');
    assert.deepEqual(shape(stored.calls), [
      'BEGIN',
      'LOCK',
      'READ-IMAGE',
      'DELETE-RELATION',
      'DELETE-ASSET',
      'COMMIT',
    ]);
    assert.deepEqual(storage.deletes, [OLD_KEY]);
  });

  it('removes the object only after COMMIT', async () => {
    const stored = storedJourney({ image: { ...withImage } });
    const storage = recordingStorage();
    let deletedBeforeCommit: boolean | null = null;

    const recorded = stored.calls;
    const push = recorded.push.bind(recorded);
    recorded.push = ((call: Recorded) => {
      if (call.text.startsWith('COMMIT') && deletedBeforeCommit === null) {
        deletedBeforeCommit = storage.deletes.length > 0;
      }
      return push(call);
    }) as typeof recorded.push;

    await remove(SLUG, storage.provider);

    assert.equal(deletedBeforeCommit, false);
  });

  it('answers 404 when the journey has no image', async () => {
    const stored = storedJourney({ image: null });
    const storage = recordingStorage();

    const captured = await remove(SLUG, storage.provider);

    assert.equal(captured.status, 404);
    assert.match(JSON.stringify(captured.body), /JOURNEY_IMAGE_NOT_FOUND/);
    assert.deepEqual(storage.deletes, [], 'nothing committed, nothing removed');
    assert.deepEqual(shape(stored.calls), ['BEGIN', 'LOCK', 'READ-IMAGE', 'ROLLBACK']);
  });

  it('answers 404 when the journey does not exist', async () => {
    storedJourney({ packageExists: false });
    const storage = recordingStorage();

    const captured = await remove(SLUG, storage.provider);

    assert.equal(captured.status, 404);
    assert.match(JSON.stringify(captured.body), /PACKAGE_NOT_FOUND/);
    assert.deepEqual(storage.deletes, []);
  });

  it('makes no storage call when a statement fails before COMMIT', async () => {
    const storage = recordingStorage();
    const stored = storedJourney({
      image: { ...withImage },
      failOn: (text) => (text.includes('DELETE FROM media_assets') ? new Error('deadlock detected') : null),
    });

    const { res } = fakeResponse();
    await assert.rejects(
      createDeletePackageImageHandler(storage.provider)(
        { params: { slug: SLUG }, headers: {} } as unknown as Request<{ slug: string }>,
        res,
      ),
      /deadlock detected/,
    );

    assert.ok(shape(stored.calls).includes('ROLLBACK'));
    assert.deepEqual(storage.deletes, [], 'the row still exists, so the object must too');
  });

  it('still succeeds when the object cannot be removed', async () => {
    const storage = recordingStorage({ failDelete: true });
    storedJourney({ image: { ...withImage } });

    const captured = await remove(SLUG, storage.provider);

    assert.equal(captured.status, 204);
    assert.equal(storage.deletes.length, 1, 'one attempt, never retried');
  });

  it('makes no storage call when COMMIT does not answer', async () => {
    const stored = storedJourney({ image: { ...withImage }, failCommit: true });
    const storage = recordingStorage();

    const captured = await remove(SLUG, storage.provider);

    assert.equal(captured.status, 503);
    assert.match(JSON.stringify(captured.body), /MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN/);
    assert.deepEqual(storage.deletes, []);
    assert.equal(stored.discarded, true);
  });

  it('never reads or writes seed_managed', async () => {
    const stored = storedJourney({ image: { ...withImage } });

    await remove(SLUG, recordingStorage().provider);

    for (const call of stored.calls) {
      assert.ok(!/seed_managed/.test(call.text));
    }
  });
});

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

describe('journey media: the package row is the only lock', () => {
  it('locks packages FOR UPDATE first, on every operation', async () => {
    const cases: Array<[string, () => Promise<unknown>, ReturnType<typeof storedJourney>]> = [];

    const uploadState = storedJourney();
    cases.push(['POST', () => post(SLUG, recordingStorage().provider), uploadState]);
    await cases[0]![1]();

    const replaceState = storedJourney({ image: { ...withImage } });
    await put(SLUG, recordingStorage().provider);

    const deleteState = storedJourney({ image: { ...withImage } });
    await remove(SLUG, recordingStorage().provider);

    for (const [label, state] of [
      ['POST', uploadState],
      ['PUT', replaceState],
      ['DELETE', deleteState],
    ] as const) {
      const order = shape(state.calls);

      assert.equal(order[0], 'BEGIN', `${label}: the transaction opens first`);
      assert.equal(order[1], 'LOCK', `${label}: and the package row is locked immediately`);
      assert.equal(order[2], 'READ-IMAGE', `${label}: the relation is read under that lock`);

      const locks = state.calls.filter((call) => /FOR UPDATE|FOR SHARE/.test(call.text));
      assert.equal(locks.length, 1, `${label}: one lock, and no second ordering system`);
      assert.match(locks[0]!.text, /FROM packages WHERE slug = BINARY \$1 FOR UPDATE/);
    }
  });
});

// ---------------------------------------------------------------------------
// Confidentiality
// ---------------------------------------------------------------------------

describe('journey media: what a response may carry', () => {
  it('returns only the reference, alt text and dimensions', async () => {
    storedJourney();
    const captured = await post(SLUG, recordingStorage().provider);

    assert.deepEqual(Object.keys((captured.body as { data: object }).data).sort(), [
      'altText',
      'height',
      'reference',
      'width',
    ]);
  });

  it('never exposes a storage key, a checksum, a bucket or an internal id', async () => {
    const bodies: unknown[] = [];

    storedJourney();
    bodies.push((await post(SLUG, recordingStorage().provider)).body);

    storedJourney({ image: { ...withImage } });
    bodies.push((await put(SLUG, recordingStorage().provider)).body);

    storedJourney({ image: { ...withImage } });
    bodies.push((await remove(SLUG, recordingStorage().provider)).body);

    storedJourney({ image: { ...withImage } });
    bodies.push((await post(SLUG, recordingStorage().provider)).body);

    storedJourney({ failCommit: true });
    bodies.push((await post(SLUG, recordingStorage().provider)).body);

    for (const body of bodies) {
      const serialised = JSON.stringify(body ?? null);

      for (const forbidden of [
        'media/',
        'storageKey',
        'storage_key',
        'checksum',
        'bucket',
        'mediaAssetId',
        'media_asset_id',
        'contentType',
        'byteSize',
        'R2',
        OLD_ASSET_ID,
        OLD_KEY,
      ]) {
        assert.ok(!serialised.includes(forbidden), `${forbidden} must not reach the caller`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH alt-text
// ---------------------------------------------------------------------------
//
// The one journey media operation that touches no object. Most of what is
// asserted here is therefore absence: no provider resolved, no storage call,
// no `media_asset_id` written, no `media_assets` statement at all.

function altTextRequest(slug: string, body: unknown): Request<{ slug: string }> {
  return { params: { slug }, headers: {}, body } as unknown as Request<{ slug: string }>;
}

async function patch(slug: string, body: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await updatePackageImageAltTextHandler(altTextRequest(slug, body), res);
  return captured;
}

describe('journey media: describing the image', () => {
  it('stores a trimmed description and answers 200 with the safe shape', async () => {
    const stored = storedJourney({ image: { ...withImage, altText: null } });

    const captured = await patch(SLUG, { altText: '  Dawn over the plateau  ' });

    assert.equal(captured.status, 200);
    assert.deepEqual(Object.keys((captured.body as { data: object }).data).sort(), [
      'altText',
      'height',
      'reference',
      'width',
    ]);

    const update = stored.calls.find((call) => call.text.includes('UPDATE package_media'))!;
    // Trimmed by the shared rule, which this module does not restate.
    assert.deepEqual(update.values, [PACKAGE_ID, 'Dawn over the plateau']);
  });

  it('clears the description when the body says null', async () => {
    const stored = storedJourney({ image: { ...withImage, altText: 'Old words' } });

    const captured = await patch(SLUG, { altText: null });

    assert.equal(captured.status, 200);
    const update = stored.calls.find((call) => call.text.includes('UPDATE package_media'))!;
    assert.deepEqual(update.values, [PACKAGE_ID, null]);
  });

  it('treats empty and whitespace-only as clearing it, the way the shared rule does', async () => {
    for (const value of ['', '   ', '\n\t']) {
      const stored = storedJourney({ image: { ...withImage, altText: 'Old words' } });

      assert.equal((await patch(SLUG, { altText: value })).status, 200, JSON.stringify(value));

      const update = stored.calls.find((call) => call.text.includes('UPDATE package_media'))!;
      assert.deepEqual(update.values, [PACKAGE_ID, null], 'all three mean no description');
    }
  });

  it('accepts alt text of exactly the shared limit and refuses one past it', async () => {
    const { MAX_ALT_TEXT_LENGTH } = await import('../src/modules/media/media.types.js');

    const atLimit = storedJourney({ image: { ...withImage } });
    assert.equal((await patch(SLUG, { altText: 'x'.repeat(MAX_ALT_TEXT_LENGTH) })).status, 200);
    assert.ok(atLimit.calls.some((call) => call.text.includes('UPDATE package_media')));

    const overLimit = storedJourney({ image: { ...withImage } });
    const captured = await patch(SLUG, { altText: 'x'.repeat(MAX_ALT_TEXT_LENGTH + 1) });

    assert.equal(captured.status, 400);
    assert.match(JSON.stringify(captured.body), /INVALID_JOURNEY_IMAGE_UPDATE/);
    assert.deepEqual(overLimit.calls, [], 'refused before a lock is taken');
    // The ceiling is never quoted back: it lives in one place and a response
    // repeating it would be a second place it could drift from.
    assert.ok(!JSON.stringify(captured.body).includes(String(MAX_ALT_TEXT_LENGTH)));
  });

  it('refuses a body that is not the one field this route changes', async () => {
    for (const body of [
      undefined,
      null,
      'a string',
      42,
      [],
      ['altText'],
      {},
      { altText: 'ok', isCover: true },
      { description: 'ok' },
      new Date(),
      new Map(),
    ]) {
      const stored = storedJourney({ image: { ...withImage } });
      const captured = await patch(SLUG, body);

      assert.equal(captured.status, 400, JSON.stringify(body) ?? String(body));
      assert.match(JSON.stringify(captured.body), /INVALID_JOURNEY_IMAGE_UPDATE/);
      assert.deepEqual(stored.calls, [], 'a malformed body never opens a transaction');
    }
  });

  it('refuses a missing altText rather than reading it as null', async () => {
    // Omitting a field and asking to clear it are different requests, and
    // folding the first into the second would erase a description because a
    // key was missing from the body.
    const stored = storedJourney({ image: { ...withImage, altText: 'Keep me' } });

    assert.equal((await patch(SLUG, {})).status, 400);
    assert.deepEqual(stored.calls, []);
  });

  it('refuses a value that is not text', async () => {
    for (const altText of [42, true, [], {}, ['text']]) {
      const stored = storedJourney({ image: { ...withImage } });
      const captured = await patch(SLUG, { altText });

      assert.equal(captured.status, 400, JSON.stringify(altText));
      assert.match(JSON.stringify(captured.body), /INVALID_JOURNEY_IMAGE_UPDATE/);
      assert.deepEqual(stored.calls, [], 'the shape passed, the value did not, and neither locked');
    }
  });

  it('refuses a malformed slug the way every other admin package route does', async () => {
    const stored = storedJourney({ image: { ...withImage } });

    const captured = await patch('Not A Slug', { altText: 'text' });

    assert.equal(captured.status, 400);
    assert.match(JSON.stringify(captured.body), /INVALID_/);
    assert.deepEqual(stored.calls, []);
  });

  it('answers 404 for a journey nothing matches', async () => {
    const stored = storedJourney({ packageExists: false });

    const captured = await patch(SLUG, { altText: 'text' });

    assert.equal(captured.status, 404);
    assert.match(JSON.stringify(captured.body), /PACKAGE_NOT_FOUND/);
    assert.deepEqual(shape(stored.calls), ['BEGIN', 'LOCK', 'ROLLBACK']);
  });

  it('answers 404 when the journey has no image to describe', async () => {
    const stored = storedJourney({ image: null });

    const captured = await patch(SLUG, { altText: 'text' });

    assert.equal(captured.status, 404);
    assert.match(JSON.stringify(captured.body), /JOURNEY_IMAGE_NOT_FOUND/);
    assert.deepEqual(shape(stored.calls), ['BEGIN', 'LOCK', 'READ-IMAGE', 'ROLLBACK']);
  });

  it('locks the package row before reading or writing the relation', async () => {
    const stored = storedJourney({ image: { ...withImage } });

    await patch(SLUG, { altText: 'text' });

    assert.deepEqual(shape(stored.calls), [
      'BEGIN',
      'LOCK',
      'READ-IMAGE',
      'ALT-TEXT',
      'READ-BACK',
      'COMMIT',
    ]);

    const locks = stored.calls.filter((call) => /FOR UPDATE|FOR SHARE/.test(call.text));
    assert.equal(locks.length, 1, 'one lock, and no second ordering system');
    assert.match(locks[0]!.text, /FROM packages WHERE slug = BINARY \$1 FOR UPDATE/);
  });

  it('changes alt_text and updated_at, and nothing else', async () => {
    const stored = storedJourney({ image: { ...withImage } });

    await patch(SLUG, { altText: 'text' });

    const update = stored.calls.find((call) => call.text.includes('UPDATE package_media'))!;

    assert.match(update.text, /SET alt_text = \$2/);
    assert.match(update.text, /updated_at = UTC_TIMESTAMP\(3\)/);
    assert.ok(!/media_asset_id/.test(update.text), 'describing a picture cannot change which it is');

    // `media_assets` is immutable and is not touched at all.
    assert.ok(!stored.calls.some((call) => /(INSERT INTO|UPDATE|DELETE FROM) media_assets/.test(call.text)));
    assert.ok(!stored.calls.some((call) => /seed_managed/.test(call.text)));
    assert.ok(!stored.calls.some((call) => /UPDATE packages/.test(call.text)));
  });

  it('leaves the reference and the dimensions exactly as they were', async () => {
    const stored = storedJourney({ image: { ...withImage } });

    const captured = await patch(SLUG, { altText: 'A new description' });

    assert.deepEqual((captured.body as { data: object }).data, {
      reference: OLD_REFERENCE,
      altText: 'A new description',
      width: 100,
      height: 80,
    });
    assert.equal(stored.relation?.assetId, OLD_ASSET_ID, 'the same asset, still placed');
  });

  it('rolls back when a statement fails before COMMIT', async () => {
    const stored = storedJourney({
      image: { ...withImage },
      failOn: (text) => (text.includes('UPDATE package_media') ? new Error('deadlock detected') : null),
    });

    const { res } = fakeResponse();
    await assert.rejects(
      updatePackageImageAltTextHandler(altTextRequest(SLUG, { altText: 'text' }), res),
      /deadlock detected/,
    );

    assert.ok(shape(stored.calls).includes('ROLLBACK'));
    assert.ok(!shape(stored.calls).includes('COMMIT'));
    assert.equal(stored.released, true);
    assert.equal(stored.discarded, false, 'an ordinary failure returns the connection');
  });

  it('reports an unanswered COMMIT without rolling back afterwards', async () => {
    const stored = storedJourney({ image: { ...withImage }, failCommit: true });

    const captured = await patch(SLUG, { altText: 'text' });

    assert.equal(captured.status, 503);
    assert.match(JSON.stringify(captured.body), /MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN/);

    const order = shape(stored.calls);
    assert.deepEqual(order.slice(order.indexOf('COMMIT') + 1), [], 'nothing is sent after it');
    assert.equal(stored.discarded, true, 'the connection is poisoned rather than reused');
  });
});

describe('journey media: describing an image reaches no storage at all', () => {
  it('resolves no provider and makes no storage call, on every path', async () => {
    let resolutions = 0;
    const calls: string[] = [];

    // Wired into the routers the way production wires them, so a provider
    // resolved anywhere in this request would be counted here.
    const provider = (() => {
      resolutions += 1;
      return {
        async putObject(input: { key: string }) {
          calls.push(`put ${input.key}`);
        },
        async deleteObject(key: string) {
          calls.push(`delete ${key}`);
        },
      };
    }) as never;

    createAdminPackageMediaRouter(provider);

    for (const [label, state, body] of [
      ['success', () => storedJourney({ image: { ...withImage } }), { altText: 'text' }],
      ['cleared', () => storedJourney({ image: { ...withImage } }), { altText: null }],
      ['no image', () => storedJourney({ image: null }), { altText: 'text' }],
      ['no journey', () => storedJourney({ packageExists: false }), { altText: 'text' }],
      ['bad body', () => storedJourney({ image: { ...withImage } }), { nope: true }],
      [
        'uncertain commit',
        () => storedJourney({ image: { ...withImage }, failCommit: true }),
        { altText: 'text' },
      ],
    ] as const) {
      state();
      await patch(SLUG, body);

      assert.equal(resolutions, 0, `${label}: the storage provider is never resolved`);
      assert.deepEqual(calls, [], `${label}: and nothing is put or deleted`);
    }
  });

  it('is wired as a plain handler, with no provider passed to it', () => {
    // The structural half of the same claim: the route's handler is the bare
    // function, not something built from `getStorage`.
    const router = createAdminPackageMediaRouter(recordingStorage().provider) as never as {
      stack: { route?: { path: string; stack: { name: string }[] } }[];
    };

    const patchRoute = router.stack
      .map((layer) => layer.route)
      .find((route) => route?.path === '/:slug/image/alt-text')!;

    assert.equal(patchRoute.stack.length, 2, 'guard and handler, nothing between');
    assert.equal(patchRoute.stack[0]!.name, 'requireAdminSession');
    assert.equal(patchRoute.stack[1]!.name, 'updatePackageImageAltTextHandler');
  });
});

describe('journey media: describing against other writers', () => {
  it('sees the committed state when a delete got the lock first', async () => {
    // Serialized on the package row: the delete committed, so the relation
    // is gone by the time this transaction reads it.
    const stored = storedJourney({ image: null });

    const captured = await patch(SLUG, { altText: 'text' });

    assert.equal(captured.status, 404);
    assert.match(JSON.stringify(captured.body), /JOURNEY_IMAGE_NOT_FOUND/);
    assert.deepEqual(shape(stored.calls), ['BEGIN', 'LOCK', 'READ-IMAGE', 'ROLLBACK']);
  });

  it('lets a replacement that follows it keep the description it wrote', async () => {
    // PATCH commits first; the replacement then reads the relation under the
    // lock and its UPDATE never names alt_text, so the words survive the new
    // picture.
    const stored = storedJourney({ image: { ...withImage, altText: null } });

    await patch(SLUG, { altText: 'Written first' });
    assert.equal(stored.relation?.altText, 'Written first');

    const captured = await put(SLUG, recordingStorage().provider);

    assert.equal(captured.status, 200);
    assert.match(JSON.stringify(captured.body), /Written first/);
    assert.notEqual(stored.relation?.assetId, OLD_ASSET_ID, 'and the picture really did change');
  });

  it('describes whatever image the lock hands it after a replacement', async () => {
    const stored = storedJourney({ image: { ...withImage, altText: null } });

    await put(SLUG, recordingStorage().provider);
    const replacedAsset = stored.relation!.assetId;

    const captured = await patch(SLUG, { altText: 'Written second' });

    assert.equal(captured.status, 200);
    assert.equal(stored.relation?.assetId, replacedAsset, 'the new image, not the old one');
    assert.equal(stored.relation?.altText, 'Written second');
  });
});
