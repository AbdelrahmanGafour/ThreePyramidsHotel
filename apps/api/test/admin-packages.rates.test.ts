import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Replacing one variant's whole rate set, without a database.
//
// The fake client below holds a real tier list and applies the transaction to
// it, so "replaced, not appended" and "rolled back on failure" are observed
// rather than asserted against a stub. Statement order is recorded too: the
// delete and the inserts must sit inside one transaction, because between
// them the variant has no rates at all.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');
type ValidationModule = typeof import('../src/modules/admin-packages/admin-packages.validation.js');

let __setClientFactoryForTests: RepositoryModule['__setClientFactoryForTests'];
let replaceAdminPackageRatesHandler: ControllerModule['replaceAdminPackageRatesHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];
let ratesOverlap: ValidationModule['ratesOverlap'];

const SLUG = 'nile-dinner-cruise';
const KEY = 'standard-service';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setClientFactoryForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ replaceAdminPackageRatesHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
  ({ ratesOverlap } = await import(
    '../src/modules/admin-packages/admin-packages.validation.js'
  ));
});

afterEach(() => {
  __setClientFactoryForTests(null);
});

type Tier = { min: number; max: number | null; rate: string };

const THREE_TIERS = {
  rates: [
    { minPartySize: 1, maxPartySize: 1, adultUnitRate: '100.00' },
    { minPartySize: 2, maxPartySize: 2, adultUnitRate: '90.00' },
    { minPartySize: 3, maxPartySize: null, adultUnitRate: '80.00' },
  ],
};

function detailRow(state: { seedManaged: boolean; isActive: boolean; tiers: Tier[] }) {
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
    variant_count: 1,
    default_variant_label: 'Standard service',
    // Selected by PACKAGE_DETAIL_COLUMNS now; a row without it is one
    // this repository would never produce. null is no image.
    image: null,
    itinerary: [],
    content: [],
    variants: [{
      key: KEY,
      label: 'Standard service',
      is_default: true,
      sort_order: 1,
      child_min_age: null,
      child_max_age: null,
      child_discount_percent: null,
      // The projection orders tiers by min_party_size; the fake mirrors that.
      rates: [...state.tiers]
        .sort((left, right) => left.min - right.min)
        .map((tier) => ({
          min_party_size: tier.min,
          max_party_size: tier.max,
          adult_unit_rate: tier.rate,
          currency: 'USD',
        })),
    }],
  };
}

type Recorded = { text: string; values: unknown[] | undefined };

/**
 * One journey with one variant and a real tier list.
 *
 * `failOn` makes a chosen statement throw, so the rollback path can be
 * observed restoring the previous tiers.
 */
function storedJourney(options: {
  seedManaged?: boolean;
  isActive?: boolean;
  requiresPriceConfirmation?: boolean;
  variantExists?: boolean;
  packageExists?: boolean;
  tiers?: Tier[];
  failOn?: string;
  failWith?: Record<string, unknown>;
} = {}) {
  const committed: Tier[] = options.tiers ?? [{ min: 1, max: null, rate: '120.00' }];

  const state = {
    seedManaged: options.seedManaged ?? true,
    isActive: options.isActive ?? true,
    requiresPriceConfirmation: options.requiresPriceConfirmation ?? false,
    variantExists: options.variantExists ?? true,
    packageExists: options.packageExists ?? true,
    /** What a reader outside the transaction would see. */
    committed,
    /** What the open transaction has built so far. */
    pending: [...committed],
    inserts: 0,
    deletes: 0,
    packageWrites: 0,
    released: false,
    discarded: false,
    calls: [] as Recorded[],
  };

  __setClientFactoryForTests(async () => ({
    async query(text: string, values?: unknown[]) {
      state.calls.push({ text, values });

      if (options.failOn && text.includes(options.failOn)) {
        throw Object.assign(new Error('statement failed'), options.failWith ?? {});
      }

      if (text.startsWith('BEGIN')) {
        state.pending = [...state.committed];
        return { rows: [] } as never;
      }

      if (text.startsWith('COMMIT')) {
        state.committed = [...state.pending];
        return { rows: [] } as never;
      }

      if (text.startsWith('ROLLBACK')) {
        state.pending = [...state.committed];
        return { rows: [] } as never;
      }

      // The parent lock comes first and carries the publication columns the
      // empty-set rule turns on, so there is no longer a follow-up probe to
      // tell a missing journey from a missing variant.
      if (text.includes('FROM packages WHERE slug')) {
        return {
          rows: state.packageExists
            ? [{
              id: '42',
              is_active: state.isActive,
              requires_price_confirmation: state.requiresPriceConfirmation,
            }]
            : [],
        } as never;
      }

      if (text.includes('FROM package_variants') && text.includes('FOR UPDATE')) {
        return {
          rows: state.packageExists && state.variantExists ? [{ id: '7' }] : [],
        } as never;
      }

      if (text.includes('DELETE FROM package_rate_tiers')) {
        state.pending = [];
        state.deletes += 1;
        return { rows: [] } as never;
      }

      if (text.includes('INSERT INTO package_rate_tiers')) {
        state.pending.push({
          min: values?.[1] as number,
          max: values?.[2] as number | null,
          rate: values?.[3] as string,
        });
        state.inserts += 1;
        return { rows: [] } as never;
      }

      if (text.includes('UPDATE packages')) {
        state.seedManaged = false;
        state.packageWrites += 1;
        return { rows: [] } as never;
      }

      // The in-transaction read, which sees the pending set.
      return {
        rows: [detailRow({
          seedManaged: state.seedManaged,
          isActive: state.isActive,
          tiers: state.pending,
        })],
      } as never;
    },
    release(discard?: boolean) {
      state.released = true;
      state.discarded = discard === true;
    },
  }) as never);

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

const request = (slug: string, key: string, requestBody: unknown) =>
  ({ params: { slug, key }, body: requestBody }) as unknown as Request<{ slug: string; key: string }>;

async function replaceRates(slug: string, key: string, requestBody: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await replaceAdminPackageRatesHandler(request(slug, key, requestBody), res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;
const tiersOf = (captured: Captured) =>
  (dataOf(captured).variants as Array<Record<string, unknown>>)[0]!
    .rates as Array<Record<string, unknown>>;

const OVERLAP_BODY = {
  error: {
    code: 'OVERLAPPING_RATE_TIERS',
    message: 'Rate tiers must not cover overlapping party sizes',
  },
};

describe('admin rate replacement: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string; handle: unknown }> } }>;
    }).stack.find((entry) => entry.route?.path === '/:slug/variants/:key/rates');

    assert.ok(layer?.route, 'PUT /:slug/variants/:key/rates should be registered');
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

describe('admin rate replacement: replacing', () => {
  it('replaces the whole set and answers with it', async () => {
    const stored = storedJourney({ tiers: [{ min: 1, max: null, rate: '120.00' }] });

    const captured = await replaceRates(SLUG, KEY, THREE_TIERS);

    assert.equal(captured.status, 200);
    assert.deepEqual(tiersOf(captured), [
      { minPartySize: 1, maxPartySize: 1, adultUnitRate: '100.00', currency: 'USD' },
      { minPartySize: 2, maxPartySize: 2, adultUnitRate: '90.00', currency: 'USD' },
      { minPartySize: 3, maxPartySize: null, adultUnitRate: '80.00', currency: 'USD' },
    ]);
  });

  it('replaces rather than appends', async () => {
    const stored = storedJourney({
      tiers: [
        { min: 1, max: 5, rate: '500.00' },
        { min: 6, max: null, rate: '400.00' },
      ],
    });

    await replaceRates(SLUG, KEY, THREE_TIERS);

    assert.equal(stored.deletes, 1, 'the old set is removed first');
    assert.equal(stored.inserts, 3);
    assert.equal(stored.committed.length, 3, 'the old tiers are gone, not kept alongside');
    assert.ok(!stored.committed.some((tier) => tier.rate === '500.00'));
  });

  it('keeps an open-ended final tier open-ended', async () => {
    storedJourney();

    const tiers = tiersOf(await replaceRates(SLUG, KEY, THREE_TIERS));

    assert.equal(tiers[2]!.maxPartySize, null, 'a null upper bound is "3 or more"');
  });

  it('preserves exact decimal strings', async () => {
    const stored = storedJourney();

    const captured = await replaceRates(SLUG, KEY, {
      rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '999.99' }],
    });

    assert.equal(tiersOf(captured)[0]!.adultUnitRate, '999.99');
    assert.equal(typeof tiersOf(captured)[0]!.adultUnitRate, 'string');

    const insert = stored.calls.find((call) => call.text.includes('INSERT INTO package_rate_tiers'))!;
    assert.equal(insert.values?.[3], '999.99', 'the exact string is what is bound');
  });

  it('writes USD as a literal the caller cannot influence', async () => {
    const stored = storedJourney();
    await replaceRates(SLUG, KEY, THREE_TIERS);

    const insert = stored.calls.find((call) => call.text.includes('INSERT INTO package_rate_tiers'))!;
    assert.match(insert.text, /\$4, 'USD'/);
    assert.equal(insert.values?.length, 4, 'four bound values, none of them a currency');
  });

  it('returns tiers in a deterministic order', async () => {
    storedJourney();

    // Submitted out of order; the reply is ordered by party size regardless.
    const captured = await replaceRates(SLUG, KEY, {
      rates: [
        { minPartySize: 3, maxPartySize: null, adultUnitRate: '80.00' },
        { minPartySize: 1, maxPartySize: 1, adultUnitRate: '100.00' },
        { minPartySize: 2, maxPartySize: 2, adultUnitRate: '90.00' },
      ],
    });

    assert.deepEqual(tiersOf(captured).map((tier) => tier.minPartySize), [1, 2, 3]);
  });

  it('runs the delete and the inserts inside one transaction', async () => {
    const stored = storedJourney();
    await replaceRates(SLUG, KEY, THREE_TIERS);

    const order = stored.calls.map((call) => {
      if (call.text.startsWith('BEGIN')) return 'BEGIN';
      if (call.text.startsWith('COMMIT')) return 'COMMIT';
      if (call.text.includes('FROM packages WHERE slug')) return 'LOCK-PACKAGE';
      if (call.text.includes('FROM package_variants') && call.text.includes('FOR UPDATE')) {
        return 'LOCK-VARIANT';
      }
      if (call.text.includes('DELETE FROM package_rate_tiers')) return 'DELETE';
      if (call.text.includes('INSERT INTO package_rate_tiers')) return 'INSERT';
      if (call.text.includes('UPDATE packages')) return 'OWN';
      return 'READ';
    });

    assert.deepEqual(order, [
      'BEGIN', 'LOCK-PACKAGE', 'LOCK-VARIANT', 'DELETE', 'INSERT', 'INSERT', 'INSERT',
      'OWN', 'READ', 'COMMIT',
    ]);
    assert.ok(order.indexOf('DELETE') > order.indexOf('BEGIN'));
    assert.ok(order.indexOf('COMMIT') > order.lastIndexOf('INSERT'),
      'no reader outside the transaction can observe the gap');
    assert.equal(stored.released, true);
    assert.equal(stored.discarded, false);
  });
});

describe('admin rate replacement: ownership', () => {
  it('takes ownership of a brochure-managed journey on a successful replacement', async () => {
    const stored = storedJourney({ seedManaged: true });

    assert.equal(dataOf(await replaceRates(SLUG, KEY, THREE_TIERS)).managementSource, 'admin');
    assert.equal(stored.seedManaged, false);
  });

  it('leaves an already admin-managed journey admin-managed', async () => {
    const stored = storedJourney({ seedManaged: false });

    assert.equal(dataOf(await replaceRates(SLUG, KEY, THREE_TIERS)).managementSource, 'admin');
    assert.equal(stored.seedManaged, false);
  });

  it('does not flip ownership when the variant or the journey is missing', async () => {
    const missingVariant = storedJourney({ variantExists: false });
    assert.equal((await replaceRates(SLUG, KEY, THREE_TIERS)).status, 404);
    assert.equal(missingVariant.seedManaged, true);
    assert.equal(missingVariant.packageWrites, 0);
    assert.equal(missingVariant.deletes, 0, 'nothing was deleted either');

    const missingPackage = storedJourney({ packageExists: false });
    assert.equal((await replaceRates(SLUG, KEY, THREE_TIERS)).status, 404);
    assert.equal(missingPackage.seedManaged, true);
    assert.equal(missingPackage.packageWrites, 0);
  });

  it('does not flip ownership when an empty set is refused', async () => {
    const stored = storedJourney({ seedManaged: true, isActive: true });

    assert.equal((await replaceRates(SLUG, KEY, { rates: [] })).status, 409);
    assert.equal(stored.seedManaged, true, 'a refused request changes nothing');
    assert.equal(stored.deletes, 0);
  });
});

describe('admin rate replacement: empty set policy', () => {
  it('allows an empty set for an inactive journey', async () => {
    const stored = storedJourney({ isActive: false });

    const captured = await replaceRates(SLUG, KEY, { rates: [] });

    assert.equal(captured.status, 200);
    assert.deepEqual(tiersOf(captured), []);
    assert.equal(stored.committed.length, 0);
  });

  it('allows an empty set for a journey quoted on request', async () => {
    const stored = storedJourney({ isActive: true, requiresPriceConfirmation: true });

    assert.equal((await replaceRates(SLUG, KEY, { rates: [] })).status, 200);
    assert.equal(stored.committed.length, 0);
  });

  it('refuses an empty set for an active, deterministically-priced journey', async () => {
    const stored = storedJourney({ isActive: true, requiresPriceConfirmation: false });

    const captured = await replaceRates(SLUG, KEY, { rates: [] });

    assert.equal(captured.status, 409);
    assert.equal((captured.body as { error: { code: string } }).error.code, 'PACKAGE_RATES_REQUIRED');
    assert.match(
      (captured.body as { error: { message: string } }).error.message,
      /Deactivate it, or mark it quoted on request/,
    );
    // The journey is not silently withdrawn on the administrator's behalf.
    assert.equal(stored.isActive, true);
    assert.equal(stored.committed.length, 1, 'the existing tiers are untouched');
  });
});

describe('admin rate replacement: overlap', () => {
  it('detects every shape of overlap before any write', async () => {
    const overlapping = [
      // Two tiers covering a party of two.
      [{ minPartySize: 1, maxPartySize: 2, adultUnitRate: '10.00' },
        { minPartySize: 2, maxPartySize: 3, adultUnitRate: '9.00' }],
      // Duplicate lower bounds.
      [{ minPartySize: 1, maxPartySize: 1, adultUnitRate: '10.00' },
        { minPartySize: 1, maxPartySize: 2, adultUnitRate: '9.00' }],
      // An open-ended tier that is not last swallows what follows.
      [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '10.00' },
        { minPartySize: 5, maxPartySize: null, adultUnitRate: '9.00' }],
      // Fully contained.
      [{ minPartySize: 1, maxPartySize: 10, adultUnitRate: '10.00' },
        { minPartySize: 3, maxPartySize: 4, adultUnitRate: '9.00' }],
    ];

    for (const rates of overlapping) {
      const stored = storedJourney();
      const captured = await replaceRates(SLUG, KEY, { rates });

      assert.equal(captured.status, 409, `${JSON.stringify(rates)} should conflict`);
      assert.deepEqual(captured.body, OVERLAP_BODY);
      assert.equal(stored.calls.length, 0, 'no transaction was opened');
    }
  });

  it('accepts adjacent and gapped tiers, which do not overlap', async () => {
    for (const rates of [
      THREE_TIERS.rates,
      // A deliberate gap is legal; the reservation path refuses the sizes in it.
      [{ minPartySize: 1, maxPartySize: 1, adultUnitRate: '10.00' },
        { minPartySize: 5, maxPartySize: null, adultUnitRate: '9.00' }],
    ]) {
      storedJourney();
      assert.equal((await replaceRates(SLUG, KEY, { rates })).status, 200);
    }
  });

  it('answers the database exclusion constraint as a conflict, not a 500', async () => {
    // The final integrity guard: reaching it means the pre-flight check missed
    // something, and the rollback has already restored the old set.
    const stored = storedJourney({
      failOn: 'INSERT INTO package_rate_tiers',
      failWith: { code: '23P01' },
    });

    const captured = await replaceRates(SLUG, KEY, THREE_TIERS);

    assert.equal(captured.status, 409);
    assert.deepEqual(captured.body, OVERLAP_BODY);
    assert.equal(stored.committed.length, 1, 'the old set survived the rollback');
    assert.equal(stored.seedManaged, true, 'and ownership did not move');
  });

  it('agrees with the pure overlap check', () => {
    assert.equal(ratesOverlap(THREE_TIERS.rates), false);
    assert.equal(ratesOverlap([]), false);
    assert.equal(ratesOverlap([{ minPartySize: 1, maxPartySize: null, adultUnitRate: '1.00' }]), false);
    assert.equal(ratesOverlap([
      { minPartySize: 1, maxPartySize: 3, adultUnitRate: '1.00' },
      { minPartySize: 3, maxPartySize: 5, adultUnitRate: '1.00' },
    ]), true);
  });
});

describe('admin rate replacement: failure handling', () => {
  it('rolls back and restores the old tiers when a statement fails', async () => {
    const stored = storedJourney({
      tiers: [{ min: 1, max: null, rate: '120.00' }],
      failOn: 'UPDATE packages',
    });

    const { res } = fakeResponse();
    await assert.rejects(
      replaceAdminPackageRatesHandler(request(SLUG, KEY, THREE_TIERS), res),
      /statement failed/,
    );

    assert.deepEqual(stored.committed, [{ min: 1, max: null, rate: '120.00' }],
      'the previous set is intact');
    assert.equal(stored.seedManaged, true, 'ownership did not move');
    assert.ok(stored.calls.some((call) => call.text.startsWith('ROLLBACK')));
    assert.ok(!stored.calls.some((call) => call.text.startsWith('COMMIT')));
    assert.equal(stored.released, true);
  });

  it('discards the connection and sends no rollback when COMMIT itself fails', async () => {
    const stored = storedJourney({ failOn: 'COMMIT' });

    const { res } = fakeResponse();
    await assert.rejects(
      replaceAdminPackageRatesHandler(request(SLUG, KEY, THREE_TIERS), res),
      /statement failed/,
    );

    // The outcome is genuinely unknown, so nothing claims either way.
    const afterCommit = stored.calls
      .slice(stored.calls.findIndex((call) => call.text.startsWith('COMMIT')) + 1);
    assert.deepEqual(afterCommit, [], 'no statement is sent after a failed COMMIT');
    assert.equal(stored.discarded, true, 'the connection is poisoned rather than reused');
  });
});

describe('admin rate replacement: validation', () => {
  it('rejects an invalid body with 400, without opening a transaction', async () => {
    const cases: unknown[] = [
      null,
      [],
      'rates',
      {},
      { rates: null },
      { rates: {} },
      { rates: [], extra: true },
      { rates: [{ minPartySize: 0, maxPartySize: 1, adultUnitRate: '10.00' }] },
      { rates: [{ minPartySize: -1, maxPartySize: null, adultUnitRate: '10.00' }] },
      { rates: [{ minPartySize: 1.5, maxPartySize: null, adultUnitRate: '10.00' }] },
      { rates: [{ minPartySize: 5, maxPartySize: 2, adultUnitRate: '10.00' }] },
      { rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: 10 }] },
      { rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '10' }] },
      { rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '10.5' }] },
      { rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '10.000' }] },
      { rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '-1.00' }] },
      { rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '99999999999.00' }] },
      { rates: [{ minPartySize: 1, maxPartySize: null }] },
      // Currency is the system's to decide, never the caller's.
      { rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '10.00', currency: 'EGP' }] },
      { rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '10.00', currency: 'USD' }] },
      { rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '10.00', id: '1' }] },
    ];

    for (const requestBody of cases) {
      const stored = storedJourney();
      const captured = await replaceRates(SLUG, KEY, requestBody);

      assert.equal(captured.status, 400, `${JSON.stringify(requestBody)} should be refused`);
      assert.equal(stored.calls.length, 0, 'an invalid body must never open a transaction');
    }
  });

  it('rejects a malformed slug or key before the body or any write', async () => {
    const badSlug = storedJourney();
    const slugResult = await replaceRates('NOT A SLUG', KEY, THREE_TIERS);
    assert.equal(slugResult.status, 400);
    assert.deepEqual(slugResult.body, {
      error: { code: 'INVALID_PACKAGE_SLUG', message: 'Invalid package slug' },
    });
    assert.equal(badSlug.calls.length, 0);

    const badKey = storedJourney();
    const keyResult = await replaceRates(SLUG, 'NOT A KEY', THREE_TIERS);
    assert.equal(keyResult.status, 400);
    assert.deepEqual(keyResult.body, {
      error: { code: 'INVALID_PACKAGE_VARIANT_KEY', message: 'Invalid package variant key' },
    });
    assert.equal(badKey.calls.length, 0);
  });

  it('tells an unknown journey apart from an unknown variant', async () => {
    storedJourney({ packageExists: false });
    const missingPackage = await replaceRates(SLUG, KEY, THREE_TIERS);

    storedJourney({ variantExists: false });
    const missingVariant = await replaceRates(SLUG, KEY, THREE_TIERS);

    assert.deepEqual(missingPackage.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
    assert.deepEqual(missingVariant.body, {
      error: { code: 'PACKAGE_VARIANT_NOT_FOUND', message: 'Package variant not found' },
    });
  });
});

describe('admin rate replacement: leakage', () => {
  it('exposes no internal database ids or raw ownership column', async () => {
    storedJourney({ seedManaged: true });

    const captured = await replaceRates(SLUG, KEY, THREE_TIERS);
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', '"packageId"', '"variantId"', 'package_id', 'variant_id',
      'seed_managed', 'seedManaged', 'updated_at']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not reach an admin response`);
    }
  });
});
