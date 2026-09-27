import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Choosing which variant leads a journey, without a database.
//
// The load-bearing part of this endpoint is the ORDER of two statements. The
// partial unique index on `(package_id) WHERE is_default` is not deferrable,
// so the old default must be cleared in its own statement before the new one
// is set — and a single combined UPDATE would collide only sometimes, which
// is worse than always. The fake client below records every statement in
// order and applies it to real state, so that order is assertable rather than
// assumed.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');

let __setClientFactoryForTests: RepositoryModule['__setClientFactoryForTests'];
let setAdminPackageDefaultVariantHandler: ControllerModule['setAdminPackageDefaultVariantHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];

const SLUG = 'nile-dinner-cruise';
const PACKAGE_ID = '42';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setClientFactoryForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ setAdminPackageDefaultVariantHandler } = await import(
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
};

function storedVariant(overrides: Partial<StoredVariant> = {}): StoredVariant {
  return {
    id: '1',
    key: 'standard-service',
    label: 'Standard service',
    is_default: false,
    sort_order: 1,
    ...overrides,
  };
}

/** Two variants, the first leading. The ordinary A -> B fixture. */
const twoVariants = (): StoredVariant[] => [
  storedVariant({ id: '1', key: 'standard-service', label: 'Standard', is_default: true, sort_order: 1 }),
  storedVariant({ id: '2', key: 'premium-service', label: 'Premium', is_default: false, sort_order: 2 }),
];

type Recorded = { text: string; values: unknown[] | undefined };

/**
 * One journey, with the transaction applied to real state.
 *
 * The clear and the set are applied as PostgreSQL would apply them, so the
 * detail the endpoint reads back is the state the endpoint itself produced.
 * `updatedAt` is a counter rather than a timestamp: what matters is whether
 * it moved, not what it moved to.
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
    variants: options.variants ?? twoVariants(),
    updatedAt: 0,
    variantWrites: 0,
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

      if (text.includes('FROM package_variants WHERE package_id')) {
        return {
          rows: state.variants.map((variant) => ({
            id: variant.id, key: variant.key, is_default: variant.is_default,
          })),
        } as never;
      }

      if (text.includes('SET is_default = false')) {
        for (const variant of state.variants) {
          if (variant.is_default) variant.is_default = false;
        }
        state.variantWrites += 1;
        return { rows: [] } as never;
      }

      if (text.includes('SET is_default = true')) {
        const target = state.variants.find((variant) => variant.key === values?.[1]);

        // The real index would refuse a second default outright; this makes
        // that visible rather than silently allowing it.
        if (state.variants.some((variant) => variant.is_default)) {
          throw Object.assign(
            new Error('duplicate key value violates unique constraint'),
            { code: '23505', constraint: 'package_variants_one_default_per_package_idx' },
          );
        }

        if (target) target.is_default = true;
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
    duration_label: 'Evening',
    schedule_label: 'Daily',
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
      rates: [
        { min_party_size: 1, max_party_size: null, adult_unit_rate: '100.00', currency: 'USD' },
      ],
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

async function setDefault(slug: string, body: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await setAdminPackageDefaultVariantHandler(request(slug, body), res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;
const variantsOf = (captured: Captured) =>
  dataOf(captured).variants as Array<Record<string, unknown>>;
const errorOf = (captured: Captured) =>
  (captured.body as { error: { code: string; message: string } }).error;

/** Each statement reduced to a token, in the order it was issued. */
const shapeOf = (calls: Recorded[]) => calls.map((call) => {
  if (call.text.startsWith('BEGIN')) return 'BEGIN';
  if (call.text.startsWith('COMMIT')) return 'COMMIT';
  if (call.text.startsWith('ROLLBACK')) return 'ROLLBACK';
  if (call.text.includes('FROM packages WHERE slug')) return 'LOCK-PACKAGE';
  if (call.text.includes('FROM package_variants WHERE package_id')) return 'LOCK-VARIANTS';
  if (call.text.includes('SET is_default = false')) return 'CLEAR';
  if (call.text.includes('SET is_default = true')) return 'SET';
  if (call.text.includes('UPDATE packages')) return 'OWN';
  return 'READ';
});

const INVALID_BODY = { error: { code: 'INVALID_PACKAGE', message: 'Invalid package details' } };

describe('admin default variant: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ name: string; handle: unknown }>;
        };
      }>;
    }).stack.find((entry) => entry.route?.path === '/:slug/default-variant');

    assert.ok(layer?.route, 'PUT /:slug/default-variant should be registered');
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

describe('admin default variant: moving the flag', () => {
  it('moves the default from one variant to another', async () => {
    const stored = storedJourney({ variants: twoVariants() });

    const captured = await setDefault(SLUG, { variantKey: 'premium-service' });

    assert.equal(captured.status, 200);
    assert.deepEqual(
      variantsOf(captured).map((variant) => [variant.key, variant.isDefault]),
      [['standard-service', false], ['premium-service', true]],
    );
    assert.equal(dataOf(captured).defaultVariantLabel, 'Premium');
  });

  it('clears the old default in its own statement, before setting the new one', async () => {
    // The partial unique index is not deferrable, so this order is the
    // correctness argument, not a preference.
    const stored = storedJourney({ variants: twoVariants() });
    await setDefault(SLUG, { variantKey: 'premium-service' });

    const shape = shapeOf(stored.calls);
    assert.deepEqual(shape, [
      'BEGIN', 'LOCK-PACKAGE', 'LOCK-VARIANTS', 'CLEAR', 'SET', 'OWN', 'READ', 'COMMIT',
    ]);
    assert.ok(shape.indexOf('CLEAR') < shape.indexOf('SET'), 'clear precedes set');
    assert.equal(stored.released, true);
    assert.equal(stored.discarded, false);
  });

  it('never merges the two writes into one statement', async () => {
    const stored = storedJourney({ variants: twoVariants() });
    await setDefault(SLUG, { variantKey: 'premium-service' });

    const writes = stored.calls.filter((call) => call.text.includes('SET is_default'));
    assert.equal(writes.length, 2, 'exactly two statements, never one combined UPDATE');

    for (const write of writes) {
      // A combined write would need a CASE or a boolean expression over every
      // row; each of these sets one literal.
      assert.ok(!/CASE/i.test(write.text), 'no conditional write');
      assert.ok(!/key = \$2\)/.test(write.text.split('SET')[1]!.split('WHERE')[0]!));
    }

    assert.match(writes[0]!.text, /SET is_default = false WHERE package_id = \$1 AND is_default/);
    assert.match(writes[1]!.text, /SET is_default = true WHERE package_id = \$1 AND key = \$2/);
    assert.deepEqual(writes[1]!.values, [PACKAGE_ID, 'premium-service']);
  });

  it('repairs a journey whose only variant is not the default', async () => {
    // The state variant creation refuses as unsafe; this is its cure.
    const stored = storedJourney({
      variants: [storedVariant({ key: 'standard-service', is_default: false })],
    });

    const captured = await setDefault(SLUG, { variantKey: 'standard-service' });

    assert.equal(captured.status, 200);
    assert.equal(variantsOf(captured)[0]!.isDefault, true);
    assert.equal(stored.seedManaged, false, 'a row changed, so ownership moved');
  });

  it('repairs several variants that have no default at all', async () => {
    const stored = storedJourney({
      variants: [
        storedVariant({ id: '1', key: 'a', label: 'A', is_default: false, sort_order: 1 }),
        storedVariant({ id: '2', key: 'b', label: 'B', is_default: false, sort_order: 2 }),
      ],
    });

    const captured = await setDefault(SLUG, { variantKey: 'b' });

    assert.equal(captured.status, 200);
    assert.equal(dataOf(captured).defaultVariantLabel, 'B');

    // The clear still runs and simply matches nothing, which is a state to
    // repair rather than an error.
    const shape = shapeOf(stored.calls);
    assert.ok(shape.includes('CLEAR'));
    assert.ok(shape.indexOf('CLEAR') < shape.indexOf('SET'));
  });

  it('changes nothing else about the journey', async () => {
    const stored = storedJourney({ variants: twoVariants() });
    await setDefault(SLUG, { variantKey: 'premium-service' });

    // Statements that WRITE. A lock's `FOR UPDATE` is not one of them, and
    // matching it here would flag the `is_active` this endpoint only reads.
    for (const call of stored.calls) {
      if (!/^(UPDATE |INSERT INTO|DELETE FROM)/.test(call.text.trim())) continue;
      for (const forbidden of ['sort_order', 'label', 'child_min_age', 'child_max_age',
        'child_discount_percent', 'package_rate_tiers', 'is_active', 'title', 'code', 'slug']) {
        assert.ok(!call.text.includes(forbidden), `${forbidden} must never be written here`);
      }
    }

    const own = stored.calls.find((call) => call.text.includes('UPDATE packages'))!;
    assert.match(own.text, /seed_managed = false/);
    assert.match(own.text, /updated_at = now\(\)/);
  });

  it('preserves publication, and never deactivates on the administrator\'s behalf', async () => {
    const stored = storedJourney({ isActive: false, variants: twoVariants() });

    const captured = await setDefault(SLUG, { variantKey: 'premium-service' });

    assert.equal(dataOf(captured).isActive, false);
    assert.equal(stored.isActive, false, 'untouched');
  });
});

describe('admin default variant: the no-op', () => {
  it('answers 200 for the variant that already leads', async () => {
    const stored = storedJourney({ variants: twoVariants() });

    const captured = await setDefault(SLUG, { variantKey: 'standard-service' });

    assert.equal(captured.status, 200);
    assert.equal(dataOf(captured).defaultVariantLabel, 'Standard');
    assert.equal(variantsOf(captured)[0]!.isDefault, true);
  });

  it('writes nothing at all', async () => {
    const stored = storedJourney({ variants: twoVariants() });
    await setDefault(SLUG, { variantKey: 'standard-service' });

    assert.equal(stored.variantWrites, 0, 'no variant row is written');
    assert.equal(stored.packageWrites, 0, 'no package row is written');
    assert.equal(stored.updatedAt, 0, 'when the journey last changed is not rewritten');

    assert.deepEqual(shapeOf(stored.calls), [
      'BEGIN', 'LOCK-PACKAGE', 'LOCK-VARIANTS', 'READ', 'ROLLBACK',
    ]);
  });

  it('does not move ownership, because nothing diverged from the brochure', async () => {
    const stored = storedJourney({ seedManaged: true, variants: twoVariants() });

    const captured = await setDefault(SLUG, { variantKey: 'standard-service' });

    assert.equal(stored.seedManaged, true);
    assert.equal(dataOf(captured).managementSource, 'brochure');
  });

  it('is idempotent: asking twice says the same thing twice', async () => {
    storedJourney({ variants: twoVariants() });
    const first = await setDefault(SLUG, { variantKey: 'standard-service' });
    const second = await setDefault(SLUG, { variantKey: 'standard-service' });

    assert.equal(first.status, 200);
    assert.deepEqual(first.body, second.body);
  });

  it('settles after a real change, so a repeated request becomes the no-op', async () => {
    const stored = storedJourney({ variants: twoVariants() });

    await setDefault(SLUG, { variantKey: 'premium-service' });
    const writesAfterFirst = stored.variantWrites;

    const captured = await setDefault(SLUG, { variantKey: 'premium-service' });

    assert.equal(captured.status, 200);
    assert.equal(stored.variantWrites, writesAfterFirst, 'the second request wrote nothing');
  });
});

describe('admin default variant: refusals', () => {
  it('refuses a live journey, and writes nothing', async () => {
    const stored = storedJourney({ isActive: true, seedManaged: true, variants: twoVariants() });

    const captured = await setDefault(SLUG, { variantKey: 'premium-service' });

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_MUST_BE_INACTIVE');
    assert.match(errorOf(captured).message, /Deactivate the journey first/);
    assert.equal(stored.variantWrites, 0);
    assert.equal(stored.packageWrites, 0);
    assert.equal(stored.seedManaged, true, 'ownership did not move');
    assert.equal(stored.isActive, true, 'and the journey was not deactivated for them');

    // Refused before the variants are even read.
    assert.deepEqual(shapeOf(stored.calls), ['BEGIN', 'LOCK-PACKAGE', 'ROLLBACK']);
  });

  it('answers a journey nothing matches with 404', async () => {
    const stored = storedJourney({ packageExists: false });

    const captured = await setDefault(SLUG, { variantKey: 'premium-service' });

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
    assert.equal(stored.variantWrites, 0);
  });

  it('tells an unknown variant apart from an unknown journey', async () => {
    const stored = storedJourney({ seedManaged: true, variants: twoVariants() });

    const captured = await setDefault(SLUG, { variantKey: 'no-such-variant' });

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_VARIANT_NOT_FOUND', message: 'Package variant not found' },
    });
    assert.equal(stored.variantWrites, 0);
    assert.equal(stored.seedManaged, true, 'a mistyped key must not detach a journey');
  });

  it('treats a journey with no variants as an unknown variant', async () => {
    const stored = storedJourney({ variants: [] });

    const captured = await setDefault(SLUG, { variantKey: 'premium-service' });

    assert.equal(captured.status, 404);
    assert.equal(errorOf(captured).code, 'PACKAGE_VARIANT_NOT_FOUND');
    assert.equal(stored.variantWrites, 0);
  });

  it('refuses a body carrying anything but the key', async () => {
    for (const body of [
      { variantKey: 'premium-service', isDefault: true },
      { variantKey: 'premium-service', sortOrder: 1 },
      { variantKey: 'premium-service', label: 'Premium' },
      { variantKey: 'premium-service', rates: [] },
      { variantKey: 'premium-service', isActive: false },
      { variantKey: 'premium-service', slug: SLUG },
      {},
      { key: 'premium-service' },
    ]) {
      const stored = storedJourney({ variants: twoVariants() });
      const captured = await setDefault(SLUG, body);

      assert.equal(captured.status, 400, `${JSON.stringify(body)} should be refused`);
      assert.deepEqual(captured.body, INVALID_BODY);
      assert.equal(stored.calls.length, 0, 'the transaction never opened');
    }
  });

  it('refuses a key that is not a variant key, rather than repairing it', async () => {
    for (const variantKey of ['Premium', ' premium-service', 'premium-service ',
      'premium service', 'premium--service', '-premium', '', 7, null, 'a'.repeat(121)]) {
      const stored = storedJourney({ variants: twoVariants() });
      assert.equal(
        (await setDefault(SLUG, { variantKey })).status,
        400,
        `${String(variantKey)} should be refused`,
      );
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses a malformed slug before opening a transaction', async () => {
    const stored = storedJourney({ variants: twoVariants() });

    const captured = await setDefault('Not A Slug', { variantKey: 'premium-service' });

    assert.equal(captured.status, 400);
    assert.equal(errorOf(captured).code, 'INVALID_PACKAGE_SLUG');
    assert.equal(stored.calls.length, 0);
  });

  it('refuses a body that is not an object at all', async () => {
    for (const body of [null, 'premium-service', 42, ['premium-service']]) {
      const stored = storedJourney({ variants: twoVariants() });
      assert.equal((await setDefault(SLUG, body)).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });
});

describe('admin default variant: ownership', () => {
  it('takes ownership of a brochure journey on a real change', async () => {
    const stored = storedJourney({ seedManaged: true, variants: twoVariants() });

    const captured = await setDefault(SLUG, { variantKey: 'premium-service' });

    assert.equal(dataOf(captured).managementSource, 'admin');
    assert.equal(stored.seedManaged, false, 'the seed must stop reconciling it');
  });

  it('leaves an already admin-managed journey admin-managed', async () => {
    const stored = storedJourney({ seedManaged: false, variants: twoVariants() });

    assert.equal(
      dataOf(await setDefault(SLUG, { variantKey: 'premium-service' })).managementSource,
      'admin',
    );
    assert.equal(stored.seedManaged, false);
  });

  it('performs the switch and the flip inside one transaction', async () => {
    const stored = storedJourney({ seedManaged: true, variants: twoVariants() });
    await setDefault(SLUG, { variantKey: 'premium-service' });

    const shape = shapeOf(stored.calls);
    assert.ok(shape.indexOf('OWN') > shape.indexOf('SET'), 'ownership moves after the switch');
    assert.ok(shape.indexOf('OWN') < shape.indexOf('COMMIT'), 'and inside the same transaction');
    assert.ok(shape.indexOf('READ') > shape.indexOf('OWN'), 'the read sees both writes');
  });
});

describe('admin default variant: locking', () => {
  it('locks the package before the variants, and both before any write', async () => {
    const stored = storedJourney({ variants: twoVariants() });
    await setDefault(SLUG, { variantKey: 'premium-service' });

    const packageLock = stored.calls.find((call) => call.text.includes('FROM packages WHERE slug'))!;
    assert.match(packageLock.text, /FOR UPDATE/);
    assert.deepEqual(packageLock.values, [SLUG]);

    const variantLock = stored.calls.find(
      (call) => call.text.includes('FROM package_variants WHERE package_id'),
    )!;
    assert.match(variantLock.text, /FOR UPDATE/);
    assert.deepEqual(variantLock.values, [PACKAGE_ID]);

    // Package before variants: the same order the seed and the public
    // reservation path take, so no deadlock cycle exists among them.
    const shape = shapeOf(stored.calls);
    assert.ok(shape.indexOf('LOCK-PACKAGE') < shape.indexOf('LOCK-VARIANTS'));
    assert.ok(shape.indexOf('LOCK-VARIANTS') < shape.indexOf('CLEAR'));
    assert.equal(shape[0], 'BEGIN');
    assert.equal(shape[1], 'LOCK-PACKAGE', 'the lock is the transaction\'s first statement');
  });

  it('locks every sibling variant, not only the target', async () => {
    const stored = storedJourney({ variants: twoVariants() });
    await setDefault(SLUG, { variantKey: 'premium-service' });

    const variantLock = stored.calls.find(
      (call) => call.text.includes('FROM package_variants WHERE package_id'),
    )!;

    assert.ok(!variantLock.text.includes('key ='), 'the whole set is held, not one row');
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
        if (text.includes('FROM package_variants WHERE package_id')) {
          return {
            rows: [
              { id: '1', key: 'standard-service', is_default: true },
              { id: '2', key: 'premium-service', is_default: false },
            ],
          } as never;
        }
        if (text.includes('FROM packages p')) {
          return {
            rows: [detailRow({ isActive: false, seedManaged: false, variants: twoVariants() })],
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
      setAdminPackageDefaultVariantHandler(request(SLUG, { variantKey: 'premium-service' }), res),
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
        if (text.includes('SET is_default = true')) throw new Error('deadlock detected');
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: PACKAGE_ID, is_active: false }] } as never;
        }
        if (text.includes('FROM package_variants WHERE package_id')) {
          return {
            rows: [
              { id: '1', key: 'standard-service', is_default: true },
              { id: '2', key: 'premium-service', is_default: false },
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
      setAdminPackageDefaultVariantHandler(request(SLUG, { variantKey: 'premium-service' }), res),
      /deadlock detected/,
    );

    assert.ok(calls.includes('ROLLBACK'), 'the transaction is rolled back');
    assert.ok(!calls.includes('COMMIT'));
    assert.equal(released, true);
  });
});

describe('admin default variant: response', () => {
  it('answers with the whole journey under data, and nothing else', async () => {
    storedJourney({ variants: twoVariants() });

    const captured = await setDefault(SLUG, { variantKey: 'premium-service' });

    assert.deepEqual(Object.keys(captured.body as object), ['data']);
    assert.equal(dataOf(captured).slug, SLUG);
    assert.equal(dataOf(captured).variantCount, 2);
  });

  it('leaks no database id and no raw ownership column', async () => {
    storedJourney({ seedManaged: true, variants: twoVariants() });

    const captured = await setDefault(SLUG, { variantKey: 'premium-service' });
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', 'seed_managed', 'seedManaged', 'package_id', 'packageId',
      'variant_id', 'variantId']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not appear in the response`);
    }

    assert.equal(dataOf(captured).managementSource, 'admin', 'ownership is stated in words');
  });

  it('leaks nothing on the no-op path either', async () => {
    storedJourney({ variants: twoVariants() });

    const captured = await setDefault(SLUG, { variantKey: 'standard-service' });
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', 'seed_managed', 'package_id']) {
      assert.ok(!serialized.includes(leaked));
    }
  });
});
