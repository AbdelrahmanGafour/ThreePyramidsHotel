import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Creating an admin-owned journey, without a database.
//
// The brochure reservation is the load-bearing part: an administrator taking
// one of the forty-two catalogue identities would either have their work
// overwritten by the next seed run or block it from inserting the offering it
// owns, and neither failure is visible when it is caused.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');
type BrochureModule = typeof import('../src/modules/admin-packages/admin-packages.brochure.js');
type CatalogueModule = typeof import('../src/db/seeds/packageCatalogue.js');

let __setQueryableForTests: RepositoryModule['__setQueryableForTests'];
let createAdminPackageHandler: ControllerModule['createAdminPackageHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];
let reservedBrochureIdentities: BrochureModule['reservedBrochureIdentities'];
let RESERVED_BROCHURE_IDENTITY_COUNT: BrochureModule['RESERVED_BROCHURE_IDENTITY_COUNT'];
let BROCHURE_PACKAGE_CATALOGUE: CatalogueModule['BROCHURE_PACKAGE_CATALOGUE'];

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setQueryableForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ createAdminPackageHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
  ({ reservedBrochureIdentities, RESERVED_BROCHURE_IDENTITY_COUNT } = await import(
    '../src/modules/admin-packages/admin-packages.brochure.js'
  ));
  ({ BROCHURE_PACKAGE_CATALOGUE } = await import('../src/db/seeds/packageCatalogue.js'));
});

afterEach(() => {
  __setQueryableForTests(null);
});

/** A valid create body, so each test varies only what it cares about. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    code: 'ADMIN-001',
    slug: 'a-new-journey',
    title: 'A New Journey',
    summary: 'Something the hotel put together.',
    description: 'A longer passage.',
    durationLabel: 'Half day',
    scheduleLabel: 'On request',
    operatingDays: ['monday', 'wednesday'],
    requiresPriceConfirmation: false,
    sortOrder: 0,
    ...overrides,
  };
}

/** The row the INSERT returns, reflecting what the statement actually wrote. */
function insertedRow(overrides: Record<string, unknown> = {}) {
  return {
    code: 'ADMIN-001',
    slug: 'a-new-journey',
    title: 'A New Journey',
    summary: 'Something the hotel put together.',
    duration_label: 'Half day',
    schedule_label: 'On request',
    requires_price_confirmation: false,
    is_active: false,
    sort_order: 0,
    seed_managed: false,
    description: 'A longer passage.',
    operating_days: ['monday', 'wednesday'],
    variant_count: 0,
    default_variant_label: null,
    // Selected by PACKAGE_DETAIL_COLUMNS now; a row without it is one
    // this repository would never produce. null is no image.
    image: null,
    itinerary: [],
    content: [],
    variants: [],
    ...overrides,
  };
}

type Recorded = { text: string; values: unknown[] | undefined };

function fakeQueryable(answer: (text: string, values: unknown[] | undefined) => unknown): Recorded[] {
  const calls: Recorded[] = [];

  __setQueryableForTests({
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      const rows = answer(text, values);
      if (rows instanceof Error) throw rows;
      return { rows } as never;
    },
  } as never);

  return calls;
}

/** A database that accepts the insert and echoes what it was told to write. */
function acceptingQueryable(): Recorded[] {
  return fakeQueryable((_text, values) =>
    [insertedRow({
      code: values?.[0],
      slug: values?.[1],
      title: values?.[2],
      operating_days: values?.[7],
      requires_price_confirmation: values?.[8],
      sort_order: values?.[9],
    })],
  );
}

/** A database that refuses with a real uniqueness violation. */
function conflictingQueryable(constraint: string): Recorded[] {
  return fakeQueryable(() =>
    Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint,
    }),
  );
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

async function create(requestBody: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await createAdminPackageHandler({ body: requestBody } as Request, res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;

const INVALID_BODY = { error: { code: 'INVALID_PACKAGE', message: 'Invalid package details' } };

describe('admin package create: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string; handle: unknown }> } }>;
    }).stack.find((entry) => entry.route?.path === '/' && entry.route.methods.post);

    assert.ok(layer?.route, 'POST / should be registered');

    const chain = layer.route.stack;
    assert.equal(chain[0].name, 'requireAdminSession', 'the guard must come first in the chain');
    assert.equal(chain.length, 2, 'the chain should be guard + handler and nothing else');

    const guard = chain[0].handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<void>;
    const { res, captured } = fakeResponse();
    let nextCalls = 0;

    await guard({ headers: {} } as Request, res, () => {
      nextCalls += 1;
    });

    assert.equal(captured.status, 401);
    assert.equal(nextCalls, 0, 'the handler must never run for an unauthenticated request');
  });
});

describe('admin package create: creating', () => {
  it('creates a journey as admin-managed and inactive', async () => {
    acceptingQueryable();

    const captured = await create(body());

    assert.equal(captured.status, 201);
    const created = dataOf(captured);
    assert.equal(created.managementSource, 'admin');
    assert.equal(created.isActive, false, 'a new journey is never published on creation');
    assert.equal(created.code, 'ADMIN-001');
    assert.equal(created.slug, 'a-new-journey');
    assert.equal(created.title, 'A New Journey');
  });

  it('writes is_active and seed_managed as literals the request cannot reach', async () => {
    const calls = acceptingQueryable();
    await create(body({ isActive: true, seedManaged: true, seed_managed: true, managementSource: 'brochure' }));

    const sql = calls[0]!.text;
    assert.match(sql, /is_active, seed_managed/);
    assert.match(sql, /\$10, false, false/, 'both are literals, not bound parameters');

    // Ten parameters, and none of them is a state the caller asked for.
    assert.equal(calls[0]!.values?.length, 10);
    assert.ok(!calls[0]!.values?.includes(true), 'no truthy state slipped into the values');
  });

  it('cannot be forced active or brochure-managed by the request body', async () => {
    acceptingQueryable();

    const captured = await create(body({ isActive: true, seedManaged: true }));

    const created = dataOf(captured);
    assert.equal(created.isActive, false);
    assert.equal(created.managementSource, 'admin');
  });

  it('creates the parent row only, with empty child collections', async () => {
    acceptingQueryable();

    const created = dataOf(await create(body()));

    assert.deepEqual(created.variants, []);
    assert.deepEqual(created.itinerary, []);
    assert.deepEqual(created.content, { included: [], excluded: [], notes: [] });
    assert.equal(created.variantCount, 0);
    assert.equal(created.defaultVariantLabel, null);
  });

  it('writes no child table', async () => {
    const calls = acceptingQueryable();
    await create(body());

    const writeHalf = calls[0]!.text.split('RETURNING')[0]!;
    for (const table of ['package_variants', 'package_rate_tiers',
      'package_itinerary_sections', 'package_content_items']) {
      assert.ok(!writeHalf.includes(table), `${table} must not be written by create`);
    }
  });

  it('costs one statement and returns the created row from it', async () => {
    const calls = acceptingQueryable();
    await create(body());

    assert.equal(calls.length, 1, 'one atomic statement');
    assert.match(calls[0]!.text, /WITH inserted AS \(/);
    assert.match(calls[0]!.text, /RETURNING \*/);
    assert.match(calls[0]!.text, /FROM inserted p/);
  });

  it('accepts a journey with no optional wording and no operating days', async () => {
    acceptingQueryable();

    const captured = await create(body({
      summary: null, description: null, durationLabel: null, scheduleLabel: null,
      operatingDays: null, requiresPriceConfirmation: true, sortOrder: 99,
    }));

    assert.equal(captured.status, 201);
  });
});

describe('admin package create: brochure identity protection', () => {
  it('reserves every authoritative brochure code', async () => {
    const { codes } = reservedBrochureIdentities();

    assert.equal(codes.length, RESERVED_BROCHURE_IDENTITY_COUNT);
    assert.equal(codes.length, 42, 'the brochure holds forty-two offerings');

    for (const code of codes) {
      const calls = acceptingQueryable();
      const captured = await create(body({ code }));

      assert.equal(captured.status, 409, `${code} must be reserved`);
      assert.deepEqual(captured.body, {
        error: {
          code: 'RESERVED_BROCHURE_PACKAGE_IDENTITY',
          message: 'That code or slug belongs to the brochure catalogue',
        },
      });
      assert.equal(calls.length, 0, 'a reserved identity must never reach the database');
    }
  });

  it('reserves every authoritative brochure slug', async () => {
    const { slugs } = reservedBrochureIdentities();

    assert.equal(slugs.length, RESERVED_BROCHURE_IDENTITY_COUNT);

    for (const slug of slugs) {
      const calls = acceptingQueryable();
      const captured = await create(body({ slug }));

      assert.equal(captured.status, 409, `${slug} must be reserved`);
      assert.equal(calls.length, 0);
    }
  });

  it('derives the reserved identities from the catalogue itself', async () => {
    // Not a second list: every reserved value is one the catalogue declares.
    const { codes, slugs } = reservedBrochureIdentities();
    const catalogueCodes = new Set(BROCHURE_PACKAGE_CATALOGUE.map((item) => item.code));
    const catalogueSlugs = new Set(BROCHURE_PACKAGE_CATALOGUE.map((item) => item.slug));

    assert.deepEqual(new Set(codes), catalogueCodes);
    assert.deepEqual(new Set(slugs), catalogueSlugs);
  });

  it('reserves an identity even when that brochure row is missing from the database', async () => {
    // The fake accepts everything, so only the pre-insert check can refuse.
    const calls = acceptingQueryable();
    const captured = await create(body({ code: BROCHURE_PACKAGE_CATALOGUE[0]!.code }));

    assert.equal(captured.status, 409);
    assert.equal(calls.length, 0, 'the claim holds whether or not the row exists');
  });

  it('compares exactly, so a different-cased value is a different identity', async () => {
    acceptingQueryable();
    const reserved = BROCHURE_PACKAGE_CATALOGUE[0]!.code;

    const captured = await create(body({ code: reserved.toLowerCase(), slug: 'not-reserved-at-all' }));

    // Lowercase is a genuinely different code the database would accept
    // alongside the real one; it is not silently treated as the brochure's.
    assert.equal(captured.status, reserved === reserved.toLowerCase() ? 409 : 201);
  });
});

describe('admin package create: conflicts', () => {
  it('maps a duplicate code to a clear 409, not a 500', async () => {
    conflictingQueryable('packages_code_key');

    const captured = await create(body());

    assert.equal(captured.status, 409);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_CODE_IN_USE', message: 'Another package already uses that code' },
    });
  });

  it('maps a duplicate slug to a clear 409, not a 500', async () => {
    conflictingQueryable('packages_slug_key');

    const captured = await create(body());

    assert.equal(captured.status, 409);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_SLUG_IN_USE', message: 'Another package already uses that slug' },
    });
  });

  it('keeps the three conflict kinds distinct', async () => {
    acceptingQueryable();
    const brochure = await create(body({ code: BROCHURE_PACKAGE_CATALOGUE[0]!.code }));
    conflictingQueryable('packages_code_key');
    const code = await create(body());
    conflictingQueryable('packages_slug_key');
    const slug = await create(body());

    assert.deepEqual([brochure.status, code.status, slug.status], [409, 409, 409]);
    assert.notDeepEqual(brochure.body, code.body);
    assert.notDeepEqual(code.body, slug.body);
  });

  it('lets any other database failure stay a server error', async () => {
    // A check violation is a real fault, not a conflict to translate.
    fakeQueryable(() =>
      Object.assign(new Error('new row violates check constraint'), { code: '23514' }),
    );
    const { res, captured } = fakeResponse();

    await assert.rejects(
      createAdminPackageHandler({ body: body() } as Request, res),
      /check constraint/,
    );
    assert.equal(captured.status, undefined, 'nothing was answered');
  });
});

describe('admin package create: validation', () => {
  it('rejects an invalid body with 400, without writing', async () => {
    const cases: unknown[] = [
      null,
      [],
      'a package',
      body({ code: '' }),
      body({ code: ' ADMIN-001' }),
      body({ code: 'ADMIN-001 ' }),
      body({ code: 42 }),
      body({ slug: 'Not A Slug' }),
      body({ slug: 'trailing-' }),
      body({ slug: '' }),
      body({ title: '' }),
      body({ title: '  padded  ' }),
      body({ title: null }),
      body({ summary: 7 }),
      body({ description: '' }),
      body({ operatingDays: [] }),
      body({ operatingDays: ['funday'] }),
      body({ operatingDays: ['monday', 'monday'] }),
      body({ operatingDays: 'monday' }),
      body({ requiresPriceConfirmation: 'true' }),
      body({ sortOrder: -1 }),
      body({ sortOrder: 1.5 }),
      body({ sortOrder: '0' }),
    ];

    for (const requestBody of cases) {
      const calls = acceptingQueryable();
      const captured = await create(requestBody);

      assert.equal(captured.status, 400, `${JSON.stringify(requestBody)} should be refused`);
      assert.deepEqual(captured.body, INVALID_BODY);
      assert.equal(calls.length, 0, 'an invalid body must never reach the database');
    }
  });

  it('rejects a body missing any required field', async () => {
    for (const field of ['code', 'slug', 'title', 'summary', 'description',
      'durationLabel', 'scheduleLabel', 'operatingDays', 'requiresPriceConfirmation', 'sortOrder']) {
      const incomplete = body();
      delete (incomplete as Record<string, unknown>)[field];

      const calls = acceptingQueryable();
      const captured = await create(incomplete);

      assert.equal(captured.status, 400, `a body without ${field} should be refused`);
      assert.equal(calls.length, 0);
    }
  });

  it('ignores unrecognised fields rather than writing them', async () => {
    const calls = acceptingQueryable();
    const captured = await create(body({ nonsense: 'ignored', id: '42' }));

    assert.equal(captured.status, 201);
    assert.equal(calls[0]!.values?.length, 10, 'only the ten accepted fields are bound');
    assert.ok(!calls[0]!.values?.includes('ignored'));
    assert.ok(!calls[0]!.values?.includes('42'));
  });
});

describe('admin package create: leakage', () => {
  it('exposes no internal database ids or raw ownership column', async () => {
    acceptingQueryable();

    const captured = await create(body());
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', '"packageId"', 'package_id', 'seed_managed', 'seedManaged',
      'created_at', 'createdAt', 'updated_at']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not reach an admin response`);
    }
  });

  it('answers with the same safe detail shape the read endpoints use', async () => {
    acceptingQueryable();

    const created = dataOf(await create(body()));

    assert.deepEqual(Object.keys(created).sort(), [
      'code',
      'content',
      'defaultVariantLabel',
      'description',
      'durationLabel',
      // The journey's one image, or null. Exact, not a subset: this list is
      // what keeps a storage key, an asset id or a checksum from reaching an
      // admin response by simply appearing.
      'image',
      'isActive',
      'itinerary',
      'managementSource',
      'operatingDays',
      'requiresPriceConfirmation',
      'scheduleLabel',
      'slug',
      'sortOrder',
      'summary',
      'title',
      'variantCount',
      'variants',
    ]);
  });
});
