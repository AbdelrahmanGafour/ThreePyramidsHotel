import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { parsePublicMediaBaseUrl, parseR2StorageConfig } from '../src/modules/media/media.config';
import { composePublicMediaUrl } from '../src/modules/media/media.delivery';
import { normalizeImage } from '../src/modules/media/media.processing';
import { createR2MediaStorage, r2ClientConfig } from '../src/modules/media/media.storage';
import { MEDIA_CACHE_CONTROL, type ImageNormalization, type MediaStorage } from '../src/modules/media/media.types';
import { createMediaReference, mediaStorageKey } from '../src/modules/media/media.validation';

/**
 * The one test in this repository that verifies a real, publicly reachable
 * image URL. T03-F already proved the storage adapter works against R2 with
 * an authenticated read; this proves the OTHER half — that a browser, with no
 * credential at all, can fetch what `composePublicMediaUrl` composes, and get
 * back exactly the bytes the pipeline produced.
 *
 * It is opt-in and deliberately outside both `npm test` and
 * `npm run test:integration`, so CI and an ordinary `npm test` can never reach
 * the network. It runs only through
 * `npm run test:r2-delivery-smoke -w apps/api`, which loads credentials and
 * the public base from an untracked local env file.
 *
 * One object, one authenticated PUT, one UNAUTHENTICATED public GET, one
 * authenticated DELETE, one authenticated HEAD to confirm the origin is
 * clear. The key is a fresh UUID, so it cannot collide with — let alone
 * overwrite — anything the hotel actually stores, and it is removed again
 * before the run ends.
 *
 * Nothing in this file prints a configured value, a full public URL, or the
 * downloaded bytes. Failures report a stage, a safe status/header, and
 * nothing else.
 */

/**
 * The only bucket this test may touch, written here rather than in production
 * code — the adapter itself has no opinion about which bucket it is pointed
 * at, and must not gain one merely because this test needs to be careful.
 */
const DEVELOPMENT_BUCKET = 'three-pyramids-media-dev';

// -- Safety gates ------------------------------------------------------------
//
// All three are settled at module load, before any hook runs and therefore
// before anything could open a socket. A refusal here is a thrown error with
// no configured value in it.

if (process.env.R2_SMOKE_ENABLED !== '1') {
  throw new Error(
    'The R2 delivery smoke test is opt-in and did not run. Set R2_SMOKE_ENABLED=1 in\n' +
      'apps/api/.env.r2-smoke and use\n' +
      '  npm run test:r2-delivery-smoke -w apps/api',
  );
}

const storageConfig = parseR2StorageConfig(process.env);

if (storageConfig.bucket !== DEVELOPMENT_BUCKET) {
  // The configured name is deliberately not repeated back.
  throw new Error('R2_BUCKET is not the development bucket. This test refuses to run against anything else.');
}

// Resolved once, at module load, so a missing or invalid public base refuses
// the whole run before a client is ever built — the same "before a single
// socket opens" guarantee as the two gates above.
const publicBase = parsePublicMediaBaseUrl(process.env);

describe('public delivery, against the real development bucket', () => {
  let storage: MediaStorage;
  let client: S3Client;
  let normalized: ImageNormalization;
  let key: string;
  let publicUrl: string;

  /** Set the moment a PUT succeeds: from here on there is something to clean up. */
  let uploaded = false;
  /** Set when a DELETE has been attempted, successfully or not. */
  let deleteAttempted = false;

  before(async () => {
    // A real image, produced by the real pipeline. Nothing is read from disk
    // and nothing arbitrary is uploaded wearing a .webp extension: these bytes
    // went through Sharp, were auto-oriented, stripped, resized and encoded by
    // the same code an administrator's upload will use.
    const png = await sharp({ create: { width: 40, height: 28, channels: 3, background: '#0f766e' } })
      .png()
      .toBuffer();

    const result = await normalizeImage(png, 'image/png');

    assert.equal(result.ok, true, 'the source image did not normalize locally; nothing was uploaded');
    assert.ok(result.ok);
    normalized = result.normalized;

    // The production identity helpers, so the object and its URL have the
    // shape a real one has. A fresh v4 UUID cannot collide with anything
    // already stored, and is never reused across runs.
    const reference = createMediaReference();

    key = mediaStorageKey(reference);
    // The production delivery helper composes the URL — never `base + key`
    // by hand, and never a storageKey taken from an HTTP response.
    publicUrl = composePublicMediaUrl(publicBase, reference);

    storage = createR2MediaStorage(process.env);
    client = new S3Client(r2ClientConfig(storageConfig));
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
          // the endpoint and the full public URL are not repeated here.
          throw new Error(`R2 delivery smoke cleanup failed. An object may remain at: ${key}`);
        }
      }
    } finally {
      client?.destroy();
    }
  });

  it('normalized a real image and composed a real delivery URL before touching the network', () => {
    assert.equal(normalized.contentType, 'image/webp');
    assert.ok(normalized.byteSize > 0);
    assert.equal(normalized.byteSize, normalized.body.length);
    assert.match(normalized.checksumSha256, /^[0-9a-f]{64}$/);
    assert.match(key, /^media\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/);

    // The URL ends in exactly the same key, composed through the production
    // helper — not asserted against the full URL, so nothing here needs to
    // print it.
    assert.ok(publicUrl.endsWith(`/${key}`));
    assert.equal(new URL(publicUrl).search, '');
    assert.equal(new URL(publicUrl).hash, '');
  });

  it('stores the object, verifies it through an unauthenticated public GET, then removes it', async () => {
    // 1. PUT, through the production adapter. Not bypassed: if this path is
    //    wrong, the real upload endpoint is wrong too.
    await storage.putObject({ key, body: normalized.body, contentType: normalized.contentType });
    uploaded = true;

    // 2. The real public request: no Authorization, no R2 credential, no
    //    cookie, no signed header — exactly what a guest's browser would send.
    //    `redirect: 'error'` means an unexpected redirect fails loudly rather
    //    than being followed silently.
    let response: Response;

    try {
      response = await fetch(publicUrl, { redirect: 'error' });
    } catch (error) {
      throw new Error(`public GET failed before a response was received: ${(error as Error).name}`);
    }

    assert.equal(response.status, 200, 'public GET status');
    assert.equal(response.headers.get('content-type'), 'image/webp', 'public GET content-type');
    assert.equal(response.headers.get('cache-control'), MEDIA_CACHE_CONTROL, 'public GET cache-control');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');

    const downloaded = Buffer.from(await response.arrayBuffer());

    // Byte-for-byte, then by digest. The bytes themselves are never printed;
    // only whether they matched.
    assert.equal(downloaded.length, normalized.byteSize, 'downloaded length');
    assert.ok(downloaded.equals(normalized.body), 'the publicly downloaded bytes differ from what was uploaded');
    assert.equal(
      createHash('sha256').update(downloaded).digest('hex'),
      normalized.checksumSha256,
      'the recorded checksum does not describe what the public URL returned',
    );

    // 3. DELETE, through the production adapter, for this key and no other.
    deleteAttempted = true;
    await storage.deleteObject(key);

    // 4. Authenticated origin confirmation ONLY — never a second public GET.
    //    The object is immutable and cached for a year at the edge, so a
    //    public GET after delete would prove nothing: a cached response can
    //    legitimately keep answering 200 long after the origin object is
    //    gone, and treating that as a failure would be testing Cloudflare's
    //    cache policy, not this system's delete path. Only a genuine
    //    authenticated not-found counts here; an authorization or network
    //    failure is a different problem wearing the same shape, and accepting
    //    it would turn this into a test that passes when the credentials stop
    //    working.
    let stillPresent = false;
    let absence: { name?: string; status?: number } = {};

    try {
      await client.send(new HeadObjectCommand({ Bucket: storageConfig.bucket, Key: key }));
      stillPresent = true;
    } catch (error) {
      const details = error as { name?: string; $metadata?: { httpStatusCode?: number } };

      absence = { name: details.name, status: details.$metadata?.httpStatusCode };
    }

    assert.equal(stillPresent, false, 'the object is still readable at the origin after being deleted');
    assert.ok(
      absence.status === 404 || absence.name === 'NotFound' || absence.name === 'NoSuchKey',
      `origin deletion was not confirmed by a not-found result (name=${absence.name ?? 'unknown'}, ` +
        `status=${absence.status ?? 'none'})`,
    );

    uploaded = false;
  });
});
