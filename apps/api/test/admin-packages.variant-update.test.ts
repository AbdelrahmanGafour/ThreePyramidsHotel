import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Editing one variant's metadata, without a database.
//
// Two things are load-bearing and both are observed rather than assumed: the
// ownership flip must happen inside the same transaction as the edit, and it
// must not happen at all when the variant was never found. The fake client
// below records every statement in order, so the transaction's shape is
// assertable.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');

let __setClientFactoryForTests: RepositoryModule['__setClientFactoryForTests'];
let updateAdminPackageVariantHandler: ControllerModule['updateAdminPackageVariantHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];

const SLUG = 'nile-dinner-cruise';
const KEY = 'standard-service';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setClientFactoryForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ updateAdminPackageVariantHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
});

afterEach(() => {
  __setClientFactoryForTests(null);
});

function body(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Premium service',
    childMinAge: 6,
    childMaxAge: 12,
    childDiscountPercent: '50.00',
    ...overrides,
  };
}

/** The detail row the final in-transaction read returns. */
function detailRow(state: { seedManaged: boolean; isActive: boolean; label: string }) {
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
    variant_count: 1,
    default_variant_label: state.label,
    // Selected by PACKAGE_DETAIL_COLUMNS now; a row without it is one
    // this repository would never produce. null is no image.
    image: null,
    itinerary: [],
    content: [],
    variants: [{
      key: KEY,
      label: state.label,
      is_default: true,
      sort_order: 1,
      child_min_age: 6,
      child_max_age: 12,
      child_discount_percent: '50.00',
      rates: [
        { min_party_size: 1, max_party_size: 1, adult_unit_rate: '100.00', currency: 'USD' },
        { min_party_size: 2, max_party_size: null, adult_unit_rate: '90.00', currency: 'USD' },
      ],
    }],
  };
}

type Recorded = { text: string; values: unknown[] | undefined };

/**
 * One journey and one variant, with the transaction applied to real state.
 *
 * `variantExists` and `packageExists` drive the two not-found paths, so the
 * ownership flip can be observed as genuinely not happening.
 */
function storedJourney(options: {
  seedManaged?: boolean;
  isActive?: boolean;
  variantExists?: boolean;
  packageExists?: boolean;
} = {}) {
  const state = {
    seedManaged: options.seedManaged ?? true,
    isActive: options.isActive ?? true,
    variantExists: options.variantExists ?? true,
    packageExists: options.packageExists ?? true,
    label: 'Standard service',
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

      // The parent lock comes first and answers package-not-found on its own,
      // so there is no longer a follow-up probe to tell the two apart.
      if (text.includes('FROM packages WHERE slug')) {
        return { rows: state.packageExists ? [{ id: '42' }] : [] } as never;
      }

      // Matched on the lock clause as well as the table: the detail
      // projection also selects FROM package_variants, so a looser match
      // would answer the final read with a lock row.
      if (text.includes('FROM package_variants') && text.includes('FOR UPDATE')) {
        return {
          rows: state.packageExists && state.variantExists ? [{ id: '7' }] : [],
        } as never;
      }

      if (text.includes('UPDATE package_variants')) {
        state.label = values?.[1] as string;
        state.variantWrites += 1;
        return { rows: [] } as never;
      }

      if (text.includes('UPDATE packages')) {
        state.seedManaged = false;
        state.packageWrites += 1;
        return { rows: [] } as never;
      }

      // The final in-transaction read, which sees both writes above.
      return {
        rows: [detailRow({
          seedManaged: state.seedManaged,
          isActive: state.isActive,
          label: state.label,
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

async function editVariant(slug: string, key: string, requestBody: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await updateAdminPackageVariantHandler(request(slug, key, requestBody), res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;
const variantsOf = (captured: Captured) =>
  dataOf(captured).variants as Array<Record<string, unknown>>;

const INVALID_BODY = { error: { code: 'INVALID_PACKAGE', message: 'Invalid package details' } };

describe('admin variant update: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string; handle: unknown }> } }>;
    }).stack.find((entry) => entry.route?.path === '/:slug/variants/:key');

    assert.ok(layer?.route, 'PATCH /:slug/variants/:key should be registered');
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

describe('admin variant update: ownership', () => {
  it('takes ownership of a brochure-managed journey as it edits the variant', async () => {
    const stored = storedJourney({ seedManaged: true });

    const captured = await editVariant(SLUG, KEY, body());

    assert.equal(captured.status, 200);
    assert.equal(dataOf(captured).managementSource, 'admin');
    assert.equal(stored.seedManaged, false, 'the seed must stop reconciling it');
  });

  it('leaves an already admin-managed journey admin-managed', async () => {
    const stored = storedJourney({ seedManaged: false });

    assert.equal(dataOf(await editVariant(SLUG, KEY, body())).managementSource, 'admin');
    assert.equal(stored.seedManaged, false);
  });

  it('does not flip ownership when the variant does not exist', async () => {
    const stored = storedJourney({ variantExists: false });

    const captured = await editVariant(SLUG, 'no-such-variant', body());

    assert.equal(captured.status, 404);
    assert.equal(stored.seedManaged, true, 'a mistyped key must not detach a journey');
    assert.equal(stored.packageWrites, 0, 'no package row was written');
    assert.equal(stored.variantWrites, 0);
  });

  it('does not flip ownership when the journey does not exist', async () => {
    const stored = storedJourney({ packageExists: false });

    const captured = await editVariant(SLUG, KEY, body());

    assert.equal(captured.status, 404);
    assert.equal(stored.packageWrites, 0);
    assert.equal(stored.variantWrites, 0);
  });

  it('performs the edit and the flip inside one transaction', async () => {
    const stored = storedJourney({ seedManaged: true });
    await editVariant(SLUG, KEY, body());

    const order = stored.calls.map((call) => {
      if (call.text.startsWith('BEGIN')) return 'BEGIN';
      if (call.text.startsWith('COMMIT')) return 'COMMIT';
      if (call.text.includes('FROM packages WHERE slug')) return 'LOCK-PACKAGE';
      if (call.text.includes('FROM package_variants') && call.text.includes('FOR UPDATE')) {
        return 'LOCK-VARIANT';
      }
      if (call.text.includes('UPDATE package_variants')) return 'EDIT';
      if (call.text.includes('UPDATE packages')) return 'OWN';
      return 'READ';
    });

    assert.deepEqual(
      order,
      ['BEGIN', 'LOCK-PACKAGE', 'LOCK-VARIANT', 'EDIT', 'OWN', 'READ', 'COMMIT'],
    );
    assert.equal(stored.released, true, 'the connection is always returned to the pool');
    assert.equal(stored.discarded, false, 'a clean transaction leaves a reusable connection');
  });

  it('locks the package before the variant, and both before writing', async () => {
    // The canonical order. Locking the variant first and only then writing to
    // its package — which the ownership flip does — completed a deadlock
    // cycle with every path that takes the package first.
    const stored = storedJourney();
    await editVariant(SLUG, KEY, body());

    const packageLock = stored.calls.find((call) => call.text.includes('FROM packages WHERE slug'));
    assert.ok(packageLock, 'the package row is locked');
    assert.match(packageLock.text, /FOR UPDATE/);
    assert.deepEqual(packageLock.values, [SLUG]);

    const lock = stored.calls.find(
      (call) => call.text.includes('FROM package_variants') && call.text.includes('FOR UPDATE'),
    );
    assert.ok(lock, 'the variant row is locked');
    assert.deepEqual(lock.values, ['42', KEY], 'by package id, under the parent lock');

    const packageLockIndex = stored.calls.indexOf(packageLock);
    const lockIndex = stored.calls.indexOf(lock);
    const editIndex = stored.calls.findIndex((call) => call.text.includes('UPDATE package_variants'));

    assert.ok(packageLockIndex < lockIndex, 'the package is locked before the variant');
    assert.ok(lockIndex < editIndex, 'the locks precede every write');
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
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: '42' }] } as never;
        }
        if (text.includes('FROM package_variants') && text.includes('FOR UPDATE')) {
          return { rows: [{ id: '7' }] } as never;
        }
        if (text.includes('SELECT') && text.includes('FROM packages p')) {
          return { rows: [detailRow({ isActive: true, seedManaged: false, label: 'X' })] } as never;
        }
        return { rows: [] } as never;
      },
      release(discard?: boolean) {
        discarded = discard;
      },
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      updateAdminPackageVariantHandler(request(SLUG, KEY, body()), res),
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
        if (text.includes('UPDATE package_variants')) {
          throw new Error('deadlock detected');
        }
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: '42' }] } as never;
        }
        if (text.includes('FROM package_variants') && text.includes('FOR UPDATE')) {
          return { rows: [{ id: '7' }] } as never;
        }
        return { rows: [] } as never;
      },
      release() {
        released = true;
      },
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      updateAdminPackageVariantHandler(request(SLUG, KEY, body()), res),
      /deadlock detected/,
    );

    assert.ok(calls.includes('ROLLBACK'), 'the transaction is rolled back');
    assert.ok(!calls.includes('COMMIT'));
    assert.equal(released, true);
  });
});

describe('admin variant update: write scope', () => {
  it('updates the label on its own', async () => {
    const stored = storedJourney();

    const captured = await editVariant(SLUG, KEY, body({ label: 'Premium service' }));

    assert.equal(captured.status, 200);
    assert.equal(variantsOf(captured)[0]!.label, 'Premium service');
    assert.equal(stored.label, 'Premium service');
  });

  it('sets the child pricing trio', async () => {
    const stored = storedJourney();
    await editVariant(SLUG, KEY, body({
      childMinAge: 4, childMaxAge: 11, childDiscountPercent: '33.33',
    }));

    const edit = stored.calls.find((call) => call.text.includes('UPDATE package_variants'))!;
    assert.deepEqual(edit.values, ['7', 'Premium service', 4, 11, '33.33']);
  });

  it('clears the child pricing trio to all null', async () => {
    const stored = storedJourney();
    await editVariant(SLUG, KEY, body({
      childMinAge: null, childMaxAge: null, childDiscountPercent: null,
    }));

    const edit = stored.calls.find((call) => call.text.includes('UPDATE package_variants'))!;
    assert.deepEqual(edit.values, ['7', 'Premium service', null, null, null]);
  });

  it('writes four variant columns and no others', async () => {
    const stored = storedJourney();
    await editVariant(SLUG, KEY, body());

    const edit = stored.calls.find((call) => call.text.includes('UPDATE package_variants'))!;
    const setClause = edit.text.split('SET')[1]!.split('WHERE')[0]!;

    for (const column of ['label', 'child_min_age', 'child_max_age', 'child_discount_percent']) {
      assert.ok(setClause.includes(column), `${column} should be written`);
    }
    for (const column of ['key', 'is_default', 'sort_order', 'package_id']) {
      assert.ok(!setClause.includes(column), `${column} must never be written here`);
    }
  });

  it('writes only ownership and the timestamp on the package', async () => {
    const stored = storedJourney();
    await editVariant(SLUG, KEY, body());

    const own = stored.calls.find((call) => call.text.includes('UPDATE packages'))!;
    assert.match(own.text, /seed_managed = false/);
    assert.match(own.text, /updated_at = UTC_TIMESTAMP\(3\)/);

    for (const column of ['is_active', 'title', 'summary', 'code', 'slug', 'sort_order']) {
      assert.ok(!own.text.includes(column), `${column} must never be written by a variant edit`);
    }
  });

  it('touches no rate tier, itinerary section or content item', async () => {
    const stored = storedJourney();
    await editVariant(SLUG, KEY, body());

    for (const call of stored.calls) {
      if (!call.text.startsWith('UPDATE')) continue;
      for (const table of ['package_rate_tiers', 'package_itinerary_sections',
        'package_content_items', 'package_reservations']) {
        assert.ok(!call.text.includes(table), `${table} must not be written`);
      }
    }
  });

  it('leaves the variant\'s rate tiers, key, default flag and order unchanged', async () => {
    storedJourney();

    const [variant] = variantsOf(await editVariant(SLUG, KEY, body()));

    assert.equal(variant.key, KEY);
    assert.equal(variant.isDefault, true);
    assert.equal(variant.sortOrder, 1);
    assert.deepEqual(variant.rates, [
      { minPartySize: 1, maxPartySize: 1, adultUnitRate: '100.00', currency: 'USD' },
      { minPartySize: 2, maxPartySize: null, adultUnitRate: '90.00', currency: 'USD' },
    ]);
  });

  it('leaves publication untouched', async () => {
    for (const isActive of [true, false]) {
      const stored = storedJourney({ isActive });
      assert.equal(dataOf(await editVariant(SLUG, KEY, body())).isActive, isActive);
      assert.equal(stored.isActive, isActive);
    }
  });
});

describe('admin variant update: validation', () => {
  it('refuses a body offering the key, default state, order, rates or ownership', async () => {
    for (const forbidden of [
      { key: 'renamed' },
      { isDefault: true },
      { sortOrder: 2 },
      { rates: [] },
      { isActive: true },
      { seedManaged: true },
      { managementSource: 'brochure' },
      { nonsense: 'ignored' },
    ]) {
      const stored = storedJourney();
      const captured = await editVariant(SLUG, KEY, body(forbidden));

      assert.equal(captured.status, 400, `${JSON.stringify(forbidden)} should be refused`);
      assert.deepEqual(captured.body, INVALID_BODY);
      assert.equal(stored.calls.length, 0, 'a refused field must never open a transaction');
    }
  });

  it('refuses a partial child rule before any write', async () => {
    for (const partial of [
      { childMinAge: 6, childMaxAge: null, childDiscountPercent: null },
      { childMinAge: null, childMaxAge: 12, childDiscountPercent: null },
      { childMinAge: null, childMaxAge: null, childDiscountPercent: '50.00' },
      { childMinAge: 6, childMaxAge: 12, childDiscountPercent: null },
      // Max below min is the other half of the database CHECK.
      { childMinAge: 12, childMaxAge: 6, childDiscountPercent: '50.00' },
    ]) {
      const stored = storedJourney();
      const captured = await editVariant(SLUG, KEY, body(partial));

      assert.equal(captured.status, 400, `${JSON.stringify(partial)} should be refused`);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('keeps the discount an exact two-decimal string within range', async () => {
    for (const childDiscountPercent of [
      50, '50', '50.5', '50.000', '100.01', '-1.00', 'fifty', '', null,
    ]) {
      const stored = storedJourney();
      const captured = await editVariant(SLUG, KEY, body({ childDiscountPercent }));

      assert.equal(captured.status, 400, `${String(childDiscountPercent)} should be refused`);
      assert.equal(stored.calls.length, 0);
    }

    // The bounds themselves are legal.
    for (const childDiscountPercent of ['0.00', '100.00', '33.33']) {
      storedJourney();
      const captured = await editVariant(SLUG, KEY, body({ childDiscountPercent }));
      assert.equal(captured.status, 200, `${childDiscountPercent} should be accepted`);
    }
  });

  it('rejects an invalid label or age with 400, without writing', async () => {
    for (const overrides of [
      { label: '' },
      { label: '  padded  ' },
      { label: null },
      { label: 7 },
      { childMinAge: -1 },
      { childMinAge: 1.5 },
      { childMinAge: '6' },
      { childMaxAge: -1 },
    ]) {
      const stored = storedJourney();
      const captured = await editVariant(SLUG, KEY, body(overrides));

      assert.equal(captured.status, 400, `${JSON.stringify(overrides)} should be refused`);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('requires every editable field', async () => {
    for (const field of ['label', 'childMinAge', 'childMaxAge', 'childDiscountPercent']) {
      const incomplete = body();
      delete (incomplete as Record<string, unknown>)[field];

      const stored = storedJourney();
      const captured = await editVariant(SLUG, KEY, incomplete);

      assert.equal(captured.status, 400, `a body without ${field} should be refused`);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('rejects a malformed slug or key before the body or any write', async () => {
    const badSlug = storedJourney();
    const slugResult = await editVariant('NOT A SLUG', KEY, body());
    assert.equal(slugResult.status, 400);
    assert.deepEqual(slugResult.body, {
      error: { code: 'INVALID_PACKAGE_SLUG', message: 'Invalid package slug' },
    });
    assert.equal(badSlug.calls.length, 0);

    const badKey = storedJourney();
    const keyResult = await editVariant(SLUG, 'NOT A KEY', body());
    assert.equal(keyResult.status, 400);
    assert.deepEqual(keyResult.body, {
      error: { code: 'INVALID_PACKAGE_VARIANT_KEY', message: 'Invalid package variant key' },
    });
    assert.equal(badKey.calls.length, 0);
  });
});

describe('admin variant update: not found', () => {
  it('tells an unknown journey apart from an unknown variant', async () => {
    storedJourney({ packageExists: false });
    const missingPackage = await editVariant(SLUG, KEY, body());

    storedJourney({ variantExists: false });
    const missingVariant = await editVariant(SLUG, KEY, body());

    assert.deepEqual([missingPackage.status, missingVariant.status], [404, 404]);
    assert.deepEqual(missingPackage.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
    assert.deepEqual(missingVariant.body, {
      error: { code: 'PACKAGE_VARIANT_NOT_FOUND', message: 'Package variant not found' },
    });
  });

  it('rolls back rather than leaving a transaction open when nothing matched', async () => {
    const stored = storedJourney({ variantExists: false });
    await editVariant(SLUG, KEY, body());

    const order = stored.calls.map((call) => call.text.split('\n')[0]!.trim());
    assert.ok(order.includes('ROLLBACK'));
    assert.ok(!order.includes('COMMIT'));
    assert.equal(stored.released, true);
  });
});

describe('admin variant update: leakage', () => {
  it('exposes no internal database ids or raw ownership column', async () => {
    storedJourney({ seedManaged: true });

    const captured = await editVariant(SLUG, KEY, body());
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', '"packageId"', '"variantId"', 'package_id', 'variant_id',
      'seed_managed', 'seedManaged', 'updated_at', 'updatedAt']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not reach an admin response`);
    }
  });
});
