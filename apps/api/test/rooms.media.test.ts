import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// The public room media read path, without a database.
//
// The repository's SQL is proved against real PostgreSQL in
// rooms.media.integration.test.ts; what is proved here is everything around
// it that a database could not show: how many queries a list costs, how rows
// are grouped onto rooms, which fields reach a response, and exactly when the
// public media base is — and is not — required.

type RepositoryModule = typeof import('../src/modules/rooms/rooms.repository.js');
type ControllerModule = typeof import('../src/modules/rooms/rooms.controller.js');

let findActiveRoomTypes: RepositoryModule['findActiveRoomTypes'];
let findActiveRoomTypeBySlug: RepositoryModule['findActiveRoomTypeBySlug'];
let __setQueryableForTests: RepositoryModule['__setQueryableForTests'];
let createListRoomTypesHandler: ControllerModule['createListRoomTypesHandler'];
let createGetRoomTypeBySlugHandler: ControllerModule['createGetRoomTypeBySlugHandler'];

before(async () => {
  // The module graph reaches db/pool, which requires DATABASE_URL at import
  // time. Nothing here connects or queries, so a placeholder is enough.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ findActiveRoomTypes, findActiveRoomTypeBySlug, __setQueryableForTests } = await import(
    '../src/modules/rooms/rooms.repository.js'
  ));
  ({ createListRoomTypesHandler, createGetRoomTypeBySlugHandler } = await import(
    '../src/modules/rooms/rooms.controller.js'
  ));
});

afterEach(() => {
  __setQueryableForTests(null);
});

const MEDIA_BASE = 'https://media.example.test';

/** A canonical reference, the only form `parseMediaReference` accepts. */
const reference = (): string => randomUUID();

function roomRow(id: string, slug: string) {
  return {
    id,
    slug,
    name: `Room ${slug}`,
    short_description: 'Short.',
    description: 'Long.',
    capacity: 2,
    bed_type: 'King',
    bed_count: 1,
    size_sqm: '32.00',
    view: 'Garden',
    base_nightly_rate: '2500.00',
  };
}

function imageRow(roomTypeId: string, overrides: Record<string, unknown> = {}) {
  return {
    room_type_id: roomTypeId,
    reference: reference(),
    alt_text: 'An image',
    width: 1600,
    height: 900,
    is_cover: false,
    ...overrides,
  };
}

type RecordedQuery = { text: string; values: unknown[] | undefined };

/**
 * A database handle that answers from a script and records every call, so a
 * test can assert on how many queries were issued as well as on the result.
 */
function fakeQueryable(answer: (text: string, values: unknown[] | undefined) => unknown[]) {
  const calls: RecordedQuery[] = [];

  const handle = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: answer(text, values) } as never;
    },
  };

  __setQueryableForTests(handle as never);

  return calls;
}

/** Routes each query to the right script by what it reads from. */
function scripted(rooms: unknown[], images: unknown[]) {
  return fakeQueryable((text) => (text.includes('FROM room_type_images') ? images : rooms));
}

type Captured = { status: number | undefined; body: unknown };

function fakeResponse(): { res: Response; captured: Captured } {
  const captured: Captured = { status: undefined, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;

  return { res, captured };
}

const baseProvider = () => MEDIA_BASE;

function dataOf(captured: Captured): Array<Record<string, unknown>> {
  return (captured.body as { data: Array<Record<string, unknown>> }).data;
}

describe('public room media: query strategy', () => {
  it('costs two queries for a multi-room list, never one per room', async () => {
    const rooms = [roomRow('1', 'a'), roomRow('2', 'b'), roomRow('3', 'c')];
    const images = [imageRow('1'), imageRow('2'), imageRow('3'), imageRow('1')];
    const calls = scripted(rooms, images);

    const result = await findActiveRoomTypes();

    assert.equal(result.length, 3);
    assert.equal(calls.length, 2, 'a list must cost exactly two queries whatever the room count');

    const imageQuery = calls[1];
    assert.match(imageQuery.text, /FROM room_type_images/);
    // One query carrying every id, not one query per id.
    assert.deepEqual(imageQuery.values, [['1', '2', '3']]);
    assert.match(imageQuery.text, /= ANY\(\$1::bigint\[\]\)/);
  });

  it('does not query for images at all when no room types are active', async () => {
    const calls = scripted([], []);

    assert.deepEqual(await findActiveRoomTypes(), []);
    assert.equal(calls.length, 1, 'an empty roster has nothing to ask about');
  });

  it('reuses the admin gallery ordering clause exactly', async () => {
    const calls = scripted([roomRow('1', 'a')], []);
    await findActiveRoomTypes();

    assert.match(
      calls[1].text,
      /ORDER BY rti\.is_cover DESC, rti\.sort_order ASC, rti\.id ASC/,
      'the public gallery order must be the same clause the admin path uses',
    );
  });

  it('groups images onto their own room and keeps each room\'s row order', async () => {
    const [first, second, third] = [reference(), reference(), reference()];
    const rooms = [roomRow('1', 'a'), roomRow('2', 'b')];
    // Interleaved on purpose: the rows arrive in gallery order overall, not
    // grouped by room, which is exactly what the ORDER BY clause produces.
    const images = [
      imageRow('1', { reference: first, is_cover: true }),
      imageRow('2', { reference: second, is_cover: true }),
      imageRow('1', { reference: third }),
    ];
    scripted(rooms, images);

    const [roomA, roomB] = await findActiveRoomTypes();

    assert.deepEqual(
      roomA.images.map((image) => image.reference),
      [first, third],
      'room A keeps the relative order its rows arrived in',
    );
    assert.deepEqual(
      roomB.images.map((image) => image.reference),
      [second],
    );
  });

  it('loads images for the detail endpoint and returns null for an unknown slug', async () => {
    scripted([roomRow('7', 'demo-suite')], [imageRow('7', { is_cover: true })]);
    const found = await findActiveRoomTypeBySlug('demo-suite');
    assert.equal(found?.images.length, 1);

    scripted([], []);
    assert.equal(await findActiveRoomTypeBySlug('nope'), null);
  });
});

describe('public room media: response shape', () => {
  it('exposes exactly five image fields and no internal ones', async () => {
    scripted([roomRow('1', 'demo-suite')], [imageRow('1', { is_cover: true })]);
    const { res, captured } = fakeResponse();

    await createListRoomTypesHandler(baseProvider)({} as Request, res, () => {});

    const [image] = dataOf(captured)[0].images as Array<Record<string, unknown>>;
    assert.deepEqual(Object.keys(image).sort(), ['altText', 'height', 'isCover', 'url', 'width']);

    // Named explicitly as well, so this fails loudly if one is ever added.
    for (const leaked of [
      'id',
      'roomTypeId',
      'mediaAssetId',
      'storageKey',
      'storage_key',
      'checksumSha256',
      'checksum_sha256',
      'contentType',
      'sortOrder',
      'bucket',
      'createdAt',
      'updatedAt',
    ]) {
      assert.equal(image[leaked], undefined, `${leaked} must not reach a public response`);
    }
  });

  it('composes the url from the configured base and the stored reference', async () => {
    const only = reference();
    scripted([roomRow('1', 'demo-suite')], [imageRow('1', { reference: only, is_cover: true })]);
    const { res, captured } = fakeResponse();

    await createListRoomTypesHandler(baseProvider)({} as Request, res, () => {});

    const [image] = dataOf(captured)[0].images as Array<Record<string, unknown>>;
    assert.equal(image.url, `${MEDIA_BASE}/media/${only}.webp`);
    assert.equal(captured.status, 200);
  });

  it('serves the detail endpoint with its images', async () => {
    scripted([roomRow('4', 'demo-deluxe')], [imageRow('4', { is_cover: true }), imageRow('4')]);
    const { res, captured } = fakeResponse();

    await createGetRoomTypeBySlugHandler(baseProvider)(
      { params: { slug: 'demo-deluxe' } } as unknown as Request,
      res,
      () => {},
    );

    assert.equal(captured.status, 200);
    const room = (captured.body as { data: Record<string, unknown> }).data;
    assert.equal((room.images as unknown[]).length, 2);
  });
});

describe('public room media: configuration', () => {
  it('serves a room with no media as images: [] without reading the media base', async () => {
    scripted([roomRow('1', 'demo-standard')], []);
    const { res, captured } = fakeResponse();

    let providerCalls = 0;
    const provider = () => {
      providerCalls += 1;
      throw new Error('R2_PUBLIC_BASE_URL must be set');
    };

    await createListRoomTypesHandler(provider)({} as Request, res, () => {});

    assert.equal(captured.status, 200);
    assert.deepEqual(dataOf(captured)[0].images, []);
    assert.equal(providerCalls, 0, 'a room with no images must not require media configuration');
  });

  it('resolves the media base once per request, not once per image', async () => {
    scripted(
      [roomRow('1', 'a'), roomRow('2', 'b')],
      [imageRow('1'), imageRow('1'), imageRow('2')],
    );
    const { res } = fakeResponse();

    let providerCalls = 0;
    await createListRoomTypesHandler(() => {
      providerCalls += 1;
      return MEDIA_BASE;
    })({} as Request, res, () => {});

    assert.equal(providerCalls, 1);
  });

  it('propagates a media configuration error instead of reporting images: []', async () => {
    scripted([roomRow('1', 'demo-suite')], [imageRow('1', { is_cover: true })]);
    const { res, captured } = fakeResponse();

    const failing = () => {
      throw new Error('R2_PUBLIC_BASE_URL must be set');
    };

    await assert.rejects(
      createListRoomTypesHandler(failing)({} as Request, res, () => {}) as Promise<void>,
      /R2_PUBLIC_BASE_URL/,
    );
    // The half that matters: no answer was sent. A misconfigured deployment
    // must not look like a room that simply has no pictures.
    assert.equal(captured.status, undefined);
    assert.equal(captured.body, undefined);
  });

  it('propagates the same error from the detail endpoint', async () => {
    scripted([roomRow('1', 'demo-suite')], [imageRow('1', { is_cover: true })]);
    const { res, captured } = fakeResponse();

    await assert.rejects(
      createGetRoomTypeBySlugHandler(() => {
        throw new Error('R2_PUBLIC_BASE_URL must be an absolute https:// URL');
      })({ params: { slug: 'demo-suite' } } as unknown as Request, res, () => {}) as Promise<void>,
      /R2_PUBLIC_BASE_URL/,
    );
    assert.equal(captured.status, undefined);
  });

  it('rejects a non-canonical stored reference without naming it', async () => {
    scripted([roomRow('1', 'demo-suite')], [imageRow('1', { reference: 'not-a-uuid' })]);
    const { res } = fakeResponse();

    await assert.rejects(
      createListRoomTypesHandler(baseProvider)({} as Request, res, () => {}) as Promise<void>,
      (error: Error) => {
        assert.match(error.message, /not canonical/);
        assert.ok(!error.message.includes('not-a-uuid'), 'the value must not be echoed');
        return true;
      },
    );
  });
});
