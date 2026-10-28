import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Publishing and withdrawing a package, without a database.
//
// The fake below holds one package's real state and applies the UPDATE to it,
// so "active -> inactive", "inactive -> active" and a repeated request are
// observed as state transitions rather than asserted against a fixed stub.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');

let __setQueryableForTests: RepositoryModule['__setQueryableForTests'];
let updateAdminPackageStatusHandler: ControllerModule['updateAdminPackageStatusHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];

const SLUG = 'nile-dinner-cruise';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setQueryableForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ updateAdminPackageStatusHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
});

afterEach(() => {
  __setQueryableForTests(null);
});

function detailRow(isActive: boolean, seedManaged: boolean, updatedAt: string) {
  return {
    code: 'T016',
    slug: SLUG,
    title: 'Nile Dinner Cruise',
    summary: null,
    duration_label: 'Evening',
    schedule_label: 'Daily',
    requires_price_confirmation: false,
    is_active: isActive,
    sort_order: 16,
    seed_managed: seedManaged,
    description: null,
    operating_days: null,
    variant_count: 1,
    default_variant_label: 'Standard',
    // Selected by PACKAGE_DETAIL_COLUMNS now; a row without it is one
    // this repository would never produce. null is no image.
    image: null,
    itinerary: [],
    content: [],
    variants: [{
      key: 'standard', label: 'Standard', is_default: true, sort_order: 1,
      child_min_age: null, child_max_age: null, child_discount_percent: null,
      rates: [{ min_party_size: 1, max_party_size: null, adult_unit_rate: '100.00', currency: 'USD' }],
    }],
    // Carried on the fake row only so a test can watch whether it moves; the
    // projection never selects it, so it can never reach a response.
    updated_at: updatedAt,
  };
}

type Recorded = { text: string; values: unknown[] | undefined };

/**
 * One stored package whose state the UPDATE actually changes, mirroring the
 * real statement: matched on slug alone, `updated_at` moved only on a real
 * change, and `seed_managed` never written.
 */
function storedPackage(options: { isActive?: boolean; seedManaged?: boolean; exists?: boolean } = {}) {
  const state = {
    isActive: options.isActive ?? true,
    seedManaged: options.seedManaged ?? true,
    exists: options.exists ?? true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    writes: 0,
    calls: [] as Recorded[],
  };

  __setQueryableForTests({
    async query(text: string, values?: unknown[]) {
      state.calls.push({ text, values });

      if (text.includes('UPDATE packages')) {
        if (!state.exists || values?.[0] !== SLUG) {
          return { rows: [], rowCount: 0 } as never;
        }

        const requested = values[1] as boolean;

        if (state.isActive !== requested) {
          state.isActive = requested;
          state.updatedAt = '2026-06-01T12:00:00.000Z';
        }
        state.writes += 1;

        return { rows: [], rowCount: 1 } as never;
      }

      // The detail read that follows the write.
      if (!state.exists || values?.[0] !== SLUG) {
        return { rows: [] } as never;
      }

      return {
        rows: [detailRow(state.isActive, state.seedManaged, state.updatedAt)],
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

const request = (slug: string, body: unknown) =>
  ({ params: { slug }, body }) as unknown as Request<{ slug: string }>;

async function setStatus(slug: string, body: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await updateAdminPackageStatusHandler(request(slug, body), res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;

const INVALID_STATUS_BODY = {
  error: { code: 'INVALID_PACKAGE_STATUS', message: 'Invalid package status' },
};

describe('admin package status: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string; handle: unknown }> } }>;
    }).stack.find((entry) => entry.route?.path === '/:slug/status');

    assert.ok(layer?.route, 'PATCH /:slug/status should be registered');
    assert.equal(layer.route.methods.patch, true, 'it should be a PATCH route');

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

describe('admin package status: transitions', () => {
  it('withdraws an active package', async () => {
    const stored = storedPackage({ isActive: true });

    const captured = await setStatus(SLUG, { isActive: false });

    assert.equal(captured.status, 200);
    assert.equal(dataOf(captured).isActive, false);
    assert.equal(stored.isActive, false);
  });

  it('publishes an inactive package', async () => {
    const stored = storedPackage({ isActive: false });

    const captured = await setStatus(SLUG, { isActive: true });

    assert.equal(captured.status, 200);
    assert.equal(dataOf(captured).isActive, true);
    assert.equal(stored.isActive, true);
  });

  it('answers with the whole package, not just the flag', async () => {
    storedPackage({ isActive: true });

    const detail = dataOf(await setStatus(SLUG, { isActive: false }));

    assert.equal(detail.code, 'T016');
    assert.equal(detail.slug, SLUG);
    assert.equal(detail.title, 'Nile Dinner Cruise');
    assert.equal(detail.variantCount, 1);
    assert.ok(Array.isArray(detail.variants));
    assert.ok(Array.isArray(detail.itinerary));
    assert.deepEqual(detail.content, { included: [], excluded: [], notes: [] });
  });
});

describe('admin package status: idempotence', () => {
  it('succeeds when the package is already in the requested state', async () => {
    const stored = storedPackage({ isActive: true });

    const captured = await setStatus(SLUG, { isActive: true });

    assert.equal(captured.status, 200, 'a repeated request is not an error');
    assert.equal(dataOf(captured).isActive, true);
    assert.equal(stored.isActive, true);
  });

  it('gives the same answer however many times it is asked', async () => {
    const stored = storedPackage({ isActive: true });

    const first = await setStatus(SLUG, { isActive: false });
    const second = await setStatus(SLUG, { isActive: false });
    const third = await setStatus(SLUG, { isActive: false });

    assert.deepEqual(second.body, first.body);
    assert.deepEqual(third.body, first.body);
    assert.equal(stored.isActive, false);
  });

  it('does not move updated_at when nothing actually changed', async () => {
    const stored = storedPackage({ isActive: true });

    await setStatus(SLUG, { isActive: true });
    assert.equal(stored.updatedAt, '2026-01-01T00:00:00.000Z', 'a no-op must not rewrite the timestamp');

    await setStatus(SLUG, { isActive: false });
    assert.equal(stored.updatedAt, '2026-06-01T12:00:00.000Z', 'a real change does');
  });

  it('matches on slug alone, so a no-op is never mistaken for a missing package', async () => {
    const stored = storedPackage({ isActive: true });
    await setStatus(SLUG, { isActive: true });

    const update = stored.calls[0]!;
    assert.match(update.text, /WHERE slug = \$1/);
    assert.ok(!/is_active\s*=\s*\$?\d?\s*(AND|<>)/.test(update.text.split('WHERE')[1] ?? ''),
      'no state guard belongs in the WHERE clause');
  });
});

describe('admin package status: write scope', () => {
  it('costs one statement and writes only is_active and updated_at', async () => {
    const stored = storedPackage({ isActive: true });
    await setStatus(SLUG, { isActive: false });

    // MySQL has no UPDATE ... RETURNING: one UPDATE, then the detail read.
    assert.equal(stored.calls.length, 2, 'one UPDATE, then the read that answers');
    assert.match(stored.calls[0]!.text, /^UPDATE packages/);
    assert.match(stored.calls[1]!.text, /^SELECT/);
    const sql = stored.calls[0]!.text;

    const setClause = sql.split('SET')[1]!.split('WHERE')[0]!;
    assert.match(setClause, /is_active = \$2/);
    assert.match(setClause, /updated_at =/);

    for (const column of ['seed_managed', 'code', 'slug', 'title', 'summary', 'description',
      'sort_order', 'operating_days', 'requires_price_confirmation']) {
      assert.ok(!setClause.includes(column), `${column} must never be written by this endpoint`);
    }
  });

  it('never writes seed_managed, in either direction', async () => {
    for (const seedManaged of [true, false]) {
      const stored = storedPackage({ isActive: true, seedManaged });
      await setStatus(SLUG, { isActive: false });

      assert.equal(stored.seedManaged, seedManaged, 'ownership is untouched by publishing');
      assert.ok(!stored.calls[0]!.text.split('WHERE')[0]!.includes('seed_managed'));
    }
  });

  it('touches no child table', async () => {
    const stored = storedPackage({ isActive: true });
    await setStatus(SLUG, { isActive: false });

    const sql = stored.calls[0]!.text;
    const writeHalf = sql.split('RETURNING')[0]!;
    for (const table of ['package_variants', 'package_rate_tiers',
      'package_itinerary_sections', 'package_content_items', 'package_reservations']) {
      assert.ok(!writeHalf.includes(table), `${table} must not be written`);
    }
  });

  it('answers with a read of the row it just wrote', async () => {
    const stored = storedPackage({ isActive: true });
    await setStatus(SLUG, { isActive: false });

    const sql = stored.calls[1]!.text;
    assert.match(sql, /FROM packages p/);
    assert.match(sql, /WHERE p\.slug = \$1/);
    assert.deepEqual(stored.calls[1]!.values, [SLUG]);
  });

  it('compares against the old value, so updated_at is assigned before is_active', async () => {
    // MySQL evaluates SET assignments left to right; a later one sees the new
    // value of an earlier one.
    const stored = storedPackage({ isActive: true });
    await setStatus(SLUG, { isActive: false });

    const setClause = stored.calls[0]!.text.split('SET')[1]!.split('WHERE')[0]!;
    assert.ok(setClause.indexOf('updated_at') < setClause.indexOf('is_active = $2'));
  });
});

describe('admin package status: ownership preservation', () => {
  it('keeps a brochure-owned package brochure-owned', async () => {
    storedPackage({ isActive: true, seedManaged: true });

    const before = dataOf(await setStatus(SLUG, { isActive: false }));
    assert.equal(before.managementSource, 'brochure');

    const after = dataOf(await setStatus(SLUG, { isActive: true }));
    assert.equal(after.managementSource, 'brochure', 'publishing does not take ownership');
  });

  it('keeps an admin-owned package admin-owned', async () => {
    storedPackage({ isActive: true, seedManaged: false });

    const detail = dataOf(await setStatus(SLUG, { isActive: false }));

    assert.equal(detail.managementSource, 'admin');
  });

  it('works for both ownerships alike', async () => {
    for (const seedManaged of [true, false]) {
      storedPackage({ isActive: true, seedManaged });
      const captured = await setStatus(SLUG, { isActive: false });
      assert.equal(captured.status, 200);
      assert.equal(dataOf(captured).isActive, false);
    }
  });
});

describe('admin package status: validation and not found', () => {
  it('rejects an invalid body with 400, without querying', async () => {
    for (const body of [
      { isActive: 'true' },
      { isActive: 1 },
      { isActive: null },
      { isActive: undefined },
      {},
      { active: true },
      null,
      [],
      'true',
      undefined,
    ]) {
      const stored = storedPackage();
      const captured = await setStatus(SLUG, body);

      assert.equal(captured.status, 400, `${JSON.stringify(body ?? null)} should be refused`);
      assert.deepEqual(captured.body, INVALID_STATUS_BODY);
      assert.equal(stored.calls.length, 0, 'an invalid body must never reach the database');
    }
  });

  it('rejects a malformed slug before the body or any query', async () => {
    const stored = storedPackage();
    // Both malformed: the slug wins, so the answer is the same every time.
    const captured = await setStatus('NOT A SLUG', { isActive: 'nope' });

    assert.equal(captured.status, 400);
    assert.deepEqual(captured.body, {
      error: { code: 'INVALID_PACKAGE_SLUG', message: 'Invalid package slug' },
    });
    assert.equal(stored.calls.length, 0);
  });

  it('answers 404 for a well-formed slug nothing matches', async () => {
    storedPackage({ exists: false });

    const captured = await setStatus(SLUG, { isActive: false });

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
  });

  it('keeps 400 and 404 clearly apart', async () => {
    storedPackage();
    const badBody = await setStatus(SLUG, {});
    storedPackage({ exists: false });
    const missing = await setStatus(SLUG, { isActive: true });

    assert.deepEqual([badBody.status, missing.status], [400, 404]);
    assert.notDeepEqual(badBody.body, missing.body);
  });

  it('lets a database failure stay a server error', async () => {
    __setQueryableForTests({
      async query() {
        throw new Error('connection terminated unexpectedly');
      },
    } as never);
    const { res, captured } = fakeResponse();

    await assert.rejects(
      updateAdminPackageStatusHandler(request(SLUG, { isActive: false }), res),
      /connection terminated/,
    );
    assert.equal(captured.status, undefined, 'nothing was answered');
  });
});

describe('admin package status: leakage', () => {
  it('exposes no internal database ids or raw ownership column', async () => {
    storedPackage({ isActive: true, seedManaged: false });

    const captured = await setStatus(SLUG, { isActive: false });
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', '"packageId"', '"variantId"', 'package_id', 'variant_id',
      'seed_managed', 'seedManaged', 'updated_at', 'updatedAt']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not reach an admin response`);
    }
  });
});
