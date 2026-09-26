import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Adding one variant to a journey, without a database.
//
// Three things are load-bearing here and all three are observed rather than
// assumed: the new variant's default flag and position are decided by the
// server from state read under the parent lock, a rate-less variant never
// reaches a live journey, and ownership flips only when a row was actually
// written. The fake client below applies each statement to real state and
// records every one in order, so the transaction's shape is assertable.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');

let __setClientFactoryForTests: RepositoryModule['__setClientFactoryForTests'];
let createAdminPackageVariantHandler: ControllerModule['createAdminPackageVariantHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];

const SLUG = 'nile-dinner-cruise';
const PACKAGE_ID = '42';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setClientFactoryForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ createAdminPackageVariantHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
});

afterEach(() => {
  __setClientFactoryForTests(null);
});

function body(overrides: Record<string, unknown> = {}) {
  return {
    key: 'premium-service',
    label: 'Premium service',
    childMinAge: 6,
    childMaxAge: 12,
    childDiscountPercent: '50.00',
    ...overrides,
  };
}

type StoredVariant = {
  key: string;
  label: string;
  is_default: boolean;
  sort_order: number;
  child_min_age: number | null;
  child_max_age: number | null;
  child_discount_percent: string | null;
};

function storedVariant(overrides: Partial<StoredVariant> = {}): StoredVariant {
  return {
    key: 'standard-service',
    label: 'Standard service',
    is_default: true,
    sort_order: 1,
    child_min_age: null,
    child_max_age: null,
    child_discount_percent: null,
    ...overrides,
  };
}

type Recorded = { text: string; values: unknown[] | undefined };

/** A uniqueness violation shaped the way `pg` reports one. */
function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
}

/**
 * One journey, with the transaction applied to real state.
 *
 * Every statement the repository issues is answered from `variants`, and the
 * insert appends to it, so the detail the endpoint reads back is the state
 * the endpoint itself produced rather than a fixture that agrees with it by
 * construction.
 */
function storedJourney(options: {
  packageExists?: boolean;
  isActive?: boolean;
  requiresPriceConfirmation?: boolean;
  seedManaged?: boolean;
  variants?: StoredVariant[];
} = {}) {
  const state = {
    packageExists: options.packageExists ?? true,
    isActive: options.isActive ?? false,
    requiresPriceConfirmation: options.requiresPriceConfirmation ?? false,
    seedManaged: options.seedManaged ?? true,
    variants: options.variants ?? [],
    packageWrites: 0,
    variantWrites: 0,
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

      // Only the parent lock carries FOR UPDATE, so this cannot be answered
      // by the aggregate or the detail read.
      if (text.includes('FOR UPDATE')) {
        return {
          rows: state.packageExists
            ? [{ id: PACKAGE_ID, is_active: state.isActive }]
            : [],
        } as never;
      }

      if (text.includes('INSERT INTO package_variants')) {
        const [, key, label, isDefault, sortOrder, minAge, maxAge, discount] = values!;

        if (state.variants.some((variant) => variant.key === key)) {
          throw uniqueViolation('package_variants_package_key_key');
        }
        if (state.variants.some((variant) => variant.sort_order === sortOrder)) {
          throw uniqueViolation('package_variants_package_sort_key');
        }

        state.variants.push({
          key: key as string,
          label: label as string,
          is_default: isDefault as boolean,
          sort_order: sortOrder as number,
          child_min_age: minAge as number | null,
          child_max_age: maxAge as number | null,
          child_discount_percent: discount as string | null,
        });
        state.variantWrites += 1;
        return { rows: [] } as never;
      }

      if (text.includes('UPDATE packages')) {
        state.seedManaged = false;
        state.packageWrites += 1;
        return { rows: [] } as never;
      }

      // `default_count` appears only in the aggregate; the detail projection
      // selects a `variant_count` of its own, so a looser match would answer
      // the wrong statement.
      if (text.includes('default_count')) {
        return {
          rows: [{
            variant_count: state.variants.length,
            default_count: state.variants.filter((variant) => variant.is_default).length,
            max_sort_order: state.variants.reduce(
              (max, variant) => Math.max(max, variant.sort_order),
              0,
            ),
          }],
        } as never;
      }

      // The final in-transaction read, which sees both writes above.
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
  requiresPriceConfirmation: boolean;
  seedManaged: boolean;
  variants: StoredVariant[];
}) {
  const ordered = [...state.variants].sort((left, right) => left.sort_order - right.sort_order);

  return {
    code: 'T016',
    slug: SLUG,
    title: 'Nile Dinner Cruise',
    summary: null,
    duration_label: 'Evening',
    schedule_label: 'Daily',
    requires_price_confirmation: state.requiresPriceConfirmation,
    is_active: state.isActive,
    sort_order: 16,
    seed_managed: state.seedManaged,
    description: null,
    operating_days: null,
    variant_count: ordered.length,
    default_variant_label: ordered.find((variant) => variant.is_default)?.label ?? null,
    itinerary: [],
    content: [],
    // Every variant carries an empty rate set: this endpoint inserts none,
    // and nothing else in the transaction could have.
    variants: ordered.map((variant) => ({ ...variant, rates: [] })),
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

const request = (slug: string, requestBody: unknown) =>
  ({ params: { slug }, body: requestBody }) as unknown as Request<{ slug: string }>;

async function createVariant(slug: string, requestBody: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await createAdminPackageVariantHandler(request(slug, requestBody), res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;
const variantsOf = (captured: Captured) =>
  dataOf(captured).variants as Array<Record<string, unknown>>;
const errorOf = (captured: Captured) =>
  (captured.body as { error: { code: string; message: string } }).error;

const insertOf = (calls: Recorded[]) =>
  calls.find((call) => call.text.includes('INSERT INTO package_variants'));

const INVALID_BODY = { error: { code: 'INVALID_PACKAGE', message: 'Invalid package details' } };

describe('admin variant create: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ name: string; handle: unknown }>;
        };
      }>;
    }).stack.find((entry) => entry.route?.path === '/:slug/variants');

    assert.ok(layer?.route, 'POST /:slug/variants should be registered');
    assert.equal(layer.route.methods.post, true, 'it should be a POST route');

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

describe('admin variant create: server-owned default', () => {
  it('makes the first variant of a journey its default', async () => {
    const stored = storedJourney({ variants: [] });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 201);
    assert.equal(insertOf(stored.calls)!.values![3], true, 'is_default is written as true');
    assert.equal(variantsOf(captured)[0]!.isDefault, true);
    assert.equal(dataOf(captured).defaultVariantLabel, 'Premium service');
  });

  it('adds every later variant as a non-default', async () => {
    const stored = storedJourney({ variants: [storedVariant({ is_default: true })] });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 201);
    assert.equal(insertOf(stored.calls)!.values![3], false);

    const added = variantsOf(captured).find((variant) => variant.key === 'premium-service')!;
    assert.equal(added.isDefault, false);
    assert.equal(
      dataOf(captured).defaultVariantLabel,
      'Standard service',
      'which variant leads the journey is unchanged',
    );
  });

  it('never reads a default flag from the request', async () => {
    const stored = storedJourney({ variants: [storedVariant()] });

    // Offered explicitly, and refused rather than honoured or ignored.
    const captured = await createVariant(SLUG, body({ isDefault: true }));

    assert.equal(captured.status, 400);
    assert.deepEqual(captured.body, INVALID_BODY);
    assert.equal(stored.variantWrites, 0);
  });

  it('refuses to add a second variant beside a lone unflagged one', async () => {
    // Today a reservation naming no variant resolves to the lone variant
    // whatever its flag. A second one would make those requests ambiguous,
    // so the state is refused rather than silently changed.
    const stored = storedJourney({ variants: [storedVariant({ is_default: false })] });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_VARIANT_DEFAULT_UNSAFE');
    assert.match(errorOf(captured).message, /Mark the existing variant as the default first/);
    assert.equal(stored.variantWrites, 0, 'nothing was written');
    assert.equal(stored.seedManaged, true, 'and ownership did not move');
  });

  it('allows a third variant where no default exists, which changes nothing', async () => {
    // With two or more and no flag, an unqualified reservation is already
    // refused as ambiguous; adding another leaves that exactly as it was.
    const stored = storedJourney({
      variants: [
        storedVariant({ key: 'a', is_default: false, sort_order: 1 }),
        storedVariant({ key: 'b', is_default: false, sort_order: 2 }),
      ],
    });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 201);
    assert.equal(stored.variantWrites, 1);
    assert.equal(insertOf(stored.calls)!.values![3], false);
  });
});

describe('admin variant create: server-owned order', () => {
  it('appends one past the highest position in use', async () => {
    const stored = storedJourney({
      variants: [
        storedVariant({ key: 'a', sort_order: 4, is_default: true }),
        storedVariant({ key: 'b', sort_order: 9, is_default: false }),
      ],
    });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 201);
    assert.equal(insertOf(stored.calls)!.values![4], 10);
    assert.deepEqual(
      variantsOf(captured).map((variant) => variant.sortOrder),
      [4, 9, 10],
      'no existing variant moved',
    );
  });

  it('starts an empty journey at the brochure numbering base', async () => {
    const stored = storedJourney({ variants: [] });

    await createVariant(SLUG, body());

    assert.equal(insertOf(stored.calls)!.values![4], 1);
  });

  it('never reads a position from the request', async () => {
    const stored = storedJourney({ variants: [storedVariant()] });

    const captured = await createVariant(SLUG, body({ sortOrder: 0 }));

    assert.equal(captured.status, 400);
    assert.equal(stored.variantWrites, 0);
  });

  it('refuses an exhausted ordering rather than overflowing int4', async () => {
    const stored = storedJourney({
      variants: [storedVariant({ sort_order: 2147483647, is_default: true })],
    });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_VARIANT_ORDER_EXHAUSTED');
    assert.equal(stored.variantWrites, 0, 'no value was written to find out');
    assert.equal(stored.seedManaged, true);
  });
});

describe('admin variant create: publication safety', () => {
  it('refuses to add a rate-less variant to a live journey, and writes nothing', async () => {
    const stored = storedJourney({ isActive: true, variants: [storedVariant()] });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_MUST_BE_INACTIVE');
    assert.equal(stored.variantWrites, 0);
    assert.equal(stored.packageWrites, 0);
    assert.equal(stored.seedManaged, true, 'ownership did not move');
    assert.equal(stored.isActive, true, 'and the journey was not deactivated for them');
  });

  it('still refuses when the journey is quoted on request', async () => {
    // Being quoted changes what a guest is told about the price, not whether
    // a rate tier has to exist, so it bypasses nothing.
    const stored = storedJourney({
      isActive: true,
      requiresPriceConfirmation: true,
      variants: [storedVariant()],
    });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_MUST_BE_INACTIVE');
    assert.equal(stored.variantWrites, 0);
    assert.equal(stored.isActive, true);
  });

  it('reads the publication state under the lock, never from the request', async () => {
    const stored = storedJourney({ isActive: true, variants: [storedVariant()] });

    await createVariant(SLUG, body({ isActive: false }));

    // Refused as a malformed body long before the lock; the point is that no
    // path exists by which a request states the journey's publication.
    assert.equal(stored.calls.length, 0);

    const honest = storedJourney({ isActive: true, variants: [storedVariant()] });
    await createVariant(SLUG, body());

    const lock = honest.calls.find((call) => call.text.includes('FOR UPDATE'))!;
    assert.match(lock.text, /SELECT id, is_active FROM packages/);
  });

  it('inserts no rate tier for the new variant', async () => {
    const stored = storedJourney({ variants: [] });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 201);
    // The detail projection reads the table, so what is asserted is that
    // nothing WRITES to it.
    const writes = stored.calls.filter((call) => /INSERT INTO package_rate_tiers|UPDATE package_rate_tiers|DELETE FROM package_rate_tiers/.test(call.text));
    assert.deepEqual(writes, [], 'no rate tier is written');
    assert.deepEqual(variantsOf(captured)[0]!.rates, [], 'the variant arrives unpriced');
  });
});

describe('admin variant create: ownership', () => {
  it('takes ownership of a brochure journey as it adds the variant', async () => {
    const stored = storedJourney({ seedManaged: true, variants: [storedVariant()] });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 201);
    assert.equal(dataOf(captured).managementSource, 'admin');
    assert.equal(stored.seedManaged, false, 'the seed must stop reconciling it');
  });

  it('leaves an already admin-managed journey admin-managed', async () => {
    const stored = storedJourney({ seedManaged: false, variants: [storedVariant()] });

    assert.equal(dataOf(await createVariant(SLUG, body())).managementSource, 'admin');
    assert.equal(stored.seedManaged, false);
  });

  it('does not flip ownership when the journey does not exist', async () => {
    const stored = storedJourney({ packageExists: false });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
    assert.equal(stored.packageWrites, 0);
    assert.equal(stored.variantWrites, 0);
    assert.equal(stored.seedManaged, true, 'a mistyped slug must not detach a journey');
  });

  it('does not flip ownership when the key is already taken', async () => {
    const stored = storedJourney({
      seedManaged: true,
      variants: [storedVariant({ key: 'premium-service', is_default: true })],
    });

    const captured = await createVariant(SLUG, body({ key: 'premium-service' }));

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_VARIANT_KEY_IN_USE');
    assert.equal(stored.seedManaged, true);
    assert.equal(stored.packageWrites, 0);
    assert.equal(stored.variants.length, 1, 'nothing was appended');
  });

  it('does not flip ownership when the body is malformed', async () => {
    const stored = storedJourney({ variants: [storedVariant()] });

    assert.equal((await createVariant(SLUG, body({ label: '' }))).status, 400);
    assert.equal(stored.calls.length, 0, 'the transaction never opened');
    assert.equal(stored.seedManaged, true);
  });

  it('performs the insert and the flip inside one transaction', async () => {
    const stored = storedJourney({ seedManaged: true, variants: [storedVariant()] });
    await createVariant(SLUG, body());

    const order = stored.calls.map((call) => {
      if (call.text.startsWith('BEGIN')) return 'BEGIN';
      if (call.text.startsWith('COMMIT')) return 'COMMIT';
      if (call.text.includes('FOR UPDATE')) return 'LOCK';
      if (call.text.includes('default_count')) return 'COUNT';
      if (call.text.includes('INSERT INTO package_variants')) return 'INSERT';
      if (call.text.includes('UPDATE packages')) return 'OWN';
      return 'READ';
    });

    assert.deepEqual(order, ['BEGIN', 'LOCK', 'COUNT', 'INSERT', 'OWN', 'READ', 'COMMIT']);
    assert.equal(stored.released, true, 'the connection is always returned to the pool');
    assert.equal(stored.discarded, false, 'a clean transaction leaves a reusable connection');
  });

  it('writes only ownership and the timestamp on the package', async () => {
    const stored = storedJourney({ variants: [storedVariant()] });
    await createVariant(SLUG, body());

    const own = stored.calls.find((call) => call.text.includes('UPDATE packages'))!;
    assert.match(own.text, /seed_managed = false/);
    assert.match(own.text, /updated_at = now\(\)/);

    for (const column of ['is_active', 'title', 'summary', 'code', 'slug', 'sort_order']) {
      assert.ok(!own.text.includes(column), `${column} must never be written by a variant create`);
    }
  });
});

describe('admin variant create: concurrency', () => {
  it('locks the parent journey before reading anything it decides from', async () => {
    const stored = storedJourney({ variants: [storedVariant()] });
    await createVariant(SLUG, body());

    const lock = stored.calls.find((call) => call.text.includes('FOR UPDATE'))!;
    assert.ok(lock, 'the package row is locked');
    assert.match(lock.text, /FROM packages WHERE slug = \$1 FOR UPDATE/);
    assert.deepEqual(lock.values, [SLUG]);

    const lockIndex = stored.calls.indexOf(lock);
    assert.equal(
      stored.calls[lockIndex - 1]!.text.startsWith('BEGIN'),
      true,
      'the lock is the transaction\'s first statement',
    );

    // Two simultaneous creates against one journey therefore serialize: the
    // second waits on this row, then counts the variant the first inserted
    // rather than reading the same "before" state.
    for (const marker of ['default_count', 'INSERT INTO package_variants', 'UPDATE packages']) {
      const index = stored.calls.findIndex((call) => call.text.includes(marker));
      assert.ok(index > lockIndex, `${marker} must come after the lock`);
    }
  });

  it('locks the parent rather than the variant table, which has no row to lock yet', async () => {
    const stored = storedJourney({ variants: [] });
    await createVariant(SLUG, body());

    const locks = stored.calls.filter((call) => call.text.includes('FOR UPDATE'));
    assert.equal(locks.length, 1, 'exactly one lock is taken');
    assert.ok(!locks[0]!.text.includes('package_variants'));
  });

  it('discards the connection and sends no rollback when COMMIT itself fails', async () => {
    // A COMMIT that throws leaves an outcome nobody can know, so nothing is
    // sent after it and the connection is never reused.
    const calls: string[] = [];
    let discarded: boolean | undefined;

    __setClientFactoryForTests(async () => ({
      async query(text: string) {
        calls.push(text.trim().split(/\s/)[0]!);
        if (text.startsWith('COMMIT')) throw new Error('commit failed');
        if (text.includes('FOR UPDATE')) {
          return { rows: [{ id: PACKAGE_ID, is_active: false }] } as never;
        }
        if (text.includes('default_count')) {
          return {
            rows: [{ variant_count: 0, default_count: 0, max_sort_order: 0 }],
          } as never;
        }
        if (text.includes('FROM packages p')) {
          return {
            rows: [detailRow({
              isActive: false,
              requiresPriceConfirmation: false,
              seedManaged: false,
              variants: [storedVariant({ key: 'premium-service', label: 'Premium service' })],
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
      createAdminPackageVariantHandler(request(SLUG, body()), res),
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
        if (text.includes('INSERT INTO package_variants')) {
          throw new Error('deadlock detected');
        }
        if (text.includes('FOR UPDATE')) {
          return { rows: [{ id: PACKAGE_ID, is_active: false }] } as never;
        }
        if (text.includes('default_count')) {
          return {
            rows: [{ variant_count: 0, default_count: 0, max_sort_order: 0 }],
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
      createAdminPackageVariantHandler(request(SLUG, body()), res),
      /deadlock detected/,
    );

    assert.ok(calls.includes('ROLLBACK'), 'the transaction is rolled back');
    assert.ok(!calls.includes('COMMIT'));
    assert.equal(released, true);
  });

  it('raises rather than guessing when a constraint it should not reach refuses', async () => {
    // A position collision means this function computed a sort order it had
    // no business computing; it is a fault, not a duplicate key.
    __setClientFactoryForTests(async () => ({
      async query(text: string) {
        if (text.includes('INSERT INTO package_variants')) {
          throw uniqueViolation('package_variants_package_sort_key');
        }
        if (text.includes('FOR UPDATE')) {
          return { rows: [{ id: PACKAGE_ID, is_active: false }] } as never;
        }
        if (text.includes('default_count')) {
          return {
            rows: [{ variant_count: 0, default_count: 0, max_sort_order: 0 }],
          } as never;
        }
        return { rows: [] } as never;
      },
      release() {},
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      createAdminPackageVariantHandler(request(SLUG, body()), res),
      /duplicate key value/,
    );
  });
});

describe('admin variant create: body', () => {
  it('writes exactly the five supplied fields, plus the two it owns', async () => {
    const stored = storedJourney({ variants: [] });
    await createVariant(SLUG, body());

    const insert = insertOf(stored.calls)!;
    assert.deepEqual(insert.values, [
      PACKAGE_ID, 'premium-service', 'Premium service', true, 1, 6, 12, '50.00',
    ]);

    const columns = insert.text.split('(')[1]!.split(')')[0]!;
    for (const column of ['key', 'label', 'is_default', 'sort_order']) {
      assert.ok(columns.includes(column));
    }
    assert.ok(!columns.includes('currency'), 'no price of any kind is written');
  });

  it('preserves the child discount as the exact string it arrived as', async () => {
    for (const discount of ['33.33', '0.01', '100.00', '7.50']) {
      const stored = storedJourney({ variants: [] });
      const captured = await createVariant(SLUG, body({ childDiscountPercent: discount }));

      const written = insertOf(stored.calls)!.values![7];
      assert.equal(written, discount, `${discount} should be written verbatim`);
      assert.equal(typeof written, 'string', 'never routed through a float');
      assert.equal(variantsOf(captured)[0]!.childDiscountPercent, discount);
    }
  });

  it('accepts a variant with no child pricing at all', async () => {
    const stored = storedJourney({ variants: [] });

    const captured = await createVariant(SLUG, body({
      childMinAge: null, childMaxAge: null, childDiscountPercent: null,
    }));

    assert.equal(captured.status, 201);
    assert.deepEqual(insertOf(stored.calls)!.values!.slice(5), [null, null, null]);
  });

  it('refuses a half-set child rule, as the database CHECK does', async () => {
    for (const overrides of [
      { childMinAge: 6, childMaxAge: null, childDiscountPercent: null },
      { childMinAge: null, childMaxAge: 12, childDiscountPercent: '50.00' },
      { childMinAge: 6, childMaxAge: 12, childDiscountPercent: null },
      { childMinAge: 12, childMaxAge: 6, childDiscountPercent: '50.00' },
    ]) {
      const stored = storedJourney({ variants: [] });
      assert.equal((await createVariant(SLUG, body(overrides))).status, 400);
      assert.equal(stored.variantWrites, 0);
    }
  });

  it('refuses a discount that is not an exact two-decimal percentage', async () => {
    for (const discount of [50, '50', '50.5', '50.005', '100.01', '-1.00', ' 50.00', null]) {
      const stored = storedJourney({ variants: [] });
      assert.equal(
        (await createVariant(SLUG, body({ childDiscountPercent: discount }))).status,
        400,
        `${String(discount)} should be refused`,
      );
      assert.equal(stored.variantWrites, 0);
    }
  });

  it('refuses a key that is not a variant key', async () => {
    for (const key of ['Premium', 'premium service', 'premium--service', '-premium', '', 7, null]) {
      const stored = storedJourney({ variants: [] });
      assert.equal(
        (await createVariant(SLUG, body({ key }))).status,
        400,
        `${String(key)} should be refused`,
      );
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses every field the server owns, rather than ignoring it', async () => {
    for (const field of ['isDefault', 'sortOrder', 'rates', 'isActive', 'seedManaged',
      'seed_managed', 'managementSource', 'id', 'packageId', 'slug', 'code']) {
      const stored = storedJourney({ variants: [] });
      const captured = await createVariant(SLUG, body({ [field]: 'anything' }));

      assert.equal(captured.status, 400, `${field} must be refused`);
      assert.deepEqual(captured.body, INVALID_BODY);
      assert.equal(stored.calls.length, 0, `${field} must not reach the database`);
    }
  });

  it('refuses a malformed slug before opening a transaction', async () => {
    const stored = storedJourney({ variants: [] });

    const captured = await createVariant('Not A Slug', body());

    assert.equal(captured.status, 400);
    assert.equal(errorOf(captured).code, 'INVALID_PACKAGE_SLUG');
    assert.equal(stored.calls.length, 0);
  });

  it('refuses a body that is not an object at all', async () => {
    for (const malformed of [null, 'variant', 42, [body()]]) {
      const stored = storedJourney({ variants: [] });
      assert.equal((await createVariant(SLUG, malformed)).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });
});

describe('admin variant create: response', () => {
  it('answers 201 with the whole journey as it now stands', async () => {
    storedJourney({ variants: [storedVariant()] });

    const captured = await createVariant(SLUG, body());

    assert.equal(captured.status, 201);
    assert.deepEqual(Object.keys(captured.body as object), ['data']);
    assert.equal(dataOf(captured).slug, SLUG);
    assert.equal(dataOf(captured).variantCount, 2);
    assert.equal(variantsOf(captured).length, 2);
  });

  it('leaks no database id and no raw ownership column', async () => {
    storedJourney({ seedManaged: true, variants: [storedVariant()] });

    const captured = await createVariant(SLUG, body());
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', 'seed_managed', 'seedManaged', 'package_id', 'packageId',
      'variant_id', 'variantId']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not appear in the response`);
    }

    assert.equal(dataOf(captured).managementSource, 'admin', 'ownership is stated in words');
  });

  it('reports the journey as still unpublished', async () => {
    storedJourney({ variants: [] });

    const captured = await createVariant(SLUG, body());

    assert.equal(dataOf(captured).isActive, false, 'adding a variant never publishes');
  });
});
