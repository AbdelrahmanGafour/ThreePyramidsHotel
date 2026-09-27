import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { runner } from 'node-pg-migrate';
import sharp from 'sharp';

// A journey's image as a guest sees it, over real HTTP against real
// PostgreSQL.
//
// The unit suite proves the mapping and the URL composition; this proves the
// join. Specifically that `LEFT JOIN package_media` cannot multiply a
// journey into several catalogue rows, that a journey with no image really
// does project `null` rather than being dropped, and that what the admin
// endpoints write is what the public endpoints read on the very next
// request.
//
// Storage is an in-memory double and the public media base is injected.
// **Nothing here contacts R2**, and no R2 variable is read: `createApp`
// takes both providers, which is what that seam exists for.

// Uses the dedicated migrated disposable cluster, never hotel development.
const target = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(process.env.PACKAGES_DISPOSABLE_TEST, '1');
assert.equal(target.hostname, '127.0.0.1');
assert.ok(target.port === '5434' || target.port === '55432');
assert.equal(target.pathname, '/hotel_reservation_packages_test');
assert.equal(target.search, '');

type Pool = typeof import('../src/db/pool.js');
type ServiceModule = typeof import('../src/modules/admin-package-media/admin-package-media.service.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let uploadPackageImage: ServiceModule['uploadPackageImage'];
let replacePackageImage: ServiceModule['replacePackageImage'];
let deletePackageImage: ServiceModule['deletePackageImage'];
let updatePackageImageAltText: ServiceModule['updatePackageImageAltText'];

const BASE = 'https://media.example.test';
const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-PUBIMG-${runId}`;
const slugPrefix = `itest-pubimg-${runId}`;

let server: Server | undefined;
let baseUrl: string;
let jpegBody: Buffer;
let sequence = 0;

/** An in-memory `MediaStorage`. No network, no SDK, no R2. */
const storage = {
  async putObject() {},
  async deleteObject() {},
} as never;

async function createJourney(options: { isActive?: boolean } = {}): Promise<{
  packageId: string;
  slug: string;
}> {
  sequence += 1;
  const slug = `${slugPrefix}-${sequence}`;

  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO packages (code, slug, title, is_active, sort_order, seed_managed)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id`,
    [`${codePrefix}-${sequence}`, slug, `Public image fixture ${sequence}`, options.isActive ?? true, sequence],
  );

  return { packageId: rows[0]!.id, slug };
}

type PublicImage = { url: string; altText: string | null; width: number; height: number } | null;
type PublicCard = { slug: string; image: PublicImage };

async function catalogue(): Promise<PublicCard[]> {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: PublicCard[] };

  // Only this run's journeys; the disposable database may hold others.
  return body.data.filter((card) => card.slug.startsWith(slugPrefix));
}

async function detail(slug: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}/${slug}`);

  return { status: response.status, body: await response.json() };
}

before(async () => {
  await runner({
    databaseUrl: process.env.DATABASE_URL!,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    dir: path.resolve(__dirname, '../src/db/migrations'),
    log: () => undefined,
  });

  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  ({ uploadPackageImage, replacePackageImage, deletePackageImage, updatePackageImageAltText } =
    await import('../src/modules/admin-package-media/admin-package-media.service.js'));

  jpegBody = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 60, b: 90 } },
  })
    .jpeg()
    .toBuffer();

  // Both providers injected: the app never reads an R2 variable, and no
  // storage client is ever constructed.
  const { createApp } = await import('../src/app.js');
  server = await new Promise<Server>((resolve) => {
    const listening = createApp({
      mediaStorageProvider: () => storage,
      publicMediaBaseUrlProvider: () => BASE,
    }).listen(0, '127.0.0.1', () => resolve(listening));
  });

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/packages`;
});

after(async () => {
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
    await dbPool.query('DELETE FROM media_assets WHERE id = ANY($1::bigint[])', [
      assetRows.map((row) => row.media_asset_id),
    ]);
  }

  await dbPool.query('DELETE FROM packages WHERE code LIKE $1', [`${codePrefix}%`]);

  const { rows } = await dbPool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM packages WHERE code LIKE $1',
    [`${codePrefix}%`],
  );
  assert.equal(rows[0]!.n, 0, 'every fixture this run created was removed');

  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });

  await closeDatabasePool();
});

const upload = (slug: string) =>
  uploadPackageImage({ storage }, { slug, declaredContentType: 'image/jpeg', body: jpegBody });

describe('public journey catalogue: the image', () => {
  it('projects null for a journey with no image, and never drops it', async () => {
    const journey = await createJourney();

    const cards = await catalogue();
    const card = cards.find((entry) => entry.slug === journey.slug)!;

    assert.ok(card, 'a journey with no image is still in the catalogue');
    assert.equal(card.image, null);
    assert.ok('image' in card, 'the key is present, so null is distinguishable from absent');
  });

  it('projects exactly four fields for a journey with one', async () => {
    const journey = await createJourney();
    await upload(journey.slug);
    await updatePackageImageAltText({ slug: journey.slug, altText: 'Dawn over the plateau' });

    const card = (await catalogue()).find((entry) => entry.slug === journey.slug)!;

    assert.deepEqual(Object.keys(card.image!).sort(), ['altText', 'height', 'url', 'width']);
    assert.equal(card.image!.altText, 'Dawn over the plateau');
    assert.equal(card.image!.width, 64);
    assert.equal(card.image!.height, 48);
    assert.match(card.image!.url, new RegExp(`^${BASE}/media/[0-9a-f-]{36}\\.webp$`));
  });

  it('returns one row per journey, whatever its media', async () => {
    // The whole point of the 0-or-1 LEFT JOIN: `package_media` is UNIQUE on
    // `package_id`, so a journey with an image cannot appear twice.
    const withImage = await createJourney();
    const withoutImage = await createJourney();
    await upload(withImage.slug);

    const cards = await catalogue();
    const slugs = cards.map((card) => card.slug);

    assert.equal(new Set(slugs).size, slugs.length, 'no journey appears more than once');
    assert.equal(cards.filter((card) => card.slug === withImage.slug).length, 1);
    assert.equal(cards.filter((card) => card.slug === withoutImage.slug).length, 1);
  });

  it('still excludes an inactive journey, image or not', async () => {
    const hidden = await createJourney({ isActive: false });

    // Uploading is allowed for an inactive journey; being in the catalogue
    // is not, and the join must not have changed that.
    await upload(hidden.slug);

    assert.equal((await catalogue()).some((card) => card.slug === hidden.slug), false);
    assert.equal((await detail(hidden.slug)).status, 404);
  });

  it('keeps the catalogue ordered by sort_order as it always was', async () => {
    const cards = await catalogue();
    const positions = await dbPool.query<{ slug: string; sort_order: number }>(
      'SELECT slug, sort_order FROM packages WHERE code LIKE $1 AND is_active = true ORDER BY sort_order, id',
      [`${codePrefix}%`],
    );

    assert.deepEqual(
      cards.map((card) => card.slug),
      positions.rows.map((row) => row.slug),
    );
  });
});

describe('public journey detail: the image', () => {
  it('projects null when there is none, alongside everything else', async () => {
    const journey = await createJourney();

    const { status, body } = await detail(journey.slug);
    const data = (body as { data: PublicCard & { variants: unknown[]; itinerary: unknown[] } }).data;

    assert.equal(status, 200);
    assert.equal(data.image, null);
    // The projection the detail already had is untouched.
    assert.deepEqual(data.variants, []);
    assert.deepEqual(data.itinerary, []);
  });

  it('projects the same image the catalogue shows', async () => {
    const journey = await createJourney();
    await upload(journey.slug);

    const card = (await catalogue()).find((entry) => entry.slug === journey.slug)!;
    const { body } = await detail(journey.slug);
    const data = (body as { data: PublicCard }).data;

    assert.deepEqual(data.image, card.image, 'one image, one shape, wherever it is read');
  });

  it('exposes no internal media field', async () => {
    const journey = await createJourney();
    await upload(journey.slug);

    const { body } = await detail(journey.slug);
    const serialised = JSON.stringify(body);

    for (const leaked of [
      '"reference"',
      'storage_key',
      'storageKey',
      'media_asset_id',
      'mediaAssetId',
      'checksum',
      'content_type',
      'contentType',
      'byte_size',
      'byteSize',
      'bucket',
      'package_media',
    ]) {
      assert.ok(!serialised.includes(leaked), `${leaked} must not reach a guest`);
    }
  });
});

describe('public journey image: reads follow writes', () => {
  it('shows a replacement on the very next request', async () => {
    const journey = await createJourney();
    await upload(journey.slug);
    await updatePackageImageAltText({ slug: journey.slug, altText: 'Before' });

    const before = (await detail(journey.slug)).body as { data: PublicCard };

    const replaced = await replacePackageImage(
      { storage },
      { slug: journey.slug, declaredContentType: 'image/jpeg', body: jpegBody },
    );
    assert.equal(replaced.outcome, 'replaced');

    const after = (await detail(journey.slug)).body as { data: PublicCard };

    assert.notEqual(after.data.image!.url, before.data.image!.url, 'a new object, a new URL');
    assert.equal(after.data.image!.altText, 'Before', 'and the description survived');
  });

  it('shows a new description on the very next request', async () => {
    const journey = await createJourney();
    await upload(journey.slug);

    await updatePackageImageAltText({ slug: journey.slug, altText: 'Written now' });
    const described = (await detail(journey.slug)).body as { data: PublicCard };
    assert.equal(described.data.image!.altText, 'Written now');

    await updatePackageImageAltText({ slug: journey.slug, altText: null });
    const cleared = (await detail(journey.slug)).body as { data: PublicCard };
    assert.equal(cleared.data.image!.altText, null);
  });

  it('returns to null on the very next request after a delete', async () => {
    const journey = await createJourney();
    await upload(journey.slug);

    assert.notEqual(((await detail(journey.slug)).body as { data: PublicCard }).data.image, null);

    const deleted = await deletePackageImage({ storage }, { slug: journey.slug });
    assert.equal(deleted.outcome, 'deleted');

    const after = (await detail(journey.slug)).body as { data: PublicCard };
    assert.equal(after.data.image, null, 'and never a stale URL');

    const card = (await catalogue()).find((entry) => entry.slug === journey.slug)!;
    assert.equal(card.image, null);
  });
});

describe('admin journey detail: the image', () => {
  let findAdminPackageBySlug: typeof import('../src/modules/admin-packages/admin-packages.repository.js')['findAdminPackageBySlug'];
  let toAdminPackageDetail: typeof import('../src/modules/admin-packages/admin-packages.projection.js')['toAdminPackageDetail'];

  before(async () => {
    ({ findAdminPackageBySlug } = await import(
      '../src/modules/admin-packages/admin-packages.repository.js'
    ));
    ({ toAdminPackageDetail } = await import(
      '../src/modules/admin-packages/admin-packages.projection.js'
    ));
  });

  /**
   * The real path a request takes: the repository reads the row, and the
   * projection turns its media reference into a URL. The base is passed in,
   * so no R2 variable is read and no configuration is required.
   */
  const adminDetail = async (slug: string) => {
    const record = await findAdminPackageBySlug(slug);

    return record === null ? null : toAdminPackageDetail(record, () => BASE);
  };

  it('answers null for a journey with no media row', async () => {
    const journey = await createJourney();

    const detail = (await adminDetail(journey.slug))!;

    assert.equal(detail.image, null);
    // And the rest of the detail is exactly what it always was.
    assert.equal(detail.slug, journey.slug);
    assert.equal(detail.managementSource, 'brochure');
    assert.deepEqual(detail.variants, []);
    assert.deepEqual(detail.itinerary, []);
  });

  it('answers with the five-field image for a journey that has one', async () => {
    const journey = await createJourney();
    await upload(journey.slug);
    await updatePackageImageAltText({ slug: journey.slug, altText: 'Dawn over the plateau' });

    const detail = (await adminDetail(journey.slug))!;
    const image = detail.image!;

    assert.deepEqual(Object.keys(image).sort(), ['altText', 'height', 'reference', 'url', 'width']);
    assert.equal(image.altText, 'Dawn over the plateau');
    assert.equal(image.width, 64);
    assert.equal(image.height, 48);
    assert.match(image.reference, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(image.url, `${BASE}/media/${image.reference}.webp`);
  });

  it('reflects a new description on the next read', async () => {
    const journey = await createJourney();
    await upload(journey.slug);

    await updatePackageImageAltText({ slug: journey.slug, altText: 'Written now' });
    assert.equal((await adminDetail(journey.slug))!.image!.altText, 'Written now');

    await updatePackageImageAltText({ slug: journey.slug, altText: null });
    assert.equal((await adminDetail(journey.slug))!.image!.altText, null);
  });

  it('reflects a replacement on the next read', async () => {
    const journey = await createJourney();
    await upload(journey.slug);

    const before = (await adminDetail(journey.slug))!.image!;

    await replacePackageImage(
      { storage },
      { slug: journey.slug, declaredContentType: 'image/jpeg', body: jpegBody },
    );

    const after = (await adminDetail(journey.slug))!.image!;

    assert.notEqual(after.reference, before.reference, 'a new asset, a new reference');
    assert.notEqual(after.url, before.url, 'and a new URL');
  });

  it('returns to null on the next read after a delete', async () => {
    const journey = await createJourney();
    await upload(journey.slug);

    assert.notEqual((await adminDetail(journey.slug))!.image, null);

    await deletePackageImage({ storage }, { slug: journey.slug });

    assert.equal((await adminDetail(journey.slug))!.image, null, 'never a stale URL');
  });

  it('exposes no internal media metadata', async () => {
    const journey = await createJourney();
    await upload(journey.slug);

    const serialized = JSON.stringify(await adminDetail(journey.slug));

    for (const leaked of [
      'storage_key',
      'storageKey',
      'media_asset_id',
      'mediaAssetId',
      'package_media',
      'checksum',
      'content_type',
      'contentType',
      'byte_size',
      'byteSize',
      'bucket',
    ]) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not reach an admin response`);
    }
  });

  it('leaves every other detail field intact beside the image', async () => {
    const journey = await createJourney();

    const before = (await adminDetail(journey.slug))!;
    await upload(journey.slug);
    const after = (await adminDetail(journey.slug))!;

    const { image: _absent, ...restBefore } = before;
    const { image: _present, ...restAfter } = after;

    assert.deepEqual(restAfter, restBefore, 'adding an image changes nothing else');
    assert.equal(after.image !== null, true);
  });

  it('serves the image of an inactive journey, unlike the public catalogue', async () => {
    const journey = await createJourney({ isActive: false });
    await upload(journey.slug);

    const detail = (await adminDetail(journey.slug))!;

    assert.equal(detail.isActive, false);
    assert.notEqual(detail.image, null, 'an administrator manages retired offerings too');
  });
});
