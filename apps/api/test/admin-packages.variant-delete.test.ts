import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Removing one variant from a journey, without a database.
//
// Three refusals have to be decided before anything is written, and all three
// depend on state read under the package lock: whether the journey is live,
// whether this variant is the one it leads with, and whether it has ever been
// booked. The fake client below applies each statement to real state and
// records every one in order, so "nothing was written" is assertable rather
// than assumed.
//
// The rate tiers are deliberately NOT deleted by this code — they cascade —
// so the fake models that cascade itself, and a regression that started
// deleting them explicitly would show up as an extra statement.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');

let __setClientFactoryForTests: RepositoryModule['__setClientFactoryForTests'];
let deleteAdminPackageVariantHandler: ControllerModule['deleteAdminPackageVariantHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];

const SLUG = 'nile-dinner-cruise';
const PACKAGE_ID = '42';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setClientFactoryForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ deleteAdminPackageVariantHandler } = await import(
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
    rates: [{ min: 1, max: null, rate: '100.00' }],
    ...overrides,
  };
}

/** Three variants at 1, 2, 3, the first leading. */
const threeVariants = (): StoredVariant[] => [
  storedVariant('1', 'alpha', 1, { is_default: true }),
  storedVariant('2', 'beta', 2),
  storedVariant('3', 'gamma', 3),
];

type Recorded = { text: string; values: unknown[] | undefined };

/** A foreign key violation shaped the way `pg` reports one. */
function foreignKeyViolation(constraint: string): Error {
  return Object.assign(new Error('update or delete on table violates foreign key constraint'), {
    code: '23503',
    constraint,
  });
}

/**
 * One journey, with the transaction applied to real state.
 *
 * `reservedVariantIds` drives the RESTRICT: the delete statement refuses
 * exactly as PostgreSQL would if the pre-check were ever bypassed, so both
 * the pre-check and the backstop can be exercised independently.
 */
function storedJourney(options: {
  packageExists?: boolean;
  isActive?: boolean;
  seedManaged?: boolean;
  variants?: StoredVariant[];
  reservedVariantIds?: string[];
  /** Skips the pre-check answer, so the delete itself raises. */
  hideReservationsFromPreCheck?: boolean;
} = {}) {
  const state = {
    packageExists: options.packageExists ?? true,
    isActive: options.isActive ?? false,
    seedManaged: options.seedManaged ?? true,
    variants: options.variants ?? threeVariants(),
    reservedVariantIds: options.reservedVariantIds ?? [],
    hideReservationsFromPreCheck: options.hideReservationsFromPreCheck ?? false,
    updatedAt: 0,
    variantDeletes: 0,
    packageWrites: 0,
    released: false,
    discarded: false,
    calls: [] as Recorded[],
  };

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
        const found = state.variants.find((variant) => variant.key === values?.[1]);
        return { rows: found ? [{ id: found.id, is_default: found.is_default }] : [] } as never;
      }

      if (text.includes('COUNT(*) AS remaining')) {
        return {
          rows: [{
            remaining: state.variants.filter((variant) => variant.id !== values?.[1]).length,
          }],
        } as never;
      }

      if (text.includes('FROM package_reservations')) {
        const reserved = !state.hideReservationsFromPreCheck
          && state.reservedVariantIds.includes(values?.[0] as string);
        return { rows: reserved ? [{ found: 1 }] : [] } as never;
      }

      if (text.includes('DELETE FROM package_variants')) {
        const id = values?.[0] as string;

        // What ON DELETE RESTRICT would do.
        if (state.reservedVariantIds.includes(id)) {
          throw foreignKeyViolation('package_reservations_variant_package_fkey');
        }

        // What ON DELETE CASCADE would do: the tiers go with the row.
        state.variants = state.variants.filter((variant) => variant.id !== id);
        state.variantDeletes += 1;
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
      child_min_age: null,
      child_max_age: null,
      child_discount_percent: null,
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

const request = (slug: string, key: string) =>
  ({ params: { slug, key } }) as unknown as Request<{ slug: string; key: string }>;

async function deleteVariant(slug: string, key: string): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await deleteAdminPackageVariantHandler(request(slug, key), res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;
const variantsOf = (captured: Captured) =>
  dataOf(captured).variants as Array<Record<string, unknown>>;
const errorOf = (captured: Captured) =>
  (captured.body as { error: { code: string; message: string } }).error;

const keysOf = (state: { variants: StoredVariant[] }) =>
  [...state.variants].sort((l, r) => l.sort_order - r.sort_order).map((v) => v.key);

describe('admin variant delete: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layers = (adminPackagesRouter as never as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ name: string; handle: unknown }>;
        };
      }>;
    }).stack.filter((entry) => entry.route?.path === '/:slug/variants/:key');

    const layer = layers.find((entry) => entry.route?.methods.delete === true);

    assert.ok(layer?.route, 'DELETE /:slug/variants/:key should be registered');

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

describe('admin variant delete: removing a variant', () => {
  it('removes an unreferenced, non-default variant', async () => {
    const stored = storedJourney({ variants: threeVariants() });

    const captured = await deleteVariant(SLUG, 'beta');

    assert.equal(captured.status, 200);
    assert.deepEqual(keysOf(stored), ['alpha', 'gamma']);
    assert.deepEqual(variantsOf(captured).map((variant) => variant.key), ['alpha', 'gamma']);
    assert.equal(dataOf(captured).variantCount, 2);
  });

  it('lets the rate tiers go by cascade, never deleting them itself', async () => {
    const stored = storedJourney({ variants: threeVariants() });

    const captured = await deleteVariant(SLUG, 'beta');

    assert.ok(
      !stored.calls.some((call) => /DELETE FROM package_rate_tiers/i.test(call.text)),
      'the tiers cascade; deleting them here would be a second write that changes nothing',
    );
    assert.ok(
      !variantsOf(captured).some((variant) => variant.key === 'beta'),
      'and they leave with their variant',
    );
  });

  it('leaves every surviving variant exactly as it was', async () => {
    const stored = storedJourney({ variants: threeVariants() });
    const before = stored.variants
      .filter((variant) => variant.key !== 'beta')
      .map((variant) => ({ ...variant }));

    const captured = await deleteVariant(SLUG, 'beta');

    assert.deepEqual(stored.variants, before, 'ids, labels, flags, positions and rates all held');
    assert.deepEqual(
      variantsOf(captured).map((variant) => [variant.key, variant.isDefault, variant.sortOrder]),
      [['alpha', true, 1], ['gamma', false, 3]],
    );
  });

  it('does not compact the remaining positions', async () => {
    const stored = storedJourney({ variants: threeVariants() });

    const captured = await deleteVariant(SLUG, 'beta');

    assert.deepEqual(
      variantsOf(captured).map((variant) => variant.sortOrder),
      [1, 3],
      'the gap is legal, and closing it is the reordering endpoint\'s job',
    );

    for (const call of stored.calls) {
      assert.ok(
        !/UPDATE package_variants/i.test(call.text),
        'no surviving variant row is written at all',
      );
    }
  });

  it('never moves a default flag or promotes a successor', async () => {
    const stored = storedJourney({ variants: threeVariants() });

    await deleteVariant(SLUG, 'gamma');

    assert.deepEqual(
      stored.variants.map((variant) => [variant.key, variant.is_default]),
      [['alpha', true], ['beta', false]],
      'whatever led the journey still leads it',
    );
  });

  it('allows removing the final variant even though it leads the journey', async () => {
    const stored = storedJourney({
      variants: [storedVariant('1', 'alpha', 1, { is_default: true })],
    });

    const captured = await deleteVariant(SLUG, 'alpha');

    assert.equal(captured.status, 200, 'there is no successor to choose, so no choice is made');
    assert.deepEqual(keysOf(stored), []);
  });

  it('accepts a journey left with no variants at all', async () => {
    storedJourney({ variants: [storedVariant('1', 'alpha', 1, { is_default: true })] });

    const captured = await deleteVariant(SLUG, 'alpha');

    assert.equal(dataOf(captured).variantCount, 0);
    assert.deepEqual(variantsOf(captured), []);
    assert.equal(dataOf(captured).defaultVariantLabel, null);
  });

  it('answers a repeated removal with 404', async () => {
    const stored = storedJourney({ variants: threeVariants() });

    assert.equal((await deleteVariant(SLUG, 'beta')).status, 200);

    const second = await deleteVariant(SLUG, 'beta');

    assert.equal(second.status, 404, 'the variant is gone; there is no unchanged state');
    assert.equal(errorOf(second).code, 'PACKAGE_VARIANT_NOT_FOUND');
    assert.equal(stored.variantDeletes, 1, 'and nothing was deleted twice');
  });
});

describe('admin variant delete: refusals', () => {
  it('refuses a live journey, and writes nothing', async () => {
    const stored = storedJourney({ isActive: true, seedManaged: true, variants: threeVariants() });

    const captured = await deleteVariant(SLUG, 'beta');

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_MUST_BE_INACTIVE');
    assert.match(errorOf(captured).message, /Deactivate the journey first/);
    assert.equal(stored.variantDeletes, 0);
    assert.equal(stored.packageWrites, 0);
    assert.equal(stored.seedManaged, true);
    assert.equal(stored.isActive, true, 'and the journey was not deactivated for them');

    // Refused before the variant is even located.
    assert.ok(!stored.calls.some((call) => call.text.includes('FROM package_variants')));
  });

  it('refuses the leading variant while others remain', async () => {
    const stored = storedJourney({ seedManaged: true, variants: threeVariants() });

    const captured = await deleteVariant(SLUG, 'alpha');

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_VARIANT_IS_DEFAULT');
    assert.match(errorOf(captured).message, /Make another variant the default first/);
    assert.equal(stored.variantDeletes, 0);
    assert.deepEqual(keysOf(stored), ['alpha', 'beta', 'gamma']);
    assert.equal(stored.seedManaged, true, 'a refused removal must not detach a journey');
  });

  it('refuses a variant that has been booked, without attempting the delete', async () => {
    const stored = storedJourney({
      seedManaged: true,
      variants: threeVariants(),
      reservedVariantIds: ['2'],
    });

    const captured = await deleteVariant(SLUG, 'beta');

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_VARIANT_HAS_RESERVATIONS');
    assert.equal(stored.variantDeletes, 0);
    assert.ok(
      !stored.calls.some((call) => call.text.includes('DELETE FROM package_variants')),
      'the pre-check answers before the constraint has to',
    );
    assert.equal(stored.seedManaged, true, 'ownership did not move');
  });

  it('asks about bookings without consulting their status', async () => {
    // A cancelled booking is a record of what was sold and holds the variant
    // exactly as a confirmed one does, so the query must not filter.
    const stored = storedJourney({ variants: threeVariants(), reservedVariantIds: ['2'] });
    await deleteVariant(SLUG, 'beta');

    const check = stored.calls.find((call) => call.text.includes('FROM package_reservations'))!;

    assert.match(check.text, /WHERE variant_id = \$1 LIMIT 1/);
    assert.ok(!/status/i.test(check.text), 'every status blocks equally');
    assert.deepEqual(check.values, ['2']);
  });

  it('falls back to the constraint when a booking slips past the pre-check', async () => {
    const stored = storedJourney({
      seedManaged: true,
      variants: threeVariants(),
      reservedVariantIds: ['2'],
      hideReservationsFromPreCheck: true,
    });

    const captured = await deleteVariant(SLUG, 'beta');

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_VARIANT_HAS_RESERVATIONS');
    assert.deepEqual(keysOf(stored), ['alpha', 'beta', 'gamma'], 'the rollback restored it');
    assert.equal(stored.seedManaged, true);
  });

  it('does not mistake an unrelated foreign key violation for a booking', async () => {
    __setClientFactoryForTests(async () => ({
      async query(text: string) {
        if (text.startsWith('BEGIN') || text.startsWith('ROLLBACK')) return { rows: [] } as never;
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: PACKAGE_ID, is_active: false }] } as never;
        }
        if (text.includes('FROM package_variants') && text.includes('FOR UPDATE')) {
          return { rows: [{ id: '2', is_default: false }] } as never;
        }
        if (text.includes('COUNT(*) AS remaining')) {
          return { rows: [{ remaining: 2 }] } as never;
        }
        if (text.includes('FROM package_reservations')) return { rows: [] } as never;
        if (text.includes('DELETE FROM package_variants')) {
          // Some other reference entirely. Reporting this as "it has
          // bookings" would be a guess dressed as an answer.
          throw foreignKeyViolation('some_other_table_variant_id_fkey');
        }
        return { rows: [] } as never;
      },
      release() {},
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      deleteAdminPackageVariantHandler(request(SLUG, 'beta'), res),
      /violates foreign key constraint/,
      'it stays a server error',
    );
  });

  it('answers a journey nothing matches with 404', async () => {
    const stored = storedJourney({ packageExists: false });

    const captured = await deleteVariant(SLUG, 'beta');

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
    assert.equal(stored.variantDeletes, 0);
  });

  it('tells an unknown variant apart from an unknown journey', async () => {
    const stored = storedJourney({ seedManaged: true, variants: threeVariants() });

    const captured = await deleteVariant(SLUG, 'no-such-variant');

    assert.equal(captured.status, 404);
    assert.equal(errorOf(captured).code, 'PACKAGE_VARIANT_NOT_FOUND');
    assert.equal(stored.variantDeletes, 0);
    assert.equal(stored.seedManaged, true, 'a mistyped key must not detach a journey');
  });

  it('refuses a malformed slug before opening a transaction', async () => {
    const stored = storedJourney({ variants: threeVariants() });

    const captured = await deleteVariant('Not A Slug', 'beta');

    assert.equal(captured.status, 400);
    assert.equal(errorOf(captured).code, 'INVALID_PACKAGE_SLUG');
    assert.equal(stored.calls.length, 0);
  });

  it('refuses a malformed variant key, and says which half is wrong', async () => {
    for (const key of ['Beta', ' beta', 'beta ', 'beta--service', '-beta', '']) {
      const stored = storedJourney({ variants: threeVariants() });
      const captured = await deleteVariant(SLUG, key);

      assert.equal(captured.status, 400, `${JSON.stringify(key)} should be refused`);
      assert.equal(errorOf(captured).code, 'INVALID_PACKAGE_VARIANT_KEY');
      assert.equal(stored.calls.length, 0);
    }
  });
});

describe('admin variant delete: transaction and ownership', () => {
  it('takes ownership of a brochure journey on a real removal', async () => {
    const stored = storedJourney({ seedManaged: true, variants: threeVariants() });

    const captured = await deleteVariant(SLUG, 'beta');

    assert.equal(dataOf(captured).managementSource, 'admin');
    assert.equal(stored.seedManaged, false, 'or the seed would re-create the variant');
    assert.equal(stored.updatedAt, 1);
  });

  it('leaves an already admin-managed journey admin-managed', async () => {
    const stored = storedJourney({ seedManaged: false, variants: threeVariants() });

    assert.equal(dataOf(await deleteVariant(SLUG, 'beta')).managementSource, 'admin');
    assert.equal(stored.seedManaged, false);
  });

  it('runs the whole removal in one transaction, package locked first', async () => {
    const stored = storedJourney({ variants: threeVariants() });
    await deleteVariant(SLUG, 'beta');

    const shape = stored.calls.map((call) => {
      if (call.text.startsWith('BEGIN')) return 'BEGIN';
      if (call.text.startsWith('COMMIT')) return 'COMMIT';
      if (call.text.includes('FROM packages WHERE slug')) return 'LOCK-PACKAGE';
      if (call.text.includes('FROM package_variants') && call.text.includes('FOR UPDATE')) {
        return 'LOCK-VARIANT';
      }
      if (call.text.includes('AS remaining')) return 'COUNT';
      if (call.text.includes('FROM package_reservations')) return 'BOOKED?';
      if (call.text.includes('DELETE FROM package_variants')) return 'DELETE';
      if (call.text.includes('UPDATE packages')) return 'OWN';
      return 'READ';
    });

    assert.deepEqual(shape, [
      'BEGIN', 'LOCK-PACKAGE', 'LOCK-VARIANT', 'COUNT', 'BOOKED?',
      'DELETE', 'OWN', 'READ', 'COMMIT',
    ]);
    assert.equal(stored.released, true);
    assert.equal(stored.discarded, false);
  });

  it('locks the package before the variant', async () => {
    const stored = storedJourney({ variants: threeVariants() });
    await deleteVariant(SLUG, 'beta');

    const packageLock = stored.calls.findIndex(
      (call) => call.text.includes('FROM packages WHERE slug'),
    );
    const variantLock = stored.calls.findIndex(
      (call) => call.text.includes('FROM package_variants') && call.text.includes('FOR UPDATE'),
    );

    assert.equal(packageLock, 1, 'immediately after BEGIN');
    assert.ok(packageLock < variantLock);
    assert.deepEqual(stored.calls[variantLock]!.values, [PACKAGE_ID, 'beta']);
  });

  it('never deletes or recreates the package itself', async () => {
    const stored = storedJourney({ variants: threeVariants() });
    await deleteVariant(SLUG, 'beta');

    for (const call of stored.calls) {
      assert.ok(!/DELETE FROM packages\b/i.test(call.text));
      assert.ok(!/INSERT INTO packages\b/i.test(call.text));
    }

    const own = stored.calls.find((call) => call.text.includes('UPDATE packages'))!;
    assert.match(own.text, /seed_managed = false/);
    assert.match(own.text, /updated_at = UTC_TIMESTAMP\(3\)/);
    for (const column of ['is_active', 'title', 'code', 'slug']) {
      assert.ok(!own.text.includes(column), `${column} must never be written here`);
    }
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
          return { rows: [{ id: '2', is_default: false }] } as never;
        }
        if (text.includes('AS remaining')) return { rows: [{ remaining: 2 }] } as never;
        if (text.includes('FROM package_reservations')) return { rows: [] } as never;
        if (text.includes('FROM packages p')) {
          return {
            rows: [detailRow({
              isActive: false, seedManaged: false, variants: threeVariants(),
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
      deleteAdminPackageVariantHandler(request(SLUG, 'beta'), res),
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
        if (text.includes('DELETE FROM package_variants')) {
          throw new Error('deadlock detected');
        }
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: PACKAGE_ID, is_active: false }] } as never;
        }
        if (text.includes('FROM package_variants') && text.includes('FOR UPDATE')) {
          return { rows: [{ id: '2', is_default: false }] } as never;
        }
        if (text.includes('AS remaining')) return { rows: [{ remaining: 2 }] } as never;
        if (text.includes('FROM package_reservations')) return { rows: [] } as never;
        return { rows: [] } as never;
      },
      release() {
        released = true;
      },
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      deleteAdminPackageVariantHandler(request(SLUG, 'beta'), res),
      /deadlock detected/,
    );

    assert.ok(calls.includes('ROLLBACK'), 'the transaction is rolled back');
    assert.ok(!calls.includes('COMMIT'));
    assert.equal(released, true);
  });
});

describe('admin variant delete: response', () => {
  it('answers with the whole journey under data, and nothing else', async () => {
    storedJourney({ variants: threeVariants() });

    const captured = await deleteVariant(SLUG, 'beta');

    assert.deepEqual(Object.keys(captured.body as object), ['data']);
    assert.equal(dataOf(captured).slug, SLUG);
  });

  it('leaks no database id and no raw ownership column', async () => {
    storedJourney({ seedManaged: true, variants: threeVariants() });

    const captured = await deleteVariant(SLUG, 'beta');
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', 'seed_managed', 'seedManaged', 'package_id', 'packageId',
      'variant_id', 'variantId']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not appear in the response`);
    }
  });
});
