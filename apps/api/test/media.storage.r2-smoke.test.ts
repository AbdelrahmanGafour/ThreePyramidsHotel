import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { parseR2StorageConfig } from '../src/modules/media/media.config';
import { normalizeImage } from '../src/modules/media/media.processing';
import { createR2MediaStorage, r2ClientConfig } from '../src/modules/media/media.storage';
import { MEDIA_CACHE_CONTROL, type ImageNormalization, type MediaStorage } from '../src/modules/media/media.types';
import { createMediaReference, mediaStorageKey } from '../src/modules/media/media.validation';

/**
 * The one test in this repository that talks to Cloudflare.
 *
 * It exists to answer a question no offline test can: does the installed AWS
 * SDK, configured the way `media.storage.ts` configures it, actually work
 * against a real R2 bucket? Everything else about the adapter is proven with a
 * double; this proves the wire.
 *
 * It is opt-in and deliberately outside both `npm test` and
 * `npm run test:integration`, so CI and an ordinary `npm test` can never reach
 * the network. It runs only through `npm run test:r2-smoke -w apps/api`, which
 * loads credentials from an untracked local env file.
 *
 * One object, one PUT, one authenticated GET, one DELETE, one HEAD. The key is
 * a fresh UUID, so it cannot collide with — let alone overwrite — anything the
 * hotel actually stores, and it is removed again before the run ends.
 *
 * Nothing in this file prints a configured value. Failures report an
 * operation, an error name and an HTTP status, and nothing else.
 */

/**
 * The only bucket this test may touch, written here rather than in production
 * code. The adapter has no opinion about which bucket it is pointed at — that
 * is a deployment's business — but this test does, because it writes and
 * deletes real objects and must never do that anywhere but development.
 */
const DEVELOPMENT_BUCKET = 'three-pyramids-media-dev';

// -- Safety gates ----------------------------------------------------------
//
// Both are settled at module load, before any hook runs and therefore before
// anything could open a socket. A refusal here is a thrown error with no
// configured value in it.

if (process.env.R2_SMOKE_ENABLED !== '1') {
  throw new Error(
    'The R2 smoke test is opt-in and did not run. Set R2_SMOKE_ENABLED=1 in apps/api/.env.r2-smoke and use\n' +
      '  npm run test:r2-smoke -w apps/api',
  );
}

const config = parseR2StorageConfig(process.env);

if (config.bucket !== DEVELOPMENT_BUCKET) {
  // The configured name is deliberately not repeated back.
  throw new Error(`R2_BUCKET is not the development bucket. This test refuses to run against anything else.`);
}

/**
 * Reduces any failure from a test-only authenticated read to what is safe to
 * print: which operation, what the provider called the error, and the HTTP
 * status if there was one.
 *
 * The SDK's own error carries the endpoint, the bucket, the signed request and
 * sometimes the response body. None of that belongs in a test report, a
 * terminal or a CI log, so the original is dropped rather than re-thrown.
 */
async function safely<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const details = error as { name?: string; $metadata?: { httpStatusCode?: number } };

    throw new Error(
      `R2 ${operation} failed (name=${details.name ?? 'unknown'}, ` +
        `status=${details.$metadata?.httpStatusCode ?? 'none'})`,
    );
  }
}

describe('Cloudflare R2, against the real development bucket', () => {
  let storage: MediaStorage;
  let client: S3Client;
  let normalized: ImageNormalization;
  let key: string;

  /** Set the moment a PUT succeeds: from here on there is something to clean up. */
  let uploaded = false;
  /** Set when a DELETE has been attempted, successfully or not. */
  let deleteAttempted = false;

  before(async () => {
    // A real image, produced by the real pipeline. Nothing is read from disk
    // and nothing arbitrary is uploaded wearing a .webp extension: these bytes
    // went through Sharp, were auto-oriented, stripped, resized and encoded by
    // the same code an administrator's upload will use.
    const png = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#1d4ed8' } })
      .png()
      .toBuffer();

    const result = await normalizeImage(png, 'image/png');

    assert.equal(result.ok, true, 'the source image did not normalize locally; nothing was uploaded');
    assert.ok(result.ok);
    normalized = result.normalized;

    // The production identity helpers, so the object has the shape a real one
    // has. A fresh v4 UUID cannot collide with anything already stored.
    key = mediaStorageKey(createMediaReference());

    storage = createR2MediaStorage(process.env);
    client = new S3Client(r2ClientConfig(config));
  });

  after(async () => {
    try {
      // Cleanup of last resort: reached when the run failed somewhere between
      // a successful PUT and the delete below ever being attempted. It is not
      // a retry — a delete that was attempted and failed is reported as a
      // possible orphan rather than fired again.
      if (uploaded && !deleteAttempted) {
        deleteAttempted = true;

        try {
          await storage.deleteObject(key);
        } catch {
          // Failing cleanup fails the run, and the key is named so the one
          // object that may be left behind can be found. A key is a random
          // UUID under a fixed prefix and is not a secret; the credentials,
          // the endpoint and the SDK's error are not repeated here.
          throw new Error(`R2 smoke cleanup failed. An object may remain at: ${key}`);
        }
      }
    } finally {
      client?.destroy();
    }
  });

  it('normalized a real image before touching the network', () => {
    assert.equal(normalized.contentType, 'image/webp');
    assert.ok(normalized.byteSize > 0);
    assert.equal(normalized.byteSize, normalized.body.length);
    assert.match(normalized.checksumSha256, /^[0-9a-f]{64}$/);
    assert.match(key, /^media\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/);
  });

  it('stores, verifies and removes exactly one object', async () => {
    // 1. PUT, through the production adapter. Not bypassed: if this path is
    //    wrong, the real upload endpoint is wrong too.
    await storage.putObject({ key, body: normalized.body, contentType: normalized.contentType });
    uploaded = true;

    // 2. Authenticated read, with a client built from the same production
    //    configuration. GetObject lives only here — the MediaStorage port has
    //    no read operation, and this must not become a reason to give it one.
    const response = await safely('GetObject', () =>
      client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key })),
    );

    assert.equal(response.ContentType, 'image/webp', 'stored ContentType');
    assert.equal(response.CacheControl, MEDIA_CACHE_CONTROL, 'stored CacheControl');
    assert.equal(response.CacheControl, 'public, max-age=31536000, immutable');

    assert.ok(response.Body, 'GetObject returned no body');

    const downloaded = Buffer.from(await response.Body.transformToByteArray());

    // Byte-for-byte, then by digest. The bytes themselves are never printed;
    // only whether they matched.
    assert.equal(downloaded.length, normalized.byteSize, 'downloaded length');
    assert.ok(downloaded.equals(normalized.body), 'the downloaded bytes differ from what was uploaded');
    assert.equal(
      createHash('sha256').update(downloaded).digest('hex'),
      normalized.checksumSha256,
      'the recorded checksum does not describe what R2 returned',
    );

    // 3. DELETE, through the production adapter, for this key and no other.
    deleteAttempted = true;
    await storage.deleteObject(key);

    // 4. Optional confirmation that it is really gone. Only a genuine
    //    not-found counts: an authorization or network failure would be a
    //    different problem wearing the same shape, and accepting it would turn
    //    this into a test that passes when the credentials stop working.
    let stillPresent = false;
    let absence: { name?: string; status?: number } = {};

    try {
      await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      stillPresent = true;
    } catch (error) {
      const details = error as { name?: string; $metadata?: { httpStatusCode?: number } };

      absence = { name: details.name, status: details.$metadata?.httpStatusCode };
    }

    assert.equal(stillPresent, false, 'the object is still readable after being deleted');
    assert.ok(
      absence.status === 404 || absence.name === 'NotFound' || absence.name === 'NoSuchKey',
      `deletion was not confirmed by a not-found result (name=${absence.name ?? 'unknown'}, ` +
        `status=${absence.status ?? 'none'})`,
    );

    uploaded = false;
  });
});
