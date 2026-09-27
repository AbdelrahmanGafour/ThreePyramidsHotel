import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Rearranging a journey's variants, without a database.
//
// The load-bearing part is the two-pass renumber. `UNIQUE (package_id,
// sort_order)` is not deferrable, so every row must be parked clear of the
// final range before any final position is written — a one-pass renumber
// collides with whichever row has not moved yet. The fake client below
// applies each statement to real state AND enforces that unique constraint,
// so a regression to a single pass fails here rather than in production.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');

let __setClientFactoryForTests: RepositoryModule['__setClientFactoryForTests'];
let reorderAdminPackageVariantsHandler: ControllerModule['reorderAdminPackageVariantsHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];

const SLUG = 'nile-dinner-cruise';
const PACKAGE_ID = '42';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setClientFactoryForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ reorderAdminPackageVariantsHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
});

afterEach(() => {
  __setClientFactoryForTests(null);
});

type StoredVariant = {
  id: string;
  key: string;
  label: string;
  is_default: boolean;
  sort_order: number;
  child_discount_percent: string | null;
  rates: Array<{ min: number; max: number | null; rate: string }>;
};

function storedVariant(
  id: string,
  key: string,
  sortOrder: number,
  overrides: Partial<StoredVariant> = {},
): StoredVariant {
  return {
    id,
    key,
    label: `Label ${key}`,
    is_default: false,
    sort_order: sortOrder,
    child_discount_percent: '33.33',
    rates: [{ min: 1, max: null, rate: '100.00' }],
    ...overrides,
  };
}

/** Three variants in positions 1, 2, 3, the first leading. */
const threeVariants = (): StoredVariant[] => [
  storedVariant('1', 'alpha', 1, { is_default: true }),
  storedVariant('2', 'beta', 2),
  storedVariant('3', 'gamma', 3),
];

type Recorded = { text: string; values: unknown[] | undefined };

/**
 * One journey, with the transaction applied to real state.
 *
 * The unique index is enforced on every write, so any renumber that would
 * collide mid-statement throws here exactly as PostgreSQL would.
 */
function storedJourney(options: {
  packageExists?: boolean;
  isActive?: boolean;
  seedManaged?: boolean;
  variants?: StoredVariant[];
} = {}) {
  const state = {
    packageExists: options.packageExists ?? true,
    isActive: options.isActive ?? false,
    seedManaged: options.seedManaged ?? true,
    variants: options.variants ?? threeVariants(),
    updatedAt: 0,
    variantWrites: 0,
    packageWrites: 0,
    released: false,
    discarded: false,
    calls: [] as Recorded[],
  };

  /** What PostgreSQL's non-deferrable unique index would do. */
  function assign(id: string, sortOrder: number): void {
    const clash = state.variants.find(
      (variant) => variant.sort_order === sortOrder && variant.id !== id,
    );

    if (clash) {
      throw Object.assign(
        new Error('duplicate key value violates unique constraint'),
        { code: '23505', constraint: 'package_variants_package_sort_key' },
      );
    }

    state.variants.find((variant) => variant.id === id)!.sort_order = sortOrder;
  }

  __setClientFactoryForTests(async () => ({
    async query(text: string, values?: unknown[]) {
      state.calls.push({ text, values });

      if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
        return { rows: [] } as never;
      }

      if (text.includes('FROM packages WHERE slug')) {
        return {
          rows: state.packageExists ? [{ id: PACKAGE_ID, is_active: state.isActive }] : [],
        } as never;
      }

      if (text.includes('FROM package_variants') && text.includes('FOR UPDATE')) {
        return {
          rows: [...state.variants]
            .sort((left, right) => left.sort_order - right.sort_order
              || left.key.localeCompare(right.key))
            .map((variant) => ({
              id: variant.id, key: variant.key, sort_order: variant.sort_order,
            })),
        } as never;
      }

      // The parking pass: every row moves to base + its row number.
      if (text.includes('WITH parked')) {
        const base = values![1] as number;
        const ordered = [...state.variants].sort((left, right) => Number(left.id) - Number(right.id));

        ordered.forEach((variant, index) => {
          assign(variant.id, base + index + 1);
        });

        state.variantWrites += 1;
        return { rows: [] } as never;
      }

      if (text.includes('UPDATE package_variants SET sort_order')) {
        assign(values![0] as string, values![1] as number);
        state.variantWrites += 1;
        return { rows: [] } as never;
      }

      if (text.includes('UPDATE packages')) {
        state.seedManaged = false;
        state.updatedAt += 1;
        state.packageWrites += 1;
        return { rows: [] } as never;
      }

      return { rows: [detailRow(state)] } as never;
    },
    release(discard?: boolean) {
      state.released = true;
      state.discarded = discard === true;
    },
  }) as never);

  return state;
}

function detailRow(state: {
  isActive: boolean;
  seedManaged: boolean;
  variants: StoredVariant[];
}) {
  const ordered = [...state.variants].sort((left, right) => left.sort_order - right.sort_order);

  return {
    code: 'T016',
    slug: SLUG,
    title: 'Nile Dinner Cruise',
    summary: null,
    duration_label: null,
    schedule_label: null,
    requires_price_confirmation: false,
    is_active: state.isActive,
    sort_order: 16,
    seed_managed: state.seedManaged,
    description: null,
    operating_days: null,
    variant_count: ordered.length,
    default_variant_label: ordered.find((variant) => variant.is_default)?.label ?? null,
    // Selected by PACKAGE_DETAIL_COLUMNS now; a row without it is one
    // this repository would never produce. null is no image.
    image: null,
    itinerary: [],
    content: [],
    variants: ordered.map((variant) => ({
      key: variant.key,
      label: variant.label,
      is_default: variant.is_default,
      sort_order: variant.sort_order,
      child_min_age: variant.child_discount_percent === null ? null : 6,
      child_max_age: variant.child_discount_percent === null ? null : 12,
      child_discount_percent: variant.child_discount_percent,
      rates: variant.rates.map((tier) => ({
        min_party_size: tier.min,
        max_party_size: tier.max,
        adult_unit_rate: tier.rate,
        currency: 'USD',
      })),
    })),
  };
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

async function reorder(slug: string, body: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await reorderAdminPackageVariantsHandler(request(slug, body), res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;
const variantsOf = (captured: Captured) =>
  dataOf(captured).variants as Array<Record<string, unknown>>;
const errorOf = (captured: Captured) =>
  (captured.body as { error: { code: string; message: string } }).error;

/** The stored order, as keys, lowest position first. */
const orderOf = (state: { variants: StoredVariant[] }) =>
  [...state.variants]
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((variant) => variant.key);

const positionsOf = (state: { variants: StoredVariant[] }) =>
  [...state.variants]
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((variant) => variant.sort_order);

const INVALID_BODY = { error: { code: 'INVALID_PACKAGE', message: 'Invalid package details' } };

describe('admin variant order: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ name: string; handle: unknown }>;
        };
      }>;
    }).stack.find((entry) => entry.route?.path === '/:slug/variant-order');

    assert.ok(layer?.route, 'PUT /:slug/variant-order should be registered');
    assert.equal(layer.route.methods.put, true, 'it should be a PUT route');

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

describe('admin variant order: rearranging', () => {
  it('swaps two variants', async () => {
    const stored = storedJourney({
      variants: [storedVariant('1', 'alpha', 1, { is_default: true }), storedVariant('2', 'beta', 2)],
    });

    const captured = await reorder(SLUG, { variantKeys: ['beta', 'alpha'] });

    assert.equal(captured.status, 200);
    assert.deepEqual(orderOf(stored), ['beta', 'alpha']);
    assert.deepEqual(positionsOf(stored), [1, 2]);
  });

  it('reverses three variants', async () => {
    const stored = storedJourney({ variants: threeVariants() });

    const captured = await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });

    assert.equal(captured.status, 200);
    assert.deepEqual(orderOf(stored), ['gamma', 'beta', 'alpha']);
    assert.deepEqual(
      variantsOf(captured).map((variant) => variant.key),
      ['gamma', 'beta', 'alpha'],
      'the answer reports the new order',
    );
  });

  it('renumbers a sparse set into 1..n', async () => {
    const stored = storedJourney({
      variants: [
        storedVariant('1', 'alpha', 4, { is_default: true }),
        storedVariant('2', 'beta', 9),
        storedVariant('3', 'gamma', 40),
      ],
    });

    await reorder(SLUG, { variantKeys: ['gamma', 'alpha', 'beta'] });

    assert.deepEqual(positionsOf(stored), [1, 2, 3], 'gaps are closed');
    assert.deepEqual(orderOf(stored), ['gamma', 'alpha', 'beta']);
  });

  it('handles an existing position of zero', async () => {
    // Legal under `sort_order >= 0`, and the parking base must still clear it.
    const stored = storedJourney({
      variants: [
        storedVariant('1', 'alpha', 0, { is_default: true }),
        storedVariant('2', 'beta', 1),
      ],
    });

    const captured = await reorder(SLUG, { variantKeys: ['beta', 'alpha'] });

    assert.equal(captured.status, 200);
    assert.deepEqual(positionsOf(stored), [1, 2]);
    assert.deepEqual(orderOf(stored), ['beta', 'alpha']);
  });

  it('always lands on exactly 1..n', async () => {
    for (const keys of [
      ['alpha', 'gamma', 'beta'],
      ['beta', 'alpha', 'gamma'],
      ['gamma', 'alpha', 'beta'],
    ]) {
      const stored = storedJourney({ variants: threeVariants() });
      await reorder(SLUG, { variantKeys: keys });

      assert.deepEqual(positionsOf(stored), [1, 2, 3], `${keys.join(',')} should land on 1..n`);
      assert.deepEqual(orderOf(stored), keys);
    }
  });

  it('parks every row before writing any final position', async () => {
    const stored = storedJourney({ variants: threeVariants() });
    await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });

    const park = stored.calls.findIndex((call) => call.text.includes('WITH parked'));
    const firstFinal = stored.calls.findIndex(
      (call) => call.text.includes('UPDATE package_variants SET sort_order'),
    );

    assert.ok(park >= 0, 'the parking pass runs');
    assert.ok(firstFinal > park, 'and it runs before any final position is written');

    // The base clears both the values in use and the final range.
    const base = stored.calls[park]!.values![1] as number;
    assert.ok(base >= 3, 'base is at least the target count');
  });

  it('never deletes a variant, so reservations keep their rows', async () => {
    const stored = storedJourney({ variants: threeVariants() });
    const idsBefore = stored.variants.map((variant) => variant.id).sort();

    await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });

    assert.ok(
      !stored.calls.some((call) => /DELETE FROM package_variants/i.test(call.text)),
      'package_reservations references variant ids with RESTRICT',
    );
    assert.ok(
      !stored.calls.some((call) => /INSERT INTO package_variants/i.test(call.text)),
      'rows are updated, never recreated',
    );
    assert.deepEqual(
      stored.variants.map((variant) => variant.id).sort(),
      idsBefore,
      'the same variant ids survive',
    );
  });

  it('leaves the default flag, labels, child pricing and rates alone', async () => {
    const stored = storedJourney({ variants: threeVariants() });
    const before = stored.variants.map((variant) => ({
      id: variant.id,
      key: variant.key,
      label: variant.label,
      is_default: variant.is_default,
      child_discount_percent: variant.child_discount_percent,
      rates: variant.rates,
    }));

    await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });

    assert.deepEqual(
      stored.variants.map((variant) => ({
        id: variant.id,
        key: variant.key,
        label: variant.label,
        is_default: variant.is_default,
        child_discount_percent: variant.child_discount_percent,
        rates: variant.rates,
      })),
      before,
      'only positions moved',
    );

    for (const call of stored.calls) {
      if (!/^(UPDATE |INSERT INTO|DELETE FROM)/.test(call.text.trim())) continue;
      for (const forbidden of ['is_default', 'label', 'child_min_age', 'child_max_age',
        'child_discount_percent', 'package_rate_tiers', 'is_active', 'key =']) {
        assert.ok(!call.text.includes(forbidden), `${forbidden} must never be written here`);
      }
    }
  });

  it('rearranges a live journey, because no booking reads a position', async () => {
    const stored = storedJourney({ isActive: true, variants: threeVariants() });

    const captured = await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });

    assert.equal(captured.status, 200, 'no deactivation is required');
    assert.deepEqual(orderOf(stored), ['gamma', 'beta', 'alpha']);
    assert.equal(stored.isActive, true, 'and publication is untouched');
    assert.equal(dataOf(captured).isActive, true);
  });
});

describe('admin variant order: the no-op', () => {
  it('answers 200 for the order a journey already has', async () => {
    const stored = storedJourney({ variants: threeVariants() });

    const captured = await reorder(SLUG, { variantKeys: ['alpha', 'beta', 'gamma'] });

    assert.equal(captured.status, 200);
    assert.deepEqual(
      variantsOf(captured).map((variant) => variant.key),
      ['alpha', 'beta', 'gamma'],
    );
  });

  it('writes nothing at all', async () => {
    const stored = storedJourney({ variants: threeVariants() });
    await reorder(SLUG, { variantKeys: ['alpha', 'beta', 'gamma'] });

    assert.equal(stored.variantWrites, 0, 'no parking and no renumber');
    assert.equal(stored.packageWrites, 0);
    assert.equal(stored.updatedAt, 0, 'when the journey last changed is not rewritten');
    assert.ok(!stored.calls.some((call) => call.text.includes('WITH parked')));
  });

  it('does not move ownership, because nothing diverged from the brochure', async () => {
    const stored = storedJourney({ seedManaged: true, variants: threeVariants() });

    const captured = await reorder(SLUG, { variantKeys: ['alpha', 'beta', 'gamma'] });

    assert.equal(stored.seedManaged, true);
    assert.equal(dataOf(captured).managementSource, 'brochure');
  });

  it('settles after a real reorder, so a repeat becomes the no-op', async () => {
    const stored = storedJourney({ variants: threeVariants() });

    await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });
    const writesAfterFirst = stored.variantWrites;

    await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });

    assert.equal(stored.variantWrites, writesAfterFirst, 'the second request wrote nothing');
  });
});

describe('admin variant order: refusals', () => {
  it('refuses a repeated key rather than deduplicating it', async () => {
    const stored = storedJourney({ variants: threeVariants() });

    const captured = await reorder(SLUG, { variantKeys: ['alpha', 'alpha', 'beta'] });

    assert.equal(captured.status, 400);
    assert.deepEqual(captured.body, INVALID_BODY);
    assert.equal(stored.calls.length, 0, 'the transaction never opened');
  });

  it('answers a listed key that names no variant with 404', async () => {
    const stored = storedJourney({ seedManaged: true, variants: threeVariants() });

    const captured = await reorder(SLUG, {
      variantKeys: ['alpha', 'beta', 'gamma', 'no-such-variant'],
    });

    assert.equal(captured.status, 404);
    assert.equal(errorOf(captured).code, 'PACKAGE_VARIANT_NOT_FOUND');
    assert.equal(stored.variantWrites, 0);
    assert.equal(stored.seedManaged, true);
  });

  it('answers a list that omits an existing variant with a set mismatch', async () => {
    const stored = storedJourney({ seedManaged: true, variants: threeVariants() });
    const before = orderOf(stored);

    const captured = await reorder(SLUG, { variantKeys: ['gamma', 'alpha'] });

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_VARIANT_SET_MISMATCH');
    assert.match(errorOf(captured).message, /every variant this journey has, exactly once/);
    assert.deepEqual(orderOf(stored), before, 'no position was invented for the missing one');
    assert.equal(stored.variantWrites, 0);
    assert.equal(stored.seedManaged, true, 'a stale list must not detach a journey');
  });

  it('refuses a stale list naming a variant that has since gone', async () => {
    // The page was rendered when there were three; one was removed since.
    const stored = storedJourney({
      seedManaged: true,
      variants: [storedVariant('1', 'alpha', 1, { is_default: true }), storedVariant('2', 'beta', 2)],
    });

    const captured = await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });

    assert.equal(captured.status, 404, 'the unknown key is reported before the count');
    assert.equal(stored.variantWrites, 0);
    assert.equal(stored.seedManaged, true);
  });

  it('answers a journey nothing matches with 404, and locks nothing further', async () => {
    const stored = storedJourney({ packageExists: false });

    const captured = await reorder(SLUG, { variantKeys: ['alpha'] });

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
    assert.equal(stored.variantWrites, 0);
  });

  it('refuses an exhausted ordering before any position moves', async () => {
    const stored = storedJourney({
      seedManaged: true,
      variants: [
        storedVariant('1', 'alpha', 2147483647, { is_default: true }),
        storedVariant('2', 'beta', 5),
      ],
    });

    // Deliberately the opposite of the stored order — beta already sorts
    // first at 5 — so this is a genuine reorder rather than the no-op.
    const captured = await reorder(SLUG, { variantKeys: ['alpha', 'beta'] });

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_VARIANT_ORDER_EXHAUSTED');
    assert.equal(stored.variantWrites, 0, 'not one row was parked');
    assert.equal(stored.packageWrites, 0);
    assert.equal(stored.seedManaged, true);
    assert.deepEqual(positionsOf(stored), [5, 2147483647], 'untouched');
  });

  it('refuses a body carrying anything but the list', async () => {
    for (const body of [
      { variantKeys: ['alpha'], isDefault: true },
      { variantKeys: ['alpha'], sortOrder: 1 },
      { variantKeys: ['alpha'], slug: SLUG },
      {},
      { keys: ['alpha'] },
      { variantKeys: [] },
      { variantKeys: 'alpha' },
      { variantKeys: [7] },
      { variantKeys: ['Alpha'] },
      { variantKeys: [' alpha'] },
      { variantKeys: [null] },
    ]) {
      const stored = storedJourney({ variants: threeVariants() });
      const captured = await reorder(SLUG, body);

      assert.equal(captured.status, 400, `${JSON.stringify(body)} should be refused`);
      assert.deepEqual(captured.body, INVALID_BODY);
      assert.equal(stored.calls.length, 0, 'nothing reached the database');
    }
  });

  it('refuses a malformed slug before opening a transaction', async () => {
    const stored = storedJourney({ variants: threeVariants() });

    const captured = await reorder('Not A Slug', { variantKeys: ['alpha'] });

    assert.equal(captured.status, 400);
    assert.equal(errorOf(captured).code, 'INVALID_PACKAGE_SLUG');
    assert.equal(stored.calls.length, 0);
  });

  it('refuses a body that is not an object at all', async () => {
    for (const body of [null, 'alpha', 42, ['alpha']]) {
      const stored = storedJourney({ variants: threeVariants() });
      assert.equal((await reorder(SLUG, body)).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });
});

describe('admin variant order: transaction and ownership', () => {
  it('takes ownership of a brochure journey on a real reorder', async () => {
    const stored = storedJourney({ seedManaged: true, variants: threeVariants() });

    const captured = await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });

    assert.equal(dataOf(captured).managementSource, 'admin');
    assert.equal(stored.seedManaged, false, 'the seed must stop reconciling it');
    assert.equal(stored.updatedAt, 1);
  });

  it('leaves an already admin-managed journey admin-managed', async () => {
    const stored = storedJourney({ seedManaged: false, variants: threeVariants() });

    assert.equal(
      dataOf(await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] })).managementSource,
      'admin',
    );
    assert.equal(stored.seedManaged, false);
  });

  it('runs the whole rearrangement in one transaction, package locked first', async () => {
    const stored = storedJourney({ variants: threeVariants() });
    await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });

    const shape = stored.calls.map((call) => {
      if (call.text.startsWith('BEGIN')) return 'BEGIN';
      if (call.text.startsWith('COMMIT')) return 'COMMIT';
      if (call.text.includes('FROM packages WHERE slug')) return 'LOCK-PACKAGE';
      if (call.text.includes('FROM package_variants') && call.text.includes('FOR UPDATE')) {
        return 'LOCK-VARIANTS';
      }
      if (call.text.includes('WITH parked')) return 'PARK';
      if (call.text.includes('UPDATE package_variants SET sort_order')) return 'POSITION';
      if (call.text.includes('UPDATE packages')) return 'OWN';
      return 'READ';
    });

    assert.deepEqual(shape, [
      'BEGIN', 'LOCK-PACKAGE', 'LOCK-VARIANTS', 'PARK',
      'POSITION', 'POSITION', 'POSITION', 'OWN', 'READ', 'COMMIT',
    ]);
    assert.equal(stored.released, true);
    assert.equal(stored.discarded, false);
  });

  it('locks the package before the variants', async () => {
    const stored = storedJourney({ variants: threeVariants() });
    await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });

    const packageLock = stored.calls.findIndex((call) => call.text.includes('FROM packages WHERE slug'));
    const variantLock = stored.calls.findIndex(
      (call) => call.text.includes('FROM package_variants') && call.text.includes('FOR UPDATE'),
    );

    assert.equal(packageLock, 1, 'immediately after BEGIN');
    assert.ok(packageLock < variantLock);
    assert.deepEqual(stored.calls[variantLock]!.values, [PACKAGE_ID]);
  });

  it('discards the connection and sends no rollback when COMMIT itself fails', async () => {
    const calls: string[] = [];
    let discarded: boolean | undefined;

    __setClientFactoryForTests(async () => ({
      async query(text: string) {
        calls.push(text.trim().split(/\s/)[0]!);
        if (text.startsWith('COMMIT')) throw new Error('commit failed');
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: PACKAGE_ID, is_active: false }] } as never;
        }
        if (text.includes('FROM package_variants') && text.includes('FOR UPDATE')) {
          return {
            rows: [
              { id: '1', key: 'alpha', sort_order: 1 },
              { id: '2', key: 'beta', sort_order: 2 },
            ],
          } as never;
        }
        if (text.includes('FROM packages p')) {
          return {
            rows: [detailRow({
              isActive: false,
              seedManaged: false,
              variants: [storedVariant('1', 'alpha', 1), storedVariant('2', 'beta', 2)],
            })],
          } as never;
        }
        return { rows: [] } as never;
      },
      release(discard?: boolean) {
        discarded = discard;
      },
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      reorderAdminPackageVariantsHandler(request(SLUG, { variantKeys: ['beta', 'alpha'] }), res),
      /commit failed/,
    );

    const afterCommit = calls.slice(calls.indexOf('COMMIT') + 1);
    assert.deepEqual(afterCommit, [], 'no statement is sent after a failed COMMIT');
    assert.equal(discarded, true, 'the connection is poisoned rather than reused');
  });

  it('rolls back and releases the connection when a statement fails', async () => {
    const calls: string[] = [];
    let released = false;

    __setClientFactoryForTests(async () => ({
      async query(text: string) {
        calls.push(text.split('\n')[0]!.trim());
        if (text.includes('WITH parked')) throw new Error('deadlock detected');
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: PACKAGE_ID, is_active: false }] } as never;
        }
        if (text.includes('FROM package_variants') && text.includes('FOR UPDATE')) {
          return {
            rows: [
              { id: '1', key: 'alpha', sort_order: 1 },
              { id: '2', key: 'beta', sort_order: 2 },
            ],
          } as never;
        }
        return { rows: [] } as never;
      },
      release() {
        released = true;
      },
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      reorderAdminPackageVariantsHandler(request(SLUG, { variantKeys: ['beta', 'alpha'] }), res),
      /deadlock detected/,
    );

    assert.ok(calls.includes('ROLLBACK'), 'the transaction is rolled back');
    assert.ok(!calls.includes('COMMIT'));
    assert.equal(released, true);
  });
});

describe('admin variant order: response', () => {
  it('answers with the whole journey under data, and nothing else', async () => {
    storedJourney({ variants: threeVariants() });

    const captured = await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });

    assert.deepEqual(Object.keys(captured.body as object), ['data']);
    assert.equal(dataOf(captured).variantCount, 3);
  });

  it('leaks no database id and no raw ownership column', async () => {
    storedJourney({ seedManaged: true, variants: threeVariants() });

    const captured = await reorder(SLUG, { variantKeys: ['gamma', 'beta', 'alpha'] });
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', 'seed_managed', 'seedManaged', 'package_id', 'packageId',
      'variant_id', 'variantId']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not appear in the response`);
    }
  });
});
