import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// The admin package catalogue detail endpoint, without a database.
//
// The orderings live in SQL, so what a unit test can prove about them is that
// the query asks for them; that the clauses match the public catalogue's is
// asserted here too, since the two views disagreeing would be the real bug.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');

let __setQueryableForTests: RepositoryModule['__setQueryableForTests'];
let getAdminPackageHandler: ControllerModule['getAdminPackageHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];

const SLUG = 'nile-dinner-cruise';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setQueryableForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ getAdminPackageHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
});

afterEach(() => {
  __setQueryableForTests(null);
});

/** The jsonb aggregates arrive already ordered by SQL; the fake mirrors that. */
function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    code: 'T016',
    slug: SLUG,
    title: 'Nile Dinner Cruise',
    summary: 'An evening on the water.',
    duration_label: 'Evening',
    schedule_label: 'Daily',
    requires_price_confirmation: false,
    is_active: true,
    sort_order: 16,
    seed_managed: true,
    description: 'A longer passage about the cruise.',
    operating_days: ['monday', 'tuesday'],
    variant_count: 2,
    default_variant_label: 'Standard service',
    itinerary: [
      { day_number: null, heading: 'Boarding', body: 'Meet at the quay.' },
      { day_number: 1, heading: null, body: 'Dinner is served.' },
    ],
    content: [
      { kind: 'excluded', text: 'Drinks' },
      { kind: 'included', text: 'Dinner' },
      { kind: 'note', text: 'Smart dress.' },
    ],
    variants: [
      {
        key: 'standard-service', label: 'Standard service', is_default: true, sort_order: 1,
        child_min_age: 6, child_max_age: 12, child_discount_percent: '50.00',
        rates: [
          { min_party_size: 1, max_party_size: 1, adult_unit_rate: '100.00', currency: 'USD' },
          { min_party_size: 2, max_party_size: 2, adult_unit_rate: '90.00', currency: 'USD' },
          { min_party_size: 3, max_party_size: null, adult_unit_rate: '80.00', currency: 'USD' },
        ],
      },
      {
        key: 'premium-service', label: 'Premium service', is_default: false, sort_order: 2,
        child_min_age: null, child_max_age: null, child_discount_percent: null,
        rates: [{ min_party_size: 1, max_party_size: null, adult_unit_rate: '150.00', currency: 'USD' }],
      },
    ],
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

const request = (slug: string) => ({ params: { slug } }) as unknown as Request<{ slug: string }>;

async function detailOf(rows: unknown[], slug = SLUG): Promise<Captured> {
  fakeQueryable(rows);
  const { res, captured } = fakeResponse();
  await getAdminPackageHandler(request(slug), res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;

describe('admin package detail: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{ route?: { path: string; stack: Array<{ name: string; handle: unknown }> } }>;
    }).stack.find((entry) => entry.route?.path === '/:slug');

    assert.ok(layer?.route, 'GET /:slug should be registered');
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

describe('admin package detail: reading', () => {
  it('returns the package in full', async () => {
    const captured = await detailOf([detailRow()]);

    assert.equal(captured.status, 200);
    assert.deepEqual(dataOf(captured), {
      code: 'T016',
      slug: SLUG,
      title: 'Nile Dinner Cruise',
      summary: 'An evening on the water.',
      durationLabel: 'Evening',
      scheduleLabel: 'Daily',
      requiresPriceConfirmation: false,
      isActive: true,
      sortOrder: 16,
      managementSource: 'brochure',
      variantCount: 2,
      defaultVariantLabel: 'Standard service',
      description: 'A longer passage about the cruise.',
      operatingDays: ['monday', 'tuesday'],
      itinerary: [
        { dayNumber: null, heading: 'Boarding', body: 'Meet at the quay.' },
        { dayNumber: 1, heading: null, body: 'Dinner is served.' },
      ],
      content: { included: ['Dinner'], excluded: ['Drinks'], notes: ['Smart dress.'] },
      variants: [
        {
          key: 'standard-service', label: 'Standard service', isDefault: true, sortOrder: 1,
          childMinAge: 6, childMaxAge: 12, childDiscountPercent: '50.00',
          rates: [
            { minPartySize: 1, maxPartySize: 1, adultUnitRate: '100.00', currency: 'USD' },
            { minPartySize: 2, maxPartySize: 2, adultUnitRate: '90.00', currency: 'USD' },
            { minPartySize: 3, maxPartySize: null, adultUnitRate: '80.00', currency: 'USD' },
          ],
        },
        {
          key: 'premium-service', label: 'Premium service', isDefault: false, sortOrder: 2,
          childMinAge: null, childMaxAge: null, childDiscountPercent: null,
          rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '150.00', currency: 'USD' }],
        },
      ],
    });
  });

  it('carries every field the list carries', async () => {
    const { toAdminPackageListItem } = await import(
      '../src/modules/admin-packages/admin-packages.repository.js'
    );
    const listItem = toAdminPackageListItem(detailRow() as never);
    const detail = dataOf(await detailOf([detailRow()]));

    for (const [field, value] of Object.entries(listItem)) {
      assert.deepEqual(detail[field], value, `${field} should match the list contract exactly`);
    }
  });

  it('serves an inactive package, which the public catalogue would not', async () => {
    const captured = await detailOf([detailRow({ is_active: false })]);

    assert.equal(captured.status, 200);
    assert.equal(dataOf(captured).isActive, false);
  });

  it('represents a manual-confirmation package correctly', async () => {
    const captured = await detailOf([
      detailRow({
        code: 'P09',
        requires_price_confirmation: true,
        variants: [{
          key: 'private', label: 'Private vehicle', is_default: true, sort_order: 1,
          child_min_age: null, child_max_age: null, child_discount_percent: null,
          rates: [{ min_party_size: 3, max_party_size: null, adult_unit_rate: '0.00', currency: 'USD' }],
        }],
        variant_count: 1,
        default_variant_label: 'Private vehicle',
      }),
    ]);

    const detail = dataOf(captured);
    assert.equal(detail.requiresPriceConfirmation, true);
    // The stored tier is still returned exactly as held — the flag says the
    // figure needs confirming, it does not mean there is no row.
    const [variant] = detail.variants as Array<Record<string, unknown>>;
    assert.deepEqual(variant.rates, [
      { minPartySize: 3, maxPartySize: null, adultUnitRate: '0.00', currency: 'USD' },
    ]);
  });

  it('returns empty collections rather than nulls for a bare package', async () => {
    const captured = await detailOf([
      detailRow({ itinerary: [], content: [], variants: [], variant_count: 0,
        default_variant_label: null, operating_days: null, summary: null, description: null }),
    ]);

    const detail = dataOf(captured);
    assert.deepEqual(detail.itinerary, []);
    assert.deepEqual(detail.content, { included: [], excluded: [], notes: [] });
    assert.deepEqual(detail.variants, []);
    assert.equal(detail.operatingDays, null);
    assert.equal(detail.defaultVariantLabel, null);
  });

  it('keeps money as exact strings, never numbers', async () => {
    const detail = dataOf(await detailOf([detailRow()]));
    const [variant] = detail.variants as Array<Record<string, unknown>>;
    const rates = variant.rates as Array<Record<string, unknown>>;

    for (const tier of rates) {
      assert.equal(typeof tier.adultUnitRate, 'string');
    }
    assert.equal(variant.childDiscountPercent, '50.00');
  });
});

describe('admin package detail: ordering', () => {
  it('asks the database for the same orderings the public catalogue uses', async () => {
    const calls = fakeQueryable([detailRow()]);
    const { res } = fakeResponse();
    await getAdminPackageHandler(request(SLUG), res);

    const sql = calls[0].text;
    assert.match(sql, /ORDER BY s\.sort_order/, 'itinerary');
    assert.match(sql, /ORDER BY c\.kind, c\.sort_order/, 'content');
    assert.match(sql, /ORDER BY v\.sort_order, v\.key/, 'variants');
    assert.match(sql, /ORDER BY r\.min_party_size/, 'rate tiers');
  });

  it('preserves the order the database returned, without re-sorting in code', async () => {
    const captured = await detailOf([detailRow()]);
    const detail = dataOf(captured);

    assert.deepEqual(
      (detail.variants as Array<Record<string, unknown>>).map((variant) => variant.key),
      ['standard-service', 'premium-service'],
    );
    assert.deepEqual(
      ((detail.variants as Array<Record<string, unknown>>)[0]!.rates as Array<Record<string, unknown>>)
        .map((tier) => tier.minPartySize),
      [1, 2, 3],
    );
    assert.deepEqual(
      (detail.itinerary as Array<Record<string, unknown>>).map((section) => section.body),
      ['Meet at the quay.', 'Dinner is served.'],
    );
  });

  it('costs one query for the whole package', async () => {
    const calls = fakeQueryable([detailRow()]);
    const { res } = fakeResponse();
    await getAdminPackageHandler(request(SLUG), res);

    assert.equal(calls.length, 1, 'parent and children in one consistent snapshot');
    assert.deepEqual(calls[0].values, [SLUG]);
    assert.match(calls[0].text, /WHERE p\.slug = \$1/);
    assert.ok(!calls[0].text.includes('is_active = true'), 'an administrator sees retired offerings');
  });
});

describe('admin package detail: ownership', () => {
  it('reports the storage boolean as an admin-facing source', async () => {
    assert.equal(dataOf(await detailOf([detailRow({ seed_managed: true })])).managementSource, 'brochure');
    assert.equal(dataOf(await detailOf([detailRow({ seed_managed: false })])).managementSource, 'admin');
  });

  it('never exposes the raw column name', async () => {
    const captured = await detailOf([detailRow({ seed_managed: false })]);
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['seed_managed', 'seedManaged']) {
      assert.ok(!serialized.includes(leaked), `${leaked} is storage detail, not contract`);
    }
  });
});

describe('admin package detail: not found and validation', () => {
  it('answers 404 for a well-formed slug nothing matches', async () => {
    const captured = await detailOf([]);

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
  });

  it('answers 400 for a malformed slug, without querying at all', async () => {
    for (const malformed of [
      'Nile-Dinner-Cruise',
      'nile_dinner_cruise',
      '-leading',
      'trailing-',
      'double--hyphen',
      'with space',
      '',
      'nile-dinner-cruise\n',
      'a'.repeat(121),
    ]) {
      const calls = fakeQueryable([detailRow()]);
      const { res, captured } = fakeResponse();
      await getAdminPackageHandler(request(malformed), res);

      assert.equal(captured.status, 400, `${JSON.stringify(malformed)} should be refused`);
      assert.deepEqual(captured.body, {
        error: { code: 'INVALID_PACKAGE_SLUG', message: 'Invalid package slug' },
      });
      assert.equal(calls.length, 0, 'a malformed slug must never reach the database');
    }
  });

  it('keeps a malformed slug and an unknown one clearly apart', async () => {
    const malformed = await detailOf([detailRow()], 'NOT A SLUG');
    const unknown = await detailOf([]);

    assert.equal(malformed.status, 400);
    assert.equal(unknown.status, 404);
    assert.notDeepEqual(malformed.body, unknown.body);
  });

  it('never echoes the supplied slug back in an error', async () => {
    const captured = await detailOf([detailRow()], 'SECRETVALUE');

    assert.ok(!JSON.stringify(captured.body).includes('SECRETVALUE'));
  });

  it('lets a database failure stay a server error', async () => {
    __setQueryableForTests({
      async query() {
        throw new Error('connection terminated unexpectedly');
      },
    } as never);
    const { res, captured } = fakeResponse();

    await assert.rejects(
      getAdminPackageHandler(request(SLUG), res),
      /connection terminated/,
      'an outage must not be softened into a 404',
    );
    assert.equal(captured.status, undefined, 'nothing was answered');
  });
});

describe('admin package detail: leakage and stored data', () => {
  it('exposes no internal database ids, at any level', async () => {
    const captured = await detailOf([
      detailRow({
        id: '42',
        variants: [{
          id: '7', package_id: '42',
          key: 'standard-service', label: 'Standard service', is_default: true, sort_order: 1,
          child_min_age: null, child_max_age: null, child_discount_percent: null,
          rates: [{ id: '9', variant_id: '7', min_party_size: 1, max_party_size: null,
            adult_unit_rate: '100.00', currency: 'USD' }],
        }],
      }),
    ]);

    const detail = dataOf(captured);
    const [variant] = detail.variants as Array<Record<string, unknown>>;

    assert.deepEqual(Object.keys(variant).sort(), [
      'childDiscountPercent', 'childMaxAge', 'childMinAge',
      'isDefault', 'key', 'label', 'rates', 'sortOrder',
    ]);
    assert.deepEqual(Object.keys((variant.rates as Array<Record<string, unknown>>)[0]!).sort(), [
      'adultUnitRate', 'currency', 'maxPartySize', 'minPartySize',
    ]);

    const serialized = JSON.stringify(captured.body);
    for (const leaked of ['"id"', '"packageId"', '"variantId"', 'package_id', 'variant_id']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not reach an admin response`);
    }
  });

  it('exposes no timestamps', async () => {
    const captured = await detailOf([
      detailRow({ created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date() }),
    ]);
    const detail = dataOf(captured);

    assert.equal(detail.createdAt, undefined);
    assert.equal(detail.updatedAt, undefined);
    assert.ok(!JSON.stringify(captured.body).includes('2026-01-01'));
  });

  it('raises rather than serving stored data the schema says cannot exist', async () => {
    for (const override of [
      { content: [{ kind: 'something-else', text: 'Nope' }] },
      { variants: [{ key: 'k', label: 'L', is_default: true, sort_order: 1,
        child_min_age: 6, child_max_age: null, child_discount_percent: null, rates: [] }] },
      { variants: [{ key: 'k', label: 'L', is_default: true, sort_order: 1,
        child_min_age: null, child_max_age: null, child_discount_percent: null,
        rates: [{ min_party_size: 3, max_party_size: 1, adult_unit_rate: '10.00', currency: 'USD' }] }] },
      { variants: [{ key: 'k', label: 'L', is_default: true, sort_order: 1,
        child_min_age: null, child_max_age: null, child_discount_percent: null,
        rates: [{ min_party_size: 1, max_party_size: null, adult_unit_rate: '10.00', currency: 'EGP' }] }] },
      { itinerary: [{ day_number: null, heading: null, body: '' }] },
    ]) {
      fakeQueryable([detailRow(override)]);
      const { res } = fakeResponse();
      await assert.rejects(getAdminPackageHandler(request(SLUG), res), /Invalid admin package/);
    }
  });
});
