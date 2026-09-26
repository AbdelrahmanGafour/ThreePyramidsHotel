import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Editing a journey, without a database.
//
// The ownership flip is the load-bearing part: the catalogue seed rewrites
// every field this endpoint writes, so an edit that did not take ownership
// would be undone on the next seed run — silently, and possibly weeks later.
// The fake below applies the statement to real state so the flip is observed
// rather than asserted against a stub.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');

let __setQueryableForTests: RepositoryModule['__setQueryableForTests'];
let updateAdminPackageHandler: ControllerModule['updateAdminPackageHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];

const SLUG = 'nile-dinner-cruise';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setQueryableForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ updateAdminPackageHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
});

afterEach(() => {
  __setQueryableForTests(null);
});

/** A valid edit body, so each test varies only what it cares about. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    title: 'A Renamed Journey',
    summary: 'A new summary.',
    description: 'A new description.',
    durationLabel: 'Full day',
    scheduleLabel: 'Weekends',
    operatingDays: ['saturday', 'sunday'],
    requiresPriceConfirmation: true,
    sortOrder: 5,
    ...overrides,
  };
}

/** The stored journey, as the UPDATE leaves it. */
function storedRow(state: {
  isActive: boolean;
  seedManaged: boolean;
  title: string;
  sortOrder: number;
}) {
  return {
    code: 'T016',
    slug: SLUG,
    title: state.title,
    summary: 'A new summary.',
    duration_label: 'Full day',
    schedule_label: 'Weekends',
    requires_price_confirmation: true,
    is_active: state.isActive,
    sort_order: state.sortOrder,
    seed_managed: state.seedManaged,
    description: 'A new description.',
    operating_days: ['saturday', 'sunday'],
    variant_count: 1,
    default_variant_label: 'Standard',
    itinerary: [],
    content: [],
    variants: [{
      key: 'standard', label: 'Standard', is_default: true, sort_order: 1,
      child_min_age: null, child_max_age: null, child_discount_percent: null,
      rates: [{ min_party_size: 1, max_party_size: null, adult_unit_rate: '100.00', currency: 'USD' }],
    }],
  };
}

type Recorded = { text: string; values: unknown[] | undefined };

/**
 * One stored journey whose state the UPDATE actually changes, mirroring the
 * real statement: matched on slug, `seed_managed` always driven to false,
 * `is_active`, `code` and `slug` never written.
 */
function storedPackage(options: { seedManaged?: boolean; isActive?: boolean; exists?: boolean } = {}) {
  const state = {
    seedManaged: options.seedManaged ?? true,
    isActive: options.isActive ?? true,
    exists: options.exists ?? true,
    code: 'T016',
    slug: SLUG,
    title: 'Nile Dinner Cruise',
    sortOrder: 16,
    writes: 0,
    calls: [] as Recorded[],
  };

  __setQueryableForTests({
    async query(text: string, values?: unknown[]) {
      state.calls.push({ text, values });

      if (!text.includes('UPDATE packages') || !state.exists || values?.[0] !== SLUG) {
        return { rows: [] } as never;
      }

      state.title = values[1] as string;
      state.sortOrder = values[8] as number;
      // The statement sets this literally; the fake honours that.
      state.seedManaged = false;
      state.writes += 1;

      return {
        rows: [storedRow({
          isActive: state.isActive,
          seedManaged: state.seedManaged,
          title: state.title,
          sortOrder: state.sortOrder,
        })],
      } as never;
    },
  } as never);

  return state;
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

const request = (slug: string, requestBody: unknown) =>
  ({ params: { slug }, body: requestBody }) as unknown as Request<{ slug: string }>;

async function edit(slug: string, requestBody: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await updateAdminPackageHandler(request(slug, requestBody), res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;

const INVALID_BODY = { error: { code: 'INVALID_PACKAGE', message: 'Invalid package details' } };

describe('admin package update: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string; handle: unknown }> } }>;
    }).stack.find((entry) => entry.route?.path === '/:slug' && entry.route.methods.patch);

    assert.ok(layer?.route, 'PATCH /:slug should be registered');

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

describe('admin package update: ownership', () => {
  it('takes ownership of a brochure-managed journey as it edits it', async () => {
    const stored = storedPackage({ seedManaged: true });

    const captured = await edit(SLUG, body());

    assert.equal(captured.status, 200);
    assert.equal(dataOf(captured).managementSource, 'admin');
    assert.equal(stored.seedManaged, false, 'the seed must stop reconciling it');
  });

  it('leaves an already admin-managed journey admin-managed', async () => {
    const stored = storedPackage({ seedManaged: false });

    const captured = await edit(SLUG, body());

    assert.equal(dataOf(captured).managementSource, 'admin');
    assert.equal(stored.seedManaged, false);
  });

  it('flips ownership in the same statement as the edit', async () => {
    const stored = storedPackage({ seedManaged: true });
    await edit(SLUG, body());

    assert.equal(stored.calls.length, 1, 'one atomic write, no read-then-write');
    const setClause = stored.calls[0]!.text.split('SET')[1]!.split('WHERE')[0]!;

    assert.match(setClause, /title = \$2/);
    assert.match(setClause, /seed_managed = false/,
      'an edit that did not take ownership would be undone by the next seed run');
    assert.match(setClause, /updated_at = now\(\)/);
  });

  it('always reports admin ownership after a successful edit', async () => {
    for (const seedManaged of [true, false]) {
      storedPackage({ seedManaged });
      assert.equal(dataOf(await edit(SLUG, body())).managementSource, 'admin');
    }
  });
});

describe('admin package update: write scope', () => {
  it('writes the eight editable fields and nothing else', async () => {
    const stored = storedPackage();
    await edit(SLUG, body());

    const setClause = stored.calls[0]!.text.split('SET')[1]!.split('WHERE')[0]!;

    for (const column of ['title', 'summary', 'description', 'duration_label',
      'schedule_label', 'operating_days', 'requires_price_confirmation', 'sort_order']) {
      assert.ok(setClause.includes(column), `${column} should be written`);
    }

    for (const column of ['is_active', 'code', 'slug']) {
      assert.ok(!setClause.includes(column), `${column} must never be written by an edit`);
    }
  });

  it('leaves publication untouched', async () => {
    for (const isActive of [true, false]) {
      const stored = storedPackage({ isActive });
      const captured = await edit(SLUG, body());

      assert.equal(dataOf(captured).isActive, isActive, 'an edit never publishes or withdraws');
      assert.equal(stored.isActive, isActive);
    }
  });

  it('leaves the code and slug untouched', async () => {
    const stored = storedPackage();
    const captured = await edit(SLUG, body());

    assert.equal(dataOf(captured).code, 'T016');
    assert.equal(dataOf(captured).slug, SLUG);
    assert.equal(stored.code, 'T016');
    assert.equal(stored.slug, SLUG);
  });

  it('touches no child table', async () => {
    const stored = storedPackage();
    await edit(SLUG, body());

    const writeHalf = stored.calls[0]!.text.split('RETURNING')[0]!;
    for (const table of ['package_variants', 'package_rate_tiers',
      'package_itinerary_sections', 'package_content_items', 'package_reservations']) {
      assert.ok(!writeHalf.includes(table), `${table} must not be written`);
    }
  });

  it('leaves the journey\'s variants and pricing exactly as they were', async () => {
    storedPackage();

    const detail = dataOf(await edit(SLUG, body()));
    const [variant] = detail.variants as Array<Record<string, unknown>>;

    assert.equal(detail.variantCount, 1);
    assert.equal(variant.label, 'Standard');
    assert.deepEqual(variant.rates, [
      { minPartySize: 1, maxPartySize: null, adultUnitRate: '100.00', currency: 'USD' },
    ]);
  });

  it('returns the updated row from the same statement that wrote it', async () => {
    const stored = storedPackage();
    await edit(SLUG, body());

    const sql = stored.calls[0]!.text;
    assert.match(sql, /WITH updated AS \(/);
    assert.match(sql, /RETURNING \*/);
    assert.match(sql, /FROM updated p/);
    assert.match(sql, /WHERE slug = \$1/);
  });

  it('applies the submitted values', async () => {
    storedPackage();

    const detail = dataOf(await edit(SLUG, body({ title: 'A Renamed Journey', sortOrder: 5 })));

    assert.equal(detail.title, 'A Renamed Journey');
    assert.equal(detail.sortOrder, 5);
  });
});

describe('admin package update: validation', () => {
  it('refuses a body offering identity, publication, ownership or a child resource', async () => {
    for (const forbidden of [
      { code: 'NEW-CODE' },
      { slug: 'a-new-address' },
      { isActive: true },
      { managementSource: 'brochure' },
      { seedManaged: true },
      { seed_managed: true },
      { variants: [] },
      { rates: [] },
      { itinerary: [] },
      { content: { included: [] } },
      { sortOrder: 5, code: 'NEW-CODE' },
    ]) {
      const stored = storedPackage();
      const captured = await edit(SLUG, body(forbidden));

      assert.equal(captured.status, 400, `${JSON.stringify(forbidden)} should be refused`);
      assert.deepEqual(captured.body, INVALID_BODY);
      assert.equal(stored.calls.length, 0, 'a refused field must never reach the database');
    }
  });

  it('refuses an unrecognised field rather than ignoring it', async () => {
    const stored = storedPackage();
    const captured = await edit(SLUG, body({ nonsense: 'ignored' }));

    // Silently dropping it would let an administrator believe it was applied.
    assert.equal(captured.status, 400);
    assert.equal(stored.calls.length, 0);
  });

  it('rejects an invalid value with 400, without writing', async () => {
    const cases: unknown[] = [
      null,
      [],
      'a package',
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
      body({ sortOrder: '5' }),
    ];

    for (const requestBody of cases) {
      const stored = storedPackage();
      const captured = await edit(SLUG, requestBody);

      assert.equal(captured.status, 400, `${JSON.stringify(requestBody)} should be refused`);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('requires every editable field, so an omission is never a silent keep', async () => {
    for (const field of ['title', 'summary', 'description', 'durationLabel',
      'scheduleLabel', 'operatingDays', 'requiresPriceConfirmation', 'sortOrder']) {
      const incomplete = body();
      delete (incomplete as Record<string, unknown>)[field];

      const stored = storedPackage();
      const captured = await edit(SLUG, incomplete);

      assert.equal(captured.status, 400, `a body without ${field} should be refused`);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('preserves an explicit null for every nullable field', async () => {
    const stored = storedPackage();
    await edit(SLUG, body({
      summary: null, description: null, durationLabel: null, scheduleLabel: null,
      operatingDays: null,
    }));

    const values = stored.calls[0]!.values!;
    assert.equal(values[2], null, 'summary');
    assert.equal(values[3], null, 'description');
    assert.equal(values[4], null, 'durationLabel');
    assert.equal(values[5], null, 'scheduleLabel');
    assert.equal(values[6], null, 'operatingDays');
  });

  it('rejects a malformed slug before the body or any write', async () => {
    const stored = storedPackage();
    const captured = await edit('NOT A SLUG', body({ sortOrder: -1 }));

    assert.equal(captured.status, 400);
    assert.deepEqual(captured.body, {
      error: { code: 'INVALID_PACKAGE_SLUG', message: 'Invalid package slug' },
    });
    assert.equal(stored.calls.length, 0);
  });
});

describe('admin package update: not found and failures', () => {
  it('answers 404 for a well-formed slug nothing matches', async () => {
    storedPackage({ exists: false });

    const captured = await edit(SLUG, body());

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
  });

  it('lets a database failure stay a server error', async () => {
    __setQueryableForTests({
      async query() {
        throw new Error('connection terminated unexpectedly');
      },
    } as never);
    const { res, captured } = fakeResponse();

    await assert.rejects(
      updateAdminPackageHandler(request(SLUG, body()), res),
      /connection terminated/,
    );
    assert.equal(captured.status, undefined, 'nothing was answered');
  });
});

describe('admin package update: leakage', () => {
  it('exposes no internal database ids or raw ownership column', async () => {
    storedPackage({ seedManaged: true });

    const captured = await edit(SLUG, body());
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', '"packageId"', '"variantId"', 'package_id', 'variant_id',
      'seed_managed', 'seedManaged', 'updated_at', 'updatedAt']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not reach an admin response`);
    }
  });
});
