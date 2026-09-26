import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// The admin package catalogue list, without a database.
//
// The route's guard is exercised for real: `requireAdminSession` answers 401
// on a request with no session cookie before it ever reaches the database.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');

let __setQueryableForTests: RepositoryModule['__setQueryableForTests'];
let listAdminPackagesHandler: ControllerModule['listAdminPackagesHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];

before(async () => {
  // The module graph reaches db/pool, which requires DATABASE_URL at import
  // time. Nothing here connects or queries, so a placeholder is enough.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setQueryableForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ listAdminPackagesHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
});

afterEach(() => {
  __setQueryableForTests(null);
});

/** One stored row, so each test varies only what it cares about. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    code: 'T001',
    slug: 'tour-to-giza-pyramids-and-sphinx',
    title: 'Tour to Giza Pyramids and Sphinx',
    summary: null,
    duration_label: 'Half day',
    schedule_label: 'Daily',
    requires_price_confirmation: false,
    is_active: true,
    sort_order: 1,
    seed_managed: true,
    variant_count: 2,
    default_variant_label: 'Standard',
    ...overrides,
  };
}

type RecordedQuery = { text: string; values: unknown[] | undefined };

function fakeQueryable(rows: unknown[]): RecordedQuery[] {
  const calls: RecordedQuery[] = [];

  __setQueryableForTests({
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows } as never;
    },
  } as never);

  return calls;
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

function packagesOf(captured: Captured): Array<Record<string, unknown>> {
  return (captured.body as { data: { packages: Array<Record<string, unknown>> } }).data.packages;
}

async function listWith(rows: unknown[]): Promise<Captured> {
  fakeQueryable(rows);
  const { res, captured } = fakeResponse();
  await listAdminPackagesHandler({} as Request, res);
  return captured;
}

describe('admin package list: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{ route?: { path: string; stack: Array<{ name: string; handle: unknown }> } }>;
    }).stack.find((entry) => entry.route?.path === '/');

    assert.ok(layer?.route, 'GET / should be registered');
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

describe('admin package list: reading', () => {
  it('returns the catalogue for an authenticated request', async () => {
    const captured = await listWith([row()]);

    assert.equal(captured.status, 200);
    assert.deepEqual(packagesOf(captured)[0], {
      code: 'T001',
      slug: 'tour-to-giza-pyramids-and-sphinx',
      title: 'Tour to Giza Pyramids and Sphinx',
      summary: null,
      durationLabel: 'Half day',
      scheduleLabel: 'Daily',
      requiresPriceConfirmation: false,
      isActive: true,
      sortOrder: 1,
      managementSource: 'brochure',
      variantCount: 2,
      defaultVariantLabel: 'Standard',
    });
  });

  it('returns a successful empty array for an empty catalogue', async () => {
    const captured = await listWith([]);

    assert.equal(captured.status, 200);
    assert.deepEqual(captured.body, { data: { packages: [] } });
  });

  it('orders by running order, with code breaking ties', async () => {
    const calls = fakeQueryable([]);
    const { res } = fakeResponse();
    await listAdminPackagesHandler({} as Request, res);

    assert.match(calls[0].text, /ORDER BY p\.sort_order ASC, p\.code ASC/);
  });

  it('preserves the order the database returned, without re-sorting in code', async () => {
    const captured = await listWith([
      row({ code: 'T001', sort_order: 1 }),
      row({ code: 'P01', sort_order: 2 }),
      row({ code: 'P02', sort_order: 2 }),
    ]);

    assert.deepEqual(
      packagesOf(captured).map((item) => item.code),
      ['T001', 'P01', 'P02'],
    );
  });

  it('keeps inactive offerings in the list, marked as such', async () => {
    const captured = await listWith([
      row({ code: 'T001', is_active: true }),
      row({ code: 'T002', is_active: false }),
    ]);

    assert.deepEqual(
      packagesOf(captured).map((item) => item.isActive),
      [true, false],
      'an administrator sees retired offerings; a guest does not',
    );
  });

  it('carries the confirmation-required flag through unchanged', async () => {
    const captured = await listWith([
      row({ code: 'T001', requires_price_confirmation: false }),
      row({ code: 'P09', requires_price_confirmation: true }),
    ]);

    assert.deepEqual(
      packagesOf(captured).map((item) => item.requiresPriceConfirmation),
      [false, true],
    );
  });

  it('summarises variants without listing them', async () => {
    const captured = await listWith([
      row({ code: 'T001', variant_count: 1, default_variant_label: 'Standard' }),
      row({ code: 'T016', variant_count: 3, default_variant_label: 'Premium service' }),
      row({ code: 'NEW', variant_count: 0, default_variant_label: null }),
    ]);

    assert.deepEqual(
      packagesOf(captured).map((item) => [item.variantCount, item.defaultVariantLabel]),
      [[1, 'Standard'], [3, 'Premium service'], [0, null]],
    );
  });
});

describe('admin package list: ownership', () => {
  it('reports the storage boolean as an admin-facing source', async () => {
    const captured = await listWith([
      row({ code: 'T001', seed_managed: true }),
      row({ code: 'ADMIN-1', seed_managed: false }),
    ]);

    assert.deepEqual(
      packagesOf(captured).map((item) => item.managementSource),
      ['brochure', 'admin'],
    );
  });

  it('never exposes the raw column name or a bare boolean', async () => {
    const captured = await listWith([row({ seed_managed: false })]);
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['seed_managed', 'seedManaged']) {
      assert.ok(!serialized.includes(leaked), `${leaked} is storage detail, not contract`);
    }
    assert.equal(packagesOf(captured)[0].managementSource, 'admin');
  });
});

describe('admin package list: query strategy', () => {
  it('costs one query whatever the catalogue holds', async () => {
    const calls = fakeQueryable(
      Array.from({ length: 42 }, (_, index) => row({ code: `T${index}`, sort_order: index + 1 })),
    );
    const { res, captured } = fakeResponse();
    await listAdminPackagesHandler({} as Request, res);

    assert.equal(packagesOf(captured).length, 42);
    assert.equal(calls.length, 1, 'never one query per package');
    assert.equal(calls[0].values, undefined, 'the list takes no parameters yet');
  });

  it('summarises variants by aggregate rather than a lookup per package', async () => {
    const calls = fakeQueryable([]);
    const { res } = fakeResponse();
    await listAdminPackagesHandler({} as Request, res);

    const sql = calls[0].text;
    assert.match(sql, /LEFT JOIN package_variants/, 'a package with no variants still appears');
    assert.match(sql, /COUNT\(pv\.id\)::int AS variant_count/, 'COUNT(*) would call zero variants one');
    assert.match(sql, /GROUP BY p\.id/);
  });

  it('reads no price, itinerary or content', async () => {
    const calls = fakeQueryable([]);
    const { res } = fakeResponse();
    await listAdminPackagesHandler({} as Request, res);

    for (const table of [
      'package_rate_tiers',
      'package_itinerary_sections',
      'package_content_items',
      'package_reservations',
    ]) {
      assert.ok(!calls[0].text.includes(table), `${table} has no place in a catalogue list`);
    }
  });
});

describe('admin package list: leakage and stored data', () => {
  it('exposes no internal database ids', async () => {
    // Ids the query does not select, offered anyway: nothing may carry them
    // through just because the row happened to have them.
    const captured = await listWith([row({ id: '42', package_id: '42' })]);
    const [item] = packagesOf(captured);

    assert.deepEqual(Object.keys(item).sort(), [
      'code',
      'defaultVariantLabel',
      'durationLabel',
      'isActive',
      'managementSource',
      'requiresPriceConfirmation',
      'scheduleLabel',
      'slug',
      'sortOrder',
      'summary',
      'title',
      'variantCount',
    ]);

    const serialized = JSON.stringify(captured.body);
    for (const leaked of ['"id"', '"packageId"', 'package_id']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not reach an admin response`);
    }
  });

  it('keeps detail-only fields out of the list', async () => {
    const captured = await listWith([
      row({ description: 'A long passage.', operating_days: ['mon'], created_at: new Date() }),
    ]);
    const [item] = packagesOf(captured);

    for (const field of ['description', 'operatingDays', 'createdAt', 'updatedAt']) {
      assert.equal(item[field], undefined, `${field} belongs to a detail view, not the list`);
    }
  });

  it('raises rather than serving stored data the schema says cannot exist', async () => {
    for (const [override, expected] of [
      [{ is_active: null }, /is_active/],
      [{ requires_price_confirmation: 'yes' }, /requires_price_confirmation/],
      [{ seed_managed: null }, /seed_managed/],
      [{ sort_order: -1 }, /sort_order/],
      [{ variant_count: 1.5 }, /variant_count/],
    ] as Array<[Record<string, unknown>, RegExp]>) {
      fakeQueryable([row(override)]);
      const { res } = fakeResponse();
      await assert.rejects(listAdminPackagesHandler({} as Request, res), expected);
    }
  });
});
