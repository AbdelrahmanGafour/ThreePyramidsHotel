import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';

// Exercises the room-type media HTTP boundary over real HTTP, against a real
// PostgreSQL database, the real admin session guard, the real service
// transactions and the real repository SQL. Object storage is a fake for
// every route that touches it, except in the one test that proves what
// happens when the real R2 provider is asked to build itself with no
// configuration — which never leaves this process and never contacts
// Cloudflare.
//
// It creates its own admin account and room types with identifiers unique to
// this run, and removes exactly those afterwards. No other data is read for
// assertions or deleted.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');
type PasswordModule = typeof import('../src/modules/admin-auth/admin-auth.password.js');
type App = typeof import('../src/app.js');
type Service = typeof import('../src/modules/admin-room-type-media/admin-room-type-media.service.js');
type MediaStorage = import('../src/modules/media/media.types.js').MediaStorage;

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let hashPassword: PasswordModule['hashPassword'];
let createApp: App['createApp'];
let service: Service;

let server: Server;
let baseUrl: string;
let configFailureServer: Server;
let configFailureBaseUrl: string;
let deliveryFailureServer: Server;
let deliveryFailureBaseUrl: string;
let invalidDeliveryServer: Server;
let invalidDeliveryBaseUrl: string;
let sessionCookie = '';

/** A fake, always-working public delivery base — no R2 variable involved. */
const FAKE_PUBLIC_BASE = 'https://media.test.example';

const expectedMediaUrl = (reference: string) => `${FAKE_PUBLIC_BASE}/media/${reference}.webp`;

const runId = randomUUID().slice(0, 8);
const slugPrefix = `itest-media-http-${runId}`;

const admin = {
  email: `itest-media-http-${runId}@example.com`,
  displayName: `Media HTTP Admin ${runId}`,
  password: `fixture-password-${runId}`,
};

const slugs = {
  work: `${slugPrefix}-work`,
  other: `${slugPrefix}-other`,
  limit: `${slugPrefix}-limit`,
  cleanup: `${slugPrefix}-cleanup`,
  uncertain: `${slugPrefix}-uncertain`,
} as const;

const roomTypeIds: Record<string, string> = {};

// ---------------------------------------------------------------------------
// A fake object store, recording every operation.
// ---------------------------------------------------------------------------

type Operation = { op: 'put' | 'delete'; key: string };

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
}

let storage: FakeStorage;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function png(width = 24, height = 16, background = '#1d4ed8'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

async function jpeg(width = 24, height = 16): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#a33' } }).jpeg().toBuffer();
}

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

async function insertRoomType(slug: string): Promise<string> {
  const inserted = await dbPool.query(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, 2, '1500.00', false, 0)`,
    [slug, `Fixture ${slug}`],
  );

  roomTypeIds[slug] = inserted.insertId!;

  return inserted.insertId!;
}

let freshRoomTypeSeq = 0;

/**
 * A brand-new, disposable room type, for any test that uploads and cares
 * about the resulting count, order or cover — none of which can be asked of a
 * slug other tests are also uploading to. Never cleaned up individually: the
 * suite's own `after()` sweeps every slug under this run's prefix, including
 * every one of these.
 */
async function freshRoomType(): Promise<string> {
  freshRoomTypeSeq += 1;
  const slug = `${slugPrefix}-fresh-${freshRoomTypeSeq}`;

  await insertRoomType(slug);

  return slug;
}

type JsonResponse = { status: number; json: unknown; headers: Headers };

async function send(
  method: string,
  path: string,
  init: { body?: BodyInit | Buffer; headers?: Record<string, string>; authed?: boolean } = {},
): Promise<JsonResponse> {
  const { body, headers = {}, authed = true } = init;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: authed ? { ...headers, Cookie: sessionCookie } : headers,
    // Node's global `fetch` accepts a Buffer body at runtime; the DOM lib
    // types this file compiles against do not declare it as part of
    // `BodyInit`, so the value is asserted rather than silently widened.
    body: body as BodyInit | undefined,
  });

  const json = await response.json().catch(() => undefined);

  return { status: response.status, json, headers: response.headers };
}

const get = (path: string, authed = true) => send('GET', path, { authed });
const del = (path: string, authed = true) => send('DELETE', path, { authed });

const patchJson = (path: string, body: unknown, authed = true) =>
  send('PATCH', path, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, authed });

const postImage = (path: string, body: BodyInit | Buffer, contentType: string | undefined, authed = true) =>
  send('POST', path, {
    body,
    headers: contentType === undefined ? {} : { 'Content-Type': contentType },
    authed,
  });

const imagesPath = (slug: string) => `/api/v1/admin/room-types/${encodeURIComponent(slug)}/images`;
const imagePath = (slug: string, reference: string) => `${imagesPath(slug)}/${encodeURIComponent(reference)}`;

async function uploadImage(
  slug: string,
  options: { contentType?: string; body?: Buffer } = {},
): Promise<{ status: number; json: unknown }> {
  const body = options.body ?? (await png());
  const contentType = options.contentType ?? 'image/png';

  return postImage(imagesPath(slug), body, contentType);
}

/** Uploads a valid image and asserts it succeeded, returning the created DTO. */
async function uploadValidImage(slug: string): Promise<Record<string, unknown>> {
  const result = await uploadImage(slug);

  assert.equal(result.status, 201, `seed upload failed: ${JSON.stringify(result.json)}`);

  return (result.json as { data: Record<string, unknown> }).data;
}

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** An ISO instant that round-trips exactly, as the API contract promises. */
const isInstant = (value: unknown): boolean =>
  typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString() === value;

/**
 * Makes the next `room_type_images` INSERT fail, for as long as the callback
 * runs. Used to force a definite pre-commit database failure after a real PUT,
 * the same way the service-level integration suite does.
 */
async function withFailingImageInsert<T>(run: () => Promise<T>): Promise<T> {
  const name = `itest_media_http_fail_${runId}`;

  await dbPool.query(
    `CREATE TRIGGER ${name} BEFORE INSERT ON room_type_images
       FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'itest: room_type_images insert refused'`,
  );

  try {
    return await run();
  } finally {
    await dbPool.query(`DROP TRIGGER IF EXISTS ${name}`);
  }
}

/** Makes the next COMMIT this test's transactions attempt reject before reaching PostgreSQL. */
async function withRejectedCommit<T>(run: () => Promise<T>): Promise<T> {
  service.__setClientFactoryForTests(async () => {
    const real = await dbPool.connect();
    const forward = (real.query as (...args: unknown[]) => Promise<unknown>).bind(real);

    return {
      query: (...args: unknown[]) => {
        const first = args[0];
        const text = typeof first === 'string' ? first : (first as { text?: string } | undefined)?.text;

        if (text === 'COMMIT') {
          return Promise.reject(Object.assign(new Error('simulated: connection lost'), { code: '08006' }));
        }

        return forward(...args);
      },
      release: (destroy?: unknown) => real.release(destroy as never),
    } as never;
  });

  try {
    return await run();
  } finally {
    service.__setClientFactoryForTests(null);
  }
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  ({ hashPassword } = await import('../src/modules/admin-auth/admin-auth.password.js'));
  ({ createApp } = await import('../src/app.js'));
  service = await import('../src/modules/admin-room-type-media/admin-room-type-media.service.js');

  storage = new FakeStorage();

  const app = createApp({
    mediaStorageProvider: () => storage,
    publicMediaBaseUrlProvider: () => FAKE_PUBLIC_BASE,
  });

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // A second app: real (unconfigured) storage, but a WORKING fake public
  // base, so a storage failure is the only thing that can go wrong. Every R2
  // variable is absent for this entire process. Used only for the
  // storage-configuration-failure test.
  const configFailureApp = createApp({ publicMediaBaseUrlProvider: () => FAKE_PUBLIC_BASE });

  configFailureServer = await new Promise<Server>((resolve) => {
    const listening = configFailureApp.listen(0, '127.0.0.1', () => resolve(listening));
  });
  configFailureBaseUrl = `http://127.0.0.1:${(configFailureServer.address() as AddressInfo).port}`;

  // A third app: a WORKING fake storage, but the real, unconfigured public
  // base provider — the mirror image of the second app. R2_PUBLIC_BASE_URL is
  // absent for this whole process, so this exercises the real "missing"
  // branch of parsePublicMediaBaseUrl, not a fake standing in for it.
  const deliveryFailureApp = createApp({ mediaStorageProvider: () => storage });

  deliveryFailureServer = await new Promise<Server>((resolve) => {
    const listening = deliveryFailureApp.listen(0, '127.0.0.1', () => resolve(listening));
  });
  deliveryFailureBaseUrl = `http://127.0.0.1:${(deliveryFailureServer.address() as AddressInfo).port}`;

  // A fourth app: a WORKING fake storage, and a provider that calls the REAL
  // parsePublicMediaBaseUrl against a deliberately insecure value — proving
  // the "invalid", not merely "absent", branch of the same real validation.
  const { parsePublicMediaBaseUrl } = await import('../src/modules/media/media.config.js');
  const invalidDeliveryApp = createApp({
    mediaStorageProvider: () => storage,
    publicMediaBaseUrlProvider: () => parsePublicMediaBaseUrl({ R2_PUBLIC_BASE_URL: 'http://insecure.example.com' }),
  });

  invalidDeliveryServer = await new Promise<Server>((resolve) => {
    const listening = invalidDeliveryApp.listen(0, '127.0.0.1', () => resolve(listening));
  });
  invalidDeliveryBaseUrl = `http://127.0.0.1:${(invalidDeliveryServer.address() as AddressInfo).port}`;

  await dbPool.query(
    `INSERT INTO admin_users (email, display_name, password_hash, is_active) VALUES ($1, $2, $3, true)`,
    [admin.email, admin.displayName, await hashPassword(admin.password)],
  );

  for (const slug of Object.values(slugs)) {
    await insertRoomType(slug);
  }

  const loginResponse = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: admin.password }),
  });

  assert.equal(loginResponse.status, 200, 'fixture login failed');
  const setCookie = loginResponse.headers.getSetCookie().find((value) => value.startsWith('tph_admin_session='));
  assert.ok(setCookie, 'fixture login returned no session cookie');
  sessionCookie = setCookie.split(';')[0]!;
});

after(async () => {
  try {
    const like = `${slugPrefix}-%`;

    await dbPool.query(
      'DELETE FROM room_type_images WHERE room_type_id IN (SELECT id FROM room_types WHERE slug LIKE $1)',
      [like],
    );
    await dbPool.query(
      `DELETE FROM media_assets
        WHERE id NOT IN (SELECT media_asset_id FROM room_type_images)
          AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 1 HOUR
          AND storage_key LIKE 'media/%'`,
    );
    await dbPool.query('DELETE FROM room_types WHERE slug LIKE $1', [like]);
    await dbPool.query('DELETE FROM admin_sessions WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = $1)', [
      admin.email,
    ]);
    await dbPool.query('DELETE FROM admin_users WHERE email = $1', [admin.email]);

    const { rows } = await dbPool.query<{ types: number; admins: number }>(
      `SELECT CAST((SELECT COUNT(*) FROM room_types WHERE slug LIKE $1) AS SIGNED) AS types,
              CAST((SELECT COUNT(*) FROM admin_users WHERE email = $2) AS SIGNED) AS admins`,
      [like, admin.email],
    );

    assert.deepEqual({ types: Number(rows[0]!.types), admins: Number(rows[0]!.admins) }, { types: 0, admins: 0 }, 'fixtures were not fully removed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      configFailureServer.close((error) => (error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      deliveryFailureServer.close((error) => (error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      invalidDeliveryServer.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDatabasePool();
  }
});

describe('authentication', () => {
  it('refuses an unauthenticated GET', async () => {
    const result = await get(imagesPath(slugs.work), false);

    assert.equal(result.status, 401);
  });

  it('refuses an unauthenticated POST, before storage or the body is ever touched', async () => {
    const opsBefore = storage.operations.length;

    const result = await postImage(imagesPath(slugs.work), Buffer.alloc(8 * 1024 * 1024 + 1), 'image/png', false);

    assert.equal(result.status, 401);
    assert.equal(storage.operations.length, opsBefore, 'auth must run before the raw parser and before storage');
  });

  it('refuses an unauthenticated PATCH', async () => {
    const result = await patchJson(imagePath(slugs.work, randomUUID()) + '/alt-text', { altText: 'x' }, false);

    assert.equal(result.status, 401);
  });

  it('refuses an unauthenticated DELETE', async () => {
    const result = await del(imagePath(slugs.work, randomUUID()), false);

    assert.equal(result.status, 401);
  });
});

// T03-I1: the upload route is mounted before the global express.json(), so a
// request declaring application/json — the one content type express.json()
// is willing to attempt — never has its body touched by that parser at all.
// These prove the two failure modes the split exists to close: an
// unauthenticated caller cannot make ANY body parser run before
// requireAdminSession, and an authenticated caller declaring a JSON-shaped
// Content-Type gets this route's own 415, never a JSON-parser 400.
describe('upload transport precedence', () => {
  it('an unauthenticated malformed application/json body still answers 401, never a JSON-parser 400', async () => {
    const result = await postImage(imagesPath(slugs.work), '{not valid json', 'application/json', false);

    // 401, not INVALID_JSON: proof the body was never handed to express.json()
    // before requireAdminSession ran.
    assert.equal(result.status, 401);
    assert.deepEqual(result.json, {
      error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' },
    });
  });

  it('an unauthenticated valid application/json body still answers 401', async () => {
    const result = await postImage(imagesPath(slugs.work), JSON.stringify({ a: 1 }), 'application/json', false);

    assert.equal(result.status, 401);
  });

  it('an unauthenticated oversized application/json-labelled body still answers 401, not 413', async () => {
    const oversized = 'x'.repeat(8 * 1024 * 1024 + 1);

    const result = await postImage(imagesPath(slugs.work), oversized, 'application/json', false);

    assert.equal(result.status, 401, 'auth must be settled before any size limit is even consulted');
  });

  it('an authenticated malformed application/json body answers 415, not INVALID_JSON', async () => {
    const result = await postImage(imagesPath(slugs.work), '{not valid json', 'application/json');

    assert.equal(result.status, 415);
    assert.deepEqual(result.json, {
      error: { code: 'UNSUPPORTED_IMAGE_TYPE', message: 'Unsupported image type' },
    });
  });

  it('an authenticated, well-formed JSON document sent to the image endpoint answers 415', async () => {
    const result = await postImage(imagesPath(slugs.work), JSON.stringify({ hello: 'world' }), 'application/json');

    assert.equal(result.status, 415);
    assert.deepEqual(result.json, {
      error: { code: 'UNSUPPORTED_IMAGE_TYPE', message: 'Unsupported image type' },
    });
  });

  it('an authenticated text/plain body answers 415', async () => {
    const result = await postImage(imagesPath(slugs.work), 'just some text', 'text/plain');

    assert.equal(result.status, 415);
  });

  it('an authenticated application/octet-stream body answers 415', async () => {
    const result = await postImage(imagesPath(slugs.work), Buffer.from([1, 2, 3, 4]), 'application/octet-stream');

    assert.equal(result.status, 415);
  });
});

describe('GET list', () => {
  it('lists images for an authenticated caller', async () => {
    const result = await get(imagesPath(slugs.work));

    assert.equal(result.status, 200);
    assert.ok(Array.isArray((result.json as { data: { images: unknown[] } }).data.images));
  });

  it('answers 404 for an unknown room type', async () => {
    const result = await get(imagesPath(`${slugPrefix}-nope`));

    assert.equal(result.status, 404);
    assert.deepEqual(result.json, { error: { code: 'ROOM_TYPE_NOT_FOUND', message: 'Room type not found' } });
  });

  it('answers 400 for a malformed slug', async () => {
    const result = await get(imagesPath('Not_A_Valid_Slug!'));

    assert.equal(result.status, 400);
    assert.deepEqual(result.json, {
      error: { code: 'INVALID_ROOM_TYPE_SLUG', message: 'Invalid room type slug' },
    });
  });

  it('never carries storageKey, checksumSha256 or an internal id', async () => {
    const slug = await freshRoomType();
    await uploadValidImage(slug);

    const result = await get(imagesPath(slug));
    const images = (result.json as { data: { images: Record<string, unknown>[] } }).data.images;

    assert.ok(images.length > 0);

    for (const image of images) {
      assert.deepEqual(Object.keys(image).sort(), [
        'altText',
        'byteSize',
        'contentType',
        'createdAt',
        'height',
        'isCover',
        'reference',
        'sortOrder',
        'updatedAt',
        'url',
        'width',
      ]);
      assert.match(image.reference as string, CANONICAL_UUID_PATTERN);
      assert.equal(image.url, expectedMediaUrl(image.reference as string));
      assert.ok(isInstant(image.createdAt));
      assert.ok(isInstant(image.updatedAt));
    }
  });

  it('needs no R2 configuration', async () => {
    for (const variable of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
      assert.equal(process.env[variable], undefined);
    }

    const result = await get(imagesPath(slugs.work));

    assert.equal(result.status, 200);
  });

  it('answers 503 MEDIA_DELIVERY_UNAVAILABLE when the public base is missing, without touching storage', async () => {
    const opsBefore = storage.operations.length;

    const response = await fetch(`${deliveryFailureBaseUrl}${imagesPath(slugs.work)}`, {
      headers: { Cookie: sessionCookie },
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: { code: 'MEDIA_DELIVERY_UNAVAILABLE', message: 'Media delivery is temporarily unavailable.' },
    });
    assert.equal(storage.operations.length, opsBefore, 'GET must never call MediaStorage');
  });

  it('answers the same safe 503 when the public base is invalid, without echoing it', async () => {
    const response = await fetch(`${invalidDeliveryBaseUrl}${imagesPath(slugs.work)}`, {
      headers: { Cookie: sessionCookie },
    });

    assert.equal(response.status, 503);
    const body = await response.json();

    assert.deepEqual(body, {
      error: { code: 'MEDIA_DELIVERY_UNAVAILABLE', message: 'Media delivery is temporarily unavailable.' },
    });
    assert.equal(JSON.stringify(body).includes('insecure.example.com'), false);
  });

  it('still answers 404 for an unknown room type even when delivery is unconfigured', async () => {
    // Existence is checked before delivery is ever resolved, so a request for
    // a slug nobody has used is not swallowed by an unrelated 503.
    const response = await fetch(`${deliveryFailureBaseUrl}${imagesPath(`${slugPrefix}-nope`)}`, {
      headers: { Cookie: sessionCookie },
    });

    assert.equal(response.status, 404);
  });
});

describe('POST upload', () => {
  it('accepts a valid JPEG', async () => {
    const slug = await freshRoomType();
    const result = await uploadImage(slug, { contentType: 'image/jpeg', body: await jpeg() });

    assert.equal(result.status, 201);
    const data = (result.json as { data: Record<string, unknown> }).data;
    assert.equal(data.contentType, 'image/webp');
  });

  it('accepts a valid PNG and stores it as WebP', async () => {
    const slug = await freshRoomType();
    const result = await uploadImage(slug);

    assert.equal(result.status, 201);
    assert.equal((result.json as { data: { contentType: string } }).data.contentType, 'image/webp');
  });

  it('makes the first image the cover, and the second not', async () => {
    const slug = await freshRoomType();

    const first = await uploadValidImage(slug);
    const second = await uploadValidImage(slug);

    assert.equal(first.isCover, true);
    assert.equal(second.isCover, false);
  });

  it('rejects SVG', async () => {
    const result = await uploadImage(slugs.work, { contentType: 'image/svg+xml', body: Buffer.from('<svg/>') });

    assert.equal(result.status, 415);
    assert.deepEqual(result.json, { error: { code: 'UNSUPPORTED_IMAGE_TYPE', message: 'Unsupported image type' } });
  });

  it('rejects GIF', async () => {
    const result = await uploadImage(slugs.work, {
      contentType: 'image/gif',
      body: Buffer.from('GIF89a', 'ascii'),
    });

    assert.equal(result.status, 415);
  });

  it('rejects a missing Content-Type', async () => {
    const result = await postImage(imagesPath(slugs.work), await png(), undefined);

    assert.equal(result.status, 415);
  });

  it('rejects a declared/sniffed mismatch', async () => {
    const result = await uploadImage(slugs.work, { contentType: 'image/jpeg', body: await png() });

    assert.equal(result.status, 400);
    assert.deepEqual(result.json, { error: { code: 'INVALID_IMAGE_UPLOAD', message: 'Invalid image upload' } });
  });

  it('rejects bytes that do not sniff as any accepted type', async () => {
    const result = await uploadImage(slugs.work, {
      contentType: 'image/png',
      body: Buffer.from('not an image at all', 'utf8'),
    });

    assert.equal(result.status, 400);
    assert.deepEqual(result.json, { error: { code: 'INVALID_IMAGE_UPLOAD', message: 'Invalid image upload' } });
  });

  it('rejects an empty body', async () => {
    const result = await uploadImage(slugs.work, { contentType: 'image/png', body: Buffer.alloc(0) });

    assert.equal(result.status, 400);
  });

  it('rejects an animated image', async () => {
    const result = await uploadImage(slugs.work, { contentType: 'image/webp', body: await animatedWebp() });

    assert.equal(result.status, 400);
    assert.deepEqual(result.json, { error: { code: 'INVALID_IMAGE_UPLOAD', message: 'Invalid image upload' } });
  });

  it('answers 413 for a body over 8 MiB, as safe JSON', async () => {
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, 0xff);

    const result = await uploadImage(slugs.work, { contentType: 'image/png', body: oversized });

    assert.equal(result.status, 413);
    assert.deepEqual(result.json, {
      error: { code: 'IMAGE_TOO_LARGE', message: 'Image exceeds the maximum upload size' },
    });
  });

  it('refuses a thirteenth image and compensates the object it had uploaded', async () => {
    // `storage` is one instance shared by the whole file, so what is measured
    // is the CHANGE in its contents around this test, never its absolute
    // size — other tests have objects of their own already sitting in it.
    for (let index = 0; index < 12; index += 1) {
      const seeded = await uploadImage(slugs.limit);

      assert.equal(seeded.status, 201, `seed image ${index} failed`);
    }

    const keysBeforeAttempt = new Set(storage.keys);
    const putsBefore = storage.operations.filter((entry) => entry.op === 'put').length;

    const result = await uploadImage(slugs.limit);

    assert.equal(result.status, 409);
    assert.deepEqual(result.json, {
      error: { code: 'ROOM_TYPE_IMAGE_LIMIT_REACHED', message: 'Room type has reached its image limit' },
    });

    const putsAfter = storage.operations.filter((entry) => entry.op === 'put').length;
    assert.equal(putsAfter, putsBefore + 1, 'the bytes were uploaded before the refusal');

    const keysAfterAttempt = new Set(storage.keys);
    assert.deepEqual(keysAfterAttempt, keysBeforeAttempt, 'the one new object was removed again, leaving no net change');
  });

  it('answers 503 when storage.putObject fails', async () => {
    storage.failNextPut();

    const result = await uploadImage(slugs.work);

    assert.equal(result.status, 503);
    assert.deepEqual(result.json, {
      error: { code: 'MEDIA_STORAGE_UNAVAILABLE', message: 'Media storage is temporarily unavailable' },
    });
  });

  it('answers 503 when the real storage provider cannot configure itself, without crashing the app', async () => {
    const response = await fetch(`${configFailureBaseUrl}/api/v1/admin/room-types/${slugs.work}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: sessionCookie },
      body: (await png()) as BodyInit,
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: { code: 'MEDIA_STORAGE_UNAVAILABLE', message: 'Media storage is temporarily unavailable' },
    });

    // The app itself never crashed: an ordinary GET against the same running
    // process still answers normally afterward.
    const stillUp = await fetch(`${configFailureBaseUrl}/api/v1/admin/room-types/${slugs.work}/images`, {
      headers: { Cookie: sessionCookie },
    });

    assert.equal(stillUp.status, 200);
  });

  it('never exposes storageKey or a checksum on a successful upload', async () => {
    const slug = await freshRoomType();
    const result = await uploadImage(slug);
    const data = (result.json as { data: Record<string, unknown> }).data;

    assert.equal('storageKey' in data, false);
    assert.equal('checksumSha256' in data, false);
  });

  it('returns exactly 201 with the expected url, derived from the reference', async () => {
    const slug = await freshRoomType();
    const result = await uploadImage(slug);

    assert.equal(result.status, 201);
    const data = (result.json as { data: { reference: string; url: string } }).data;

    assert.equal(data.url, expectedMediaUrl(data.reference));
  });

  it('missing public-base delivery config answers 503 BEFORE any storage.putObject, and writes no row', async () => {
    const opsBefore = storage.operations.length;

    const response = await fetch(`${deliveryFailureBaseUrl}${imagesPath(slugs.work)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: sessionCookie },
      body: (await png()) as BodyInit,
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: { code: 'MEDIA_DELIVERY_UNAVAILABLE', message: 'Media delivery is temporarily unavailable.' },
    });

    assert.equal(storage.operations.length, opsBefore, 'no storage.putObject before the delivery check');

    const { rows } = await dbPool.query<{ total: number }>(
      `SELECT CAST(COUNT(*) AS SIGNED) AS total FROM room_type_images WHERE room_type_id = $1`,
      [roomTypeIds[slugs.work]],
    );
    assert.equal(Number(rows[0]!.total), 0, 'no row was written for a room type with no images yet');
  });

  it('invalid public-base delivery config answers the same safe 503, also before any storage.putObject', async () => {
    const opsBefore = storage.operations.length;

    const response = await fetch(`${invalidDeliveryBaseUrl}${imagesPath(slugs.work)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: sessionCookie },
      body: (await png()) as BodyInit,
    });

    assert.equal(response.status, 503);
    const body = await response.json();

    assert.deepEqual(body, {
      error: { code: 'MEDIA_DELIVERY_UNAVAILABLE', message: 'Media delivery is temporarily unavailable.' },
    });
    assert.equal(JSON.stringify(body).includes('insecure.example.com'), false, 'the configured value must not leak');
    assert.equal(storage.operations.length, opsBefore);
  });
});

describe('PATCH alt-text', () => {
  it('sets alt text and answers 204 with no body', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    const result = await patchJson(imagePath(slug, image.reference as string) + '/alt-text', {
      altText: 'A terrace at dusk.',
    });

    assert.equal(result.status, 204);
    assert.equal(result.json, undefined, 'a 204 must carry no JSON body');

    const listed = await get(imagesPath(slug));
    const found = (listed.json as { data: { images: { reference: string; altText: string | null }[] } }).data.images.find(
      (candidate) => candidate.reference === image.reference,
    );

    assert.equal(found?.altText, 'A terrace at dusk.');
  });

  it('clears whitespace-only text to null', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    await patchJson(imagePath(slug, image.reference as string) + '/alt-text', { altText: '   ' });

    const listed = await get(imagesPath(slug));
    const found = (listed.json as { data: { images: { reference: string; altText: string | null }[] } }).data.images.find(
      (candidate) => candidate.reference === image.reference,
    );

    assert.equal(found?.altText, null);
  });

  it('refuses a body missing the altText key', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    const result = await patchJson(imagePath(slug, image.reference as string) + '/alt-text', {});

    assert.equal(result.status, 400);
    assert.deepEqual(result.json, {
      error: { code: 'INVALID_ROOM_TYPE_IMAGE_UPDATE', message: 'Invalid room type image update' },
    });
  });

  it('refuses text over 240 characters', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    const result = await patchJson(imagePath(slug, image.reference as string) + '/alt-text', {
      altText: 'a'.repeat(241),
    });

    assert.equal(result.status, 400);
  });

  it('refuses a malformed reference', async () => {
    const slug = await freshRoomType();
    const result = await patchJson(imagePath(slug, 'not-a-uuid') + '/alt-text', { altText: 'x' });

    assert.equal(result.status, 400);
    assert.deepEqual(result.json, {
      error: { code: 'INVALID_ROOM_TYPE_IMAGE_REFERENCE', message: 'Invalid room type image reference' },
    });
  });

  it('answers the same 404 for a foreign image and an unknown one', async () => {
    const slug = await freshRoomType();
    const mine = await uploadValidImage(slug);

    const foreign = await patchJson(imagePath(slugs.other, mine.reference as string) + '/alt-text', { altText: 'x' });
    const unknown = await patchJson(imagePath(slugs.other, randomUUID()) + '/alt-text', { altText: 'x' });

    assert.deepEqual(foreign.json, {
      error: { code: 'ROOM_TYPE_IMAGE_NOT_FOUND', message: 'Room type image not found' },
    });
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.json, unknown.json);
    assert.equal(unknown.status, 404);
  });

  it('performs no storage operation', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);
    const before = storage.operations.length;

    await patchJson(imagePath(slug, image.reference as string) + '/alt-text', { altText: 'x' });

    assert.equal(storage.operations.length, before);
  });
});

describe('PATCH cover', () => {
  it('sets the cover and answers 204', async () => {
    const slug = `${slugPrefix}-cover-seed`;
    await insertRoomType(slug);

    const first = await uploadValidImage(slug);
    const second = await uploadValidImage(slug);

    const result = await patchJson(imagePath(slug, second.reference as string) + '/cover', undefined);

    assert.equal(result.status, 204);

    const listed = await get(imagesPath(slug));
    const images = (listed.json as { data: { images: { reference: string; isCover: boolean }[] } }).data.images;

    assert.equal(images[0]!.reference, second.reference);
    assert.equal(images.find((image) => image.reference === first.reference)!.isCover, false);

    await dbPool.query('DELETE FROM room_type_images WHERE room_type_id = $1', [roomTypeIds[slug]]);
    await dbPool.query(
      `DELETE FROM media_assets WHERE id NOT IN (SELECT media_asset_id FROM room_type_images) AND storage_key LIKE 'media/%'`,
    );
    await dbPool.query('DELETE FROM room_types WHERE slug = $1', [slug]);
  });

  it('selecting the current cover again is idempotent, still 204', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    const result = await patchJson(imagePath(slug, image.reference as string) + '/cover', undefined);

    assert.equal(result.status, 204);
  });

  it('refuses a body carrying isCover or any other field', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    const result = await patchJson(imagePath(slug, image.reference as string) + '/cover', { isCover: false });

    assert.equal(result.status, 400);
    assert.deepEqual(result.json, {
      error: { code: 'INVALID_ROOM_TYPE_IMAGE_UPDATE', message: 'Invalid room type image update' },
    });
  });

  it('refuses a malformed reference', async () => {
    const slug = await freshRoomType();
    const result = await patchJson(imagePath(slug, '{bad}') + '/cover', undefined);

    assert.equal(result.status, 400);
  });

  it('answers 404 identically for foreign and unknown images, and does not clear the real cover', async () => {
    const slug = `${slugPrefix}-cover-guard`;
    await insertRoomType(slug);
    const mine = await uploadValidImage(slug);
    const foreignImage = await uploadValidImage(slugs.other);

    const foreign = await patchJson(imagePath(slug, foreignImage.reference as string) + '/cover', undefined);
    const unknown = await patchJson(imagePath(slug, randomUUID()) + '/cover', undefined);

    assert.equal(foreign.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(foreign.json, unknown.json);

    const listed = await get(imagesPath(slug));
    const images = (listed.json as { data: { images: { reference: string; isCover: boolean }[] } }).data.images;
    assert.equal(images[0]!.reference, mine.reference);
    assert.equal(images[0]!.isCover, true);

    await dbPool.query('DELETE FROM room_type_images WHERE room_type_id = $1', [roomTypeIds[slug]]);
    await dbPool.query(
      `DELETE FROM media_assets WHERE id NOT IN (SELECT media_asset_id FROM room_type_images) AND storage_key LIKE 'media/%'`,
    );
    await dbPool.query('DELETE FROM room_types WHERE slug = $1', [slug]);
  });

  it('performs no storage operation', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);
    const before = storage.operations.length;

    await patchJson(imagePath(slug, image.reference as string) + '/cover', undefined);

    assert.equal(storage.operations.length, before);
  });
});

describe('PATCH order', () => {
  it('moves an image up, and answers 204', async () => {
    const slug = `${slugPrefix}-move-up`;
    await insertRoomType(slug);
    await uploadValidImage(slug);
    const second = await uploadValidImage(slug);

    const result = await patchJson(imagePath(slug, second.reference as string) + '/order', { direction: 'up' });

    assert.equal(result.status, 204);

    await dbPool.query('DELETE FROM room_type_images WHERE room_type_id = $1', [roomTypeIds[slug]]);
    await dbPool.query(
      `DELETE FROM media_assets WHERE id NOT IN (SELECT media_asset_id FROM room_type_images) AND storage_key LIKE 'media/%'`,
    );
    await dbPool.query('DELETE FROM room_types WHERE slug = $1', [slug]);
  });

  it('moves an image down, and answers 204', async () => {
    const slug = `${slugPrefix}-move-down`;
    await insertRoomType(slug);
    const first = await uploadValidImage(slug);
    await uploadValidImage(slug);

    const result = await patchJson(imagePath(slug, first.reference as string) + '/order', { direction: 'down' });

    assert.equal(result.status, 204);

    await dbPool.query('DELETE FROM room_type_images WHERE room_type_id = $1', [roomTypeIds[slug]]);
    await dbPool.query(
      `DELETE FROM media_assets WHERE id NOT IN (SELECT media_asset_id FROM room_type_images) AND storage_key LIKE 'media/%'`,
    );
    await dbPool.query('DELETE FROM room_types WHERE slug = $1', [slug]);
  });

  it('answers 204, not a conflict, for a boundary move', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    const result = await patchJson(imagePath(slug, image.reference as string) + '/order', { direction: 'up' });

    // The first image (by sort order) cannot move further up; the service
    // still reports success.
    assert.ok([204].includes(result.status), `expected 204 for a boundary move, got ${result.status}`);
  });

  it('rejects an invalid direction', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    const result = await patchJson(imagePath(slug, image.reference as string) + '/order', {
      direction: 'sideways',
    });

    assert.equal(result.status, 400);
    assert.deepEqual(result.json, {
      error: { code: 'INVALID_ROOM_TYPE_IMAGE_UPDATE', message: 'Invalid room type image update' },
    });
  });

  it('rejects an arbitrary sortOrder body', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    const result = await patchJson(imagePath(slug, image.reference as string) + '/order', { sortOrder: 3 });

    assert.equal(result.status, 400);
  });

  it('refuses a malformed reference', async () => {
    const slug = await freshRoomType();
    const result = await patchJson(imagePath(slug, 'nope') + '/order', { direction: 'up' });

    assert.equal(result.status, 400);
    assert.deepEqual(result.json, {
      error: { code: 'INVALID_ROOM_TYPE_IMAGE_REFERENCE', message: 'Invalid room type image reference' },
    });
  });

  it('answers the same 404 for foreign and unknown images', async () => {
    const foreignImage = await uploadValidImage(slugs.other);

    const foreign = await patchJson(imagePath(slugs.work, foreignImage.reference as string) + '/order', {
      direction: 'up',
    });
    const unknown = await patchJson(imagePath(slugs.work, randomUUID()) + '/order', { direction: 'up' });

    assert.equal(foreign.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(foreign.json, unknown.json);
  });

  it('performs no storage operation', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);
    const before = storage.operations.length;

    await patchJson(imagePath(slug, image.reference as string) + '/order', { direction: 'down' });

    assert.equal(storage.operations.length, before);
  });
});

describe('DELETE', () => {
  it('removes rows and answers 204', async () => {
    const slug = await freshRoomType();

    // The admin DTO never carries a storage key (that is the whole point of
    // the mapper), so the key this test checks for is read from the fake
    // store itself: whichever key the upload just added.
    const keysBefore = new Set(storage.keys);
    const image = await uploadValidImage(slug);
    const newKey = storage.keys.find((key) => !keysBefore.has(key));
    assert.ok(newKey, 'the upload did not add a new object to the fake store');

    const result = await del(imagePath(slug, image.reference as string));

    assert.equal(result.status, 204);
    assert.equal(result.json, undefined);

    const listed = await get(imagesPath(slug));
    const stillThere = (listed.json as { data: { images: { reference: string }[] } }).data.images.some(
      (candidate) => candidate.reference === image.reference,
    );

    assert.equal(stillThere, false);
    assert.equal(storage.objects.has(newKey!), false, 'the object must be removed from storage after a clean delete');
  });

  it('still answers 204 when the post-commit storage cleanup fails', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    storage.failNextDelete();

    const result = await del(imagePath(slug, image.reference as string));

    assert.equal(result.status, 204, 'a storage cleanup failure must not change the DB outcome');

    const listed = await get(imagesPath(slug));
    const stillThere = (listed.json as { data: { images: { reference: string }[] } }).data.images.some(
      (candidate) => candidate.reference === image.reference,
    );

    assert.equal(stillThere, false, 'the row is gone regardless of the cleanup outcome');
  });

  it('answers 404 for an unknown image', async () => {
    const slug = await freshRoomType();
    const result = await del(imagePath(slug, randomUUID()));

    assert.equal(result.status, 404);
    assert.deepEqual(result.json, {
      error: { code: 'ROOM_TYPE_IMAGE_NOT_FOUND', message: 'Room type image not found' },
    });
  });

  it('answers the same 404 for a foreign image', async () => {
    const slug = await freshRoomType();
    const foreignImage = await uploadValidImage(slugs.other);

    const result = await del(imagePath(slug, foreignImage.reference as string));

    assert.equal(result.status, 404);
    assert.deepEqual(result.json, {
      error: { code: 'ROOM_TYPE_IMAGE_NOT_FOUND', message: 'Room type image not found' },
    });

    // Left untouched.
    const listed = await get(imagesPath(slugs.other));
    assert.ok(
      (listed.json as { data: { images: { reference: string }[] } }).data.images.some(
        (candidate) => candidate.reference === foreignImage.reference,
      ),
    );
  });

  it('refuses a malformed reference', async () => {
    const slug = await freshRoomType();
    const result = await del(imagePath(slug, 'not-a-uuid'));

    assert.equal(result.status, 400);
    assert.deepEqual(result.json, {
      error: { code: 'INVALID_ROOM_TYPE_IMAGE_REFERENCE', message: 'Invalid room type image reference' },
    });
  });
});

describe('uncertain persistence outcome', () => {
  it('upload: answers 503 with the locked wording, and makes no storage delete', async () => {
    const opsBefore = storage.operations.length;

    const result = await withRejectedCommit(() => uploadImage(slugs.uncertain));

    assert.equal(result.status, 503);
    assert.deepEqual(result.json, {
      error: {
        code: 'MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN',
        message: 'The operation outcome could not be confirmed. Refresh the current state before retrying.',
      },
    });

    const opsAfter = storage.operations.length;
    const puts = storage.operations.slice(opsBefore, opsAfter).filter((entry) => entry.op === 'put').length;
    const deletes = storage.operations.slice(opsBefore, opsAfter).filter((entry) => entry.op === 'delete').length;

    assert.equal(puts, 1, 'the PUT still happened before the uncertain commit');
    assert.equal(deletes, 0, 'no automatic compensation for an uncertain commit');
  });

  it('does not word the response as success, failure or rollback', async () => {
    const result = await withRejectedCommit(() => uploadImage(slugs.uncertain));
    const message = (result.json as { error: { message: string } }).error.message;

    for (const claim of ['failed', 'rolled back', 'rolled-back', 'not created', 'success', 'deleted']) {
      assert.equal(message.toLowerCase().includes(claim), false, `message claims "${claim}"`);
    }
  });

  it('delete: answers 503, and makes no storage call', async () => {
    const image = await uploadValidImage(slugs.uncertain);
    const before = storage.operations.length;

    const result = await withRejectedCommit(() => del(imagePath(slugs.uncertain, image.reference as string)));

    assert.equal(result.status, 503);
    assert.deepEqual(result.json, {
      error: {
        code: 'MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN',
        message: 'The operation outcome could not be confirmed. Refresh the current state before retrying.',
      },
    });
    assert.equal(storage.operations.length, before, 'no storage call may follow an uncertain commit');
  });

  it('performs no automatic retry: one HTTP call produces exactly one attempt', async () => {
    const opsBefore = storage.operations.length;

    await withRejectedCommit(() => uploadImage(slugs.uncertain));

    const puts = storage.operations.slice(opsBefore).filter((entry) => entry.op === 'put').length;

    assert.equal(puts, 1, 'the controller must not call the service a second time on its own');
  });
});

// Alt-text, cover, order and delete return no image DTO, so none of them
// needs R2_PUBLIC_BASE_URL at all. Proven against `deliveryFailureServer`,
// whose public-base provider is the real one and genuinely unconfigured —
// not a fake standing in for "it would have worked anyway".
describe('mutation routes do not depend on public delivery configuration', () => {
  it('alt-text PATCH works with public base absent', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    const response = await fetch(`${deliveryFailureBaseUrl}${imagePath(slug, image.reference as string)}/alt-text`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ altText: 'ok without delivery config' }),
    });

    assert.equal(response.status, 204);
  });

  it('cover PATCH works with public base absent', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    const response = await fetch(`${deliveryFailureBaseUrl}${imagePath(slug, image.reference as string)}/cover`, {
      method: 'PATCH',
      headers: { Cookie: sessionCookie },
    });

    assert.equal(response.status, 204);
  });

  it('order PATCH works with public base absent', async () => {
    const slug = await freshRoomType();
    await uploadValidImage(slug);
    const second = await uploadValidImage(slug);

    const response = await fetch(`${deliveryFailureBaseUrl}${imagePath(slug, second.reference as string)}/order`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ direction: 'up' }),
    });

    assert.equal(response.status, 204);
  });

  it('DELETE works with public base absent, and still cleans up storage', async () => {
    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);
    const opsBefore = storage.operations.length;

    const response = await fetch(`${deliveryFailureBaseUrl}${imagePath(slug, image.reference as string)}`, {
      method: 'DELETE',
      headers: { Cookie: sessionCookie },
    });

    assert.equal(response.status, 204);
    assert.ok(storage.operations.length > opsBefore, 'delete still needs and uses MediaStorage');
  });
});

describe('safety', () => {
  it('maps a known upload cleanup failure to a safe generic 500', async () => {
    storage.failNextDelete();

    let result: { status: number; json: unknown } = { status: 0, json: undefined };

    await withFailingImageInsert(async () => {
      result = await uploadImage(slugs.cleanup);
    });

    assert.equal(result.status, 500);
    assert.deepEqual(result.json, {
      error: { code: 'MEDIA_OPERATION_FAILED', message: 'The operation could not be completed' },
    });
  });

  it('never lets a storage key appear in any error response', async () => {
    const responses: unknown[] = [];

    responses.push((await get(imagesPath(`${slugPrefix}-nope`))).json);
    responses.push((await uploadImage(slugs.work, { contentType: 'image/svg+xml', body: Buffer.from('x') })).json);
    responses.push((await del(imagePath(slugs.work, randomUUID()))).json);

    storage.failNextPut();
    responses.push((await uploadImage(slugs.work)).json);

    for (const response of responses) {
      const text = JSON.stringify(response);

      assert.equal(/media\/[0-9a-f-]{36}\.webp/.test(text), false, `a storage key leaked: ${text}`);
    }
  });

  it('never exposes an endpoint, bucket, access key or secret', async () => {
    const result = await fetch(`${configFailureBaseUrl}/api/v1/admin/room-types/${slugs.work}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: sessionCookie },
      body: (await png()) as BodyInit,
    });
    const text = JSON.stringify(await result.json());

    for (const forbidden of ['r2.cloudflarestorage', 'endpoint', 'accessKey', 'secret', 'AKIA']) {
      assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()), false, `leaked: ${forbidden}`);
    }
  });

  it('GET and PATCH routes work with every R2 variable absent', async () => {
    for (const variable of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']) {
      assert.equal(process.env[variable], undefined);
    }

    const slug = await freshRoomType();
    const image = await uploadValidImage(slug);

    assert.equal((await get(imagesPath(slug))).status, 200);
    assert.equal(
      (await patchJson(imagePath(slug, image.reference as string) + '/alt-text', { altText: 'ok' })).status,
      204,
    );
    assert.equal(
      (await patchJson(imagePath(slug, image.reference as string) + '/cover', undefined)).status,
      204,
    );
    assert.equal(
      (await patchJson(imagePath(slug, image.reference as string) + '/order', { direction: 'down' })).status,
      204,
    );
  });

  it('importing the app and building its routes required no R2 variable', () => {
    // The whole suite has run by now, on an app built and routed at import
    // time with every R2 variable absent throughout. If any module had read
    // one at import or at router-construction time, this process would
    // already have thrown long before this assertion.
    for (const variable of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
      assert.equal(process.env[variable], undefined);
    }
  });
});
