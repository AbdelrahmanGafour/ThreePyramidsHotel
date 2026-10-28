import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Removing a whole journey, without a database.
//
// The load-bearing parts are what this endpoint does NOT do. It issues one
// DELETE and lets four tables go by cascade, so the fake below models those
// cascades and the tests assert no child table is ever named. And eligibility
// turns on the journey's brochure IDENTITY rather than on `seed_managed`,
// because deleting a brochure identity does not remove the journey — the seed
// recreates it — so both flags are varied independently here.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');
type BrochureModule = typeof import('../src/modules/admin-packages/admin-packages.brochure.js');

let __setClientFactoryForTests: RepositoryModule['__setClientFactoryForTests'];
let deleteAdminPackageHandler: ControllerModule['deleteAdminPackageHandler'];
let createDeleteAdminPackageHandler: ControllerModule['createDeleteAdminPackageHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];
let reservedBrochureIdentities: BrochureModule['reservedBrochureIdentities'];

const SLUG = 'admin-made-journey';
const CODE = 'ADMIN-001';
const PACKAGE_ID = '42';

/** A real brochure identity, taken from the catalogue rather than guessed. */
let brochureCode: string;
let brochureSlug: string;

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setClientFactoryForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ deleteAdminPackageHandler, createDeleteAdminPackageHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
  ({ reservedBrochureIdentities } = await import(
    '../src/modules/admin-packages/admin-packages.brochure.js'
  ));

  // The helper reports the two sets separately; the code and the slug need
  // not belong to the same brochure entry, because each is tested on its own.
  const { codes, slugs } = reservedBrochureIdentities();
  assert.ok(codes[0] && slugs[0], 'the brochure catalogue should have entries to test against');
  brochureCode = codes[0];
  brochureSlug = slugs[0];
});

afterEach(() => {
  __setClientFactoryForTests(null);
});

type Recorded = { text: string; values: unknown[] | undefined };

/** A foreign key violation shaped the way `pg` reports one. */
function foreignKeyViolation(constraint: string): Error {
  return Object.assign(new Error('update or delete on table violates foreign key constraint'), {
    code: '23503',
    constraint,
  });
}

/**
 * One journey with everything it owns, and the cascades modelled.
 *
 * Deleting the package clears the four child collections the way the schema
 * would, so a test can assert they went without the endpoint ever naming
 * them. `reserved` drives the RESTRICT, and `hideReservationsFromPreCheck`
 * exercises the backstop independently of the pre-check.
 */
function storedJourney(options: {
  packageExists?: boolean;
  isActive?: boolean;
  seedManaged?: boolean;
  code?: string;
  slug?: string;
  reserved?: boolean;
  hideReservationsFromPreCheck?: boolean;
  image?: { mediaAssetId: string; storageKey: string } | null;
} = {}) {
  const state = {
    packageExists: options.packageExists ?? true,
    isActive: options.isActive ?? false,
    seedManaged: options.seedManaged ?? false,
    code: options.code ?? CODE,
    slug: options.slug ?? SLUG,
    reserved: options.reserved ?? false,
    hideReservationsFromPreCheck: options.hideReservationsFromPreCheck ?? false,
    image: options.image ?? null,
    mediaRelations: options.image ? 1 : 0,
    mediaAssets: options.image ? 1 : 0,
    itinerary: 3,
    content: 4,
    variants: 2,
    rateTiers: 5,
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
          rows: state.packageExists
            ? [{
              id: PACKAGE_ID,
              code: state.code,
              slug: state.slug,
              is_active: state.isActive,
            }]
            : [],
        } as never;
      }

      if (text.includes('FROM package_reservations')) {
        const blocked = !state.hideReservationsFromPreCheck && state.reserved;
        return { rows: blocked ? [{ found: 1 }] : [] } as never;
      }

      if (text.includes('FROM package_media pm')) {
        return {
          rows: state.image
            ? [{ media_asset_id: state.image.mediaAssetId, storage_key: state.image.storageKey }]
            : [],
        } as never;
      }

      if (text.includes('DELETE FROM package_media')) {
        state.mediaRelations = 0;
        return { rows: [] } as never;
      }

      if (text.includes('DELETE FROM media_assets')) {
        // RESTRICT on the relation's side: the asset cannot go while the
        // relation still points at it.
        if (state.mediaRelations > 0) {
          throw foreignKeyViolation('package_media_media_asset_id_fkey');
        }
        state.mediaAssets = 0;
        return { rows: [] } as never;
      }

      if (text.includes('DELETE FROM packages')) {
        // RESTRICT on package_media: the journey cannot go while its image
        // relation stands. `media_assets` never cascades from a package.
        if (state.mediaRelations > 0) {
          throw foreignKeyViolation('package_media_package_id_fkey');
        }
        // What ON DELETE RESTRICT would do, reached through the variant
        // cascade: the constraint named is the reservations one.
        if (state.reserved) {
          throw foreignKeyViolation('package_reservations_variant_package_fkey');
        }

        // What the three CASCADEs would do, and the fourth beneath them.
        state.packageExists = false;
        state.itinerary = 0;
        state.content = 0;
        state.variants = 0;
        state.rateTiers = 0;
        state.packageWrites += 1;
        return { rows: [] } as never;
      }

      if (text.includes('UPDATE packages')) {
        state.packageWrites += 1;
        return { rows: [] } as never;
      }

      return { rows: [] } as never;
    },
    release(discard?: boolean) {
      state.released = true;
      state.discarded = discard === true;
    },
  }) as never);

  return state;
}

type Captured = { status: number | undefined; body: unknown; ended: boolean };

function fakeResponse(): { res: Response; captured: Captured } {
  const captured: Captured = { status: undefined, body: undefined, ended: false };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
    end() {
      captured.ended = true;
      return this;
    },
  } as unknown as Response;

  return { res, captured };
}

const request = (slug: string) => ({ params: { slug } }) as unknown as Request<{ slug: string }>;

async function deletePackage(slug: string): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await deleteAdminPackageHandler(request(slug), res);
  return captured;
}

const errorOf = (captured: Captured) =>
  (captured.body as { error: { code: string; message: string } }).error;

describe('admin package delete: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ name: string; handle: unknown }>;
        };
      }>;
    }).stack.filter((entry) => entry.route?.path === '/:slug')
      .find((entry) => entry.route?.methods.delete === true);

    assert.ok(layer?.route, 'DELETE /:slug should be registered');

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

describe('admin package delete: removing a journey', () => {
  it('removes an inactive, admin-created, unbooked journey', async () => {
    const stored = storedJourney();

    const captured = await deletePackage(SLUG);

    assert.equal(captured.status, 204);
    assert.equal(stored.packageExists, false);
  });

  it('answers 204 with no body at all', async () => {
    storedJourney();

    const captured = await deletePackage(SLUG);

    assert.equal(captured.status, 204);
    assert.equal(captured.body, undefined, 'no journey is returned, because none remains');
    assert.equal(captured.ended, true, 'the response is ended rather than serialised');
  });

  it('lets the itinerary, content, variants and rate tiers cascade away', async () => {
    const stored = storedJourney();

    await deletePackage(SLUG);

    assert.equal(stored.itinerary, 0, 'itinerary sections cascade');
    assert.equal(stored.content, 0, 'content items cascade');
    assert.equal(stored.variants, 0, 'variants cascade');
    assert.equal(stored.rateTiers, 0, 'and rate tiers cascade from the variants');
  });

  it('issues exactly one delete, naming no child table', async () => {
    const stored = storedJourney();

    await deletePackage(SLUG);

    const deletes = stored.calls.filter((call) => /^DELETE FROM/i.test(call.text.trim()));
    assert.equal(deletes.length, 1, 'one statement, and the schema does the rest');
    assert.match(deletes[0]!.text, /DELETE FROM packages WHERE id = \$1/);
    assert.deepEqual(deletes[0]!.values, [PACKAGE_ID]);

    for (const table of ['package_itinerary_sections', 'package_content_items',
      'package_variants', 'package_rate_tiers']) {
      assert.ok(
        !stored.calls.some((call) => new RegExp(`DELETE FROM ${table}`, 'i').test(call.text)),
        `${table} must not be deleted explicitly`,
      );
    }
  });

  it('writes no ownership and no timestamp', async () => {
    const stored = storedJourney({ seedManaged: false });

    await deletePackage(SLUG);

    for (const call of stored.calls) {
      assert.ok(!/UPDATE packages/i.test(call.text), 'the row is going; updating it is pointless');
      assert.ok(!/seed_managed/.test(call.text));
      assert.ok(!/updated_at/.test(call.text));
    }
  });

  it('answers a repeated removal with 404', async () => {
    const stored = storedJourney();

    assert.equal((await deletePackage(SLUG)).status, 204);

    const second = await deletePackage(SLUG);

    assert.equal(second.status, 404, 'the journey is gone; there is no unchanged state');
    assert.equal(errorOf(second).code, 'PACKAGE_NOT_FOUND');
    assert.equal(stored.packageWrites, 1, 'and nothing was deleted twice');
  });
});

describe('admin package delete: eligibility', () => {
  it('refuses a live journey, and deletes nothing', async () => {
    const stored = storedJourney({ isActive: true });

    const captured = await deletePackage(SLUG);

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_MUST_BE_INACTIVE');
    assert.match(errorOf(captured).message, /Deactivate it first/);
    assert.equal(stored.packageExists, true);
    assert.equal(stored.isActive, true, 'and the journey was not deactivated for them');

    // Refused before the identity or the bookings are even considered.
    assert.ok(!stored.calls.some((call) => call.text.includes('FROM package_reservations')));
  });

  it('refuses a reserved brochure code even when the row is admin-managed', async () => {
    // The ownership flag lives on the row, so deleting the row destroys the
    // only record that anyone took ownership — and the seed then recreates
    // the journey from the brochure.
    const stored = storedJourney({ code: brochureCode, slug: SLUG, seedManaged: false });

    const captured = await deletePackage(SLUG);

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_IS_BROCHURE_MANAGED');
    assert.match(errorOf(captured).message, /the catalogue seed would simply recreate it/i);
    assert.match(errorOf(captured).message, /Deactivate it instead/);
    assert.equal(stored.packageExists, true);
  });

  it('refuses a reserved brochure slug even when the row is admin-managed', async () => {
    const stored = storedJourney({ code: CODE, slug: brochureSlug, seedManaged: false });

    const captured = await deletePackage(brochureSlug);

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_IS_BROCHURE_MANAGED');
    assert.equal(stored.packageExists, true);
  });

  it('deletes an admin-created identity whatever the ownership flag says', async () => {
    // Eligibility is about identity, not ownership: a row the seed marked
    // its own but whose code and slug the brochure does not list can never be
    // recreated, so removing it is permanent and allowed.
    for (const seedManaged of [true, false]) {
      const stored = storedJourney({ seedManaged });

      assert.equal((await deletePackage(SLUG)).status, 204, `seedManaged=${seedManaged}`);
      assert.equal(stored.packageExists, false);
    }
  });

  it('never consults the ownership flag at all', async () => {
    const stored = storedJourney({ seedManaged: true });
    await deletePackage(SLUG);

    const lock = stored.calls.find((call) => call.text.includes('FROM packages WHERE slug'))!;
    assert.ok(
      !lock.text.includes('seed_managed'),
      'the locked read does not even select it',
    );
  });
});

describe('admin package delete: reservations', () => {
  it('refuses a booked journey without attempting the delete', async () => {
    const stored = storedJourney({ reserved: true });

    const captured = await deletePackage(SLUG);

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_HAS_RESERVATIONS');
    assert.equal(stored.packageExists, true);
    assert.ok(
      !stored.calls.some((call) => call.text.includes('DELETE FROM packages')),
      'the pre-check answers before the constraint has to',
    );
  });

  it('asks about bookings across every variant, without consulting status', async () => {
    // A cancelled booking is a record of what was sold and holds the row
    // exactly as a confirmed one does, so the query must not filter.
    const stored = storedJourney({ reserved: true });
    await deletePackage(SLUG);

    const check = stored.calls.find((call) => call.text.includes('FROM package_reservations'))!;

    assert.match(check.text, /JOIN package_variants v ON v\.id = r\.variant_id/);
    assert.match(check.text, /WHERE v\.package_id = \$1/);
    assert.match(check.text, /LIMIT 1/);
    assert.ok(!/status/i.test(check.text), 'every status blocks equally');
    assert.deepEqual(check.values, [PACKAGE_ID]);
  });

  it('says nothing that implies cancelling the bookings would help', async () => {
    storedJourney({ reserved: true });

    const message = errorOf(await deletePackage(SLUG)).message;

    assert.match(message, /kept as a record of what was sold/);
    assert.match(message, /stay deactivated instead/);
    for (const forbidden of [/cancel/i, /once the/i, /after the/i, /try again/i]) {
      assert.ok(!forbidden.test(message), `${forbidden} would promise a door that does not exist`);
    }
  });

  it('falls back to the constraint when a booking slips past the pre-check', async () => {
    const stored = storedJourney({ reserved: true, hideReservationsFromPreCheck: true });

    const captured = await deletePackage(SLUG);

    assert.equal(captured.status, 409);
    assert.equal(errorOf(captured).code, 'PACKAGE_HAS_RESERVATIONS');
    assert.equal(stored.packageExists, true, 'the rollback left the journey intact');
  });

  it('does not mistake an unrelated foreign key violation for a booking', async () => {
    __setClientFactoryForTests(async () => ({
      async query(text: string) {
        if (text.startsWith('BEGIN') || text.startsWith('ROLLBACK')) return { rows: [] } as never;
        if (text.includes('FROM packages WHERE slug')) {
          return {
            rows: [{ id: PACKAGE_ID, code: CODE, slug: SLUG, is_active: false }],
          } as never;
        }
        if (text.includes('FROM package_reservations')) return { rows: [] } as never;
        if (text.includes('DELETE FROM packages')) {
          // Some other reference entirely. Reporting this as "it has
          // bookings" would be a guess dressed as an answer.
          throw foreignKeyViolation('some_other_table_package_id_fkey');
        }
        return { rows: [] } as never;
      },
      release() {},
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      deleteAdminPackageHandler(request(SLUG), res),
      /violates foreign key constraint/,
      'it stays a server error',
    );
  });
});

describe('admin package delete: address', () => {
  it('refuses a malformed slug before opening a transaction', async () => {
    const stored = storedJourney();

    const captured = await deletePackage('Not A Slug');

    assert.equal(captured.status, 400);
    assert.equal(errorOf(captured).code, 'INVALID_PACKAGE_SLUG');
    assert.equal(stored.calls.length, 0);
  });

  it('answers a journey nothing matches with 404', async () => {
    const stored = storedJourney({ packageExists: false });

    const captured = await deletePackage(SLUG);

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
    assert.equal(stored.packageWrites, 0);
  });
});

describe('admin package delete: transaction and locking', () => {
  it('locks the package as its first statement, and takes no other lock', async () => {
    const stored = storedJourney();
    await deletePackage(SLUG);

    const lock = stored.calls[1]!;
    assert.match(lock.text, /FROM packages WHERE slug = \$1 FOR UPDATE/);
    assert.deepEqual(lock.values, [SLUG]);

    const locks = stored.calls.filter((call) => /FOR UPDATE|FOR SHARE/.test(call.text));
    assert.equal(locks.length, 1, 'no child row is locked; they go by cascade');
  });

  it('runs the whole removal in one transaction', async () => {
    const stored = storedJourney();
    await deletePackage(SLUG);

    const shape = stored.calls.map((call) => {
      if (call.text.startsWith('BEGIN')) return 'BEGIN';
      if (call.text.startsWith('COMMIT')) return 'COMMIT';
      if (call.text.includes('FROM packages WHERE slug')) return 'LOCK-PACKAGE';
      if (call.text.includes('FROM package_reservations')) return 'BOOKED?';
      if (call.text.includes('FROM package_media pm')) return 'IMAGE?';
      if (call.text.includes('DELETE FROM packages')) return 'DELETE';
      return 'OTHER';
    });

    assert.deepEqual(shape, ['BEGIN', 'LOCK-PACKAGE', 'BOOKED?', 'IMAGE?', 'DELETE', 'COMMIT']);
    assert.equal(stored.released, true);
    assert.equal(stored.discarded, false);
  });

  it('ends every refusal by rolling back, holding the lock until it does', async () => {
    for (const options of [
      { isActive: true },
      { code: brochureCode },
      { reserved: true },
    ]) {
      const stored = storedJourney(options);
      await deletePackage(SLUG);

      const closes = stored.calls.filter(
        (call) => call.text.startsWith('COMMIT') || call.text.startsWith('ROLLBACK'),
      );

      assert.equal(closes.length, 1, `${JSON.stringify(options)}: the transaction ends once`);
      assert.ok(closes[0]!.text.startsWith('ROLLBACK'));
      assert.equal(
        stored.calls[stored.calls.length - 1],
        closes[0],
        'and it ends last, so the lock covered every statement',
      );
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
          return {
            rows: [{ id: PACKAGE_ID, code: CODE, slug: SLUG, is_active: false }],
          } as never;
        }
        if (text.includes('FROM package_reservations')) return { rows: [] } as never;
        return { rows: [] } as never;
      },
      release(discard?: boolean) {
        discarded = discard;
      },
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(deleteAdminPackageHandler(request(SLUG), res), /commit failed/);

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
        if (text.includes('DELETE FROM packages')) throw new Error('deadlock detected');
        if (text.includes('FROM packages WHERE slug')) {
          return {
            rows: [{ id: PACKAGE_ID, code: CODE, slug: SLUG, is_active: false }],
          } as never;
        }
        if (text.includes('FROM package_reservations')) return { rows: [] } as never;
        return { rows: [] } as never;
      },
      release() {
        released = true;
      },
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(deleteAdminPackageHandler(request(SLUG), res), /deadlock detected/);

    assert.ok(calls.includes('ROLLBACK'), 'the transaction is rolled back');
    assert.ok(!calls.includes('COMMIT'));
    assert.equal(released, true);
  });
});

// ---------------------------------------------------------------------------
// The journey's one image
// ---------------------------------------------------------------------------
//
// `package_media.package_id` is ON DELETE RESTRICT, so unlike the four
// cascading child tables the relation has to be named. The fake above models
// that RESTRICT in both directions, so a test that forgot either delete would
// fail with the foreign-key violation PostgreSQL would really raise rather
// than pass quietly.
//
// The other half is the seam between two systems that do not commit together.
// The object lives in R2; the rows live in PostgreSQL. The rule the whole
// feature is built on is that the database is the truth and storage follows,
// so every test here is ultimately about one question: was `deleteObject`
// called, and was it called only after a commit that answered?

const IMAGE = { mediaAssetId: '900', storageKey: 'media/11111111-2222-4333-8444-555555555555.webp' };

/** A `MediaStorage` that records, and can be told to fail. */
function recordingStorage(options: { failDelete?: boolean } = {}) {
  const deleted: string[] = [];

  const storage = {
    async putObject() {
      throw new Error('deleting a journey must never write an object');
    },
    async deleteObject(key: string) {
      deleted.push(key);
      if (options.failDelete) {
        throw new Error('R2 unavailable');
      }
    },
  };

  let resolutions = 0;

  return {
    deleted,
    get resolutions() {
      return resolutions;
    },
    provider: (() => {
      resolutions += 1;
      return storage;
    }) as never,
  };
}

/** The handler with storage injected, which is how the router builds it. */
async function deleteWithStorage(slug: string, provider: never): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await createDeleteAdminPackageHandler(provider)(request(slug), res);
  return captured;
}

describe('admin package delete: the journey image', () => {
  it('touches no media table and never resolves storage when there is no image', async () => {
    const stored = storedJourney();
    const storage = recordingStorage();

    const captured = await deleteWithStorage(SLUG, storage.provider);

    assert.equal(captured.status, 204);
    assert.deepEqual(storage.deleted, [], 'nothing to remove, so nothing is asked of R2');
    assert.ok(
      !stored.calls.some((call) => /DELETE FROM (package_media|media_assets)/.test(call.text)),
      'no media row is deleted for a journey that had no image',
    );
    // The provider is never even called, which is what lets a deployment with
    // no R2 configuration at all keep deleting journeys.
    assert.equal(storage.resolutions, 0);
  });

  it('removes the relation, then the asset, then the journey', async () => {
    const stored = storedJourney({ image: IMAGE });

    await deleteWithStorage(SLUG, recordingStorage().provider);

    const deletes = stored.calls
      .filter((call) => /^\s*DELETE FROM/i.test(call.text))
      .map((call) => call.text.trim().split(/\s+/).slice(0, 3).join(' '));

    assert.deepEqual(
      deletes,
      ['DELETE FROM package_media', 'DELETE FROM media_assets', 'DELETE FROM packages'],
      'the relation first, then what it pointed at, then the journey',
    );

    assert.equal(stored.mediaRelations, 0);
    assert.equal(stored.mediaAssets, 0);
    assert.equal(stored.packageExists, false);
  });

  it('names the asset by the id read under the lock, and the journey by its own', async () => {
    const stored = storedJourney({ image: IMAGE });

    await deleteWithStorage(SLUG, recordingStorage().provider);

    const lookup = stored.calls.find((call) => call.text.includes('FROM package_media pm'))!;
    assert.deepEqual(lookup.values, [PACKAGE_ID]);
    assert.match(lookup.text, /JOIN media_assets ma ON ma\.id = pm\.media_asset_id/);

    const relation = stored.calls.find((call) => call.text.includes('DELETE FROM package_media'))!;
    assert.deepEqual(relation.values, [PACKAGE_ID]);

    const asset = stored.calls.find((call) => call.text.includes('DELETE FROM media_assets'))!;
    assert.deepEqual(asset.values, [IMAGE.mediaAssetId]);
  });

  it('removes the object only after COMMIT, and with the captured key', async () => {
    const stored = storedJourney({ image: IMAGE });
    const storage = recordingStorage();
    let deletedBeforeCommit: boolean | null = null;

    // Sampled at the moment COMMIT is issued. If storage had already been
    // asked, this would be true and the whole ordering rule would be broken.
    const recorded = stored.calls;
    const push = recorded.push.bind(recorded);
    recorded.push = ((call: Recorded) => {
      if (call.text.startsWith('COMMIT') && deletedBeforeCommit === null) {
        deletedBeforeCommit = storage.deleted.length > 0;
      }
      return push(call);
    }) as typeof recorded.push;

    const captured = await deleteWithStorage(SLUG, storage.provider);

    assert.equal(captured.status, 204);
    assert.equal(deletedBeforeCommit, false, 'storage is untouched while the transaction is open');
    assert.deepEqual(storage.deleted, [IMAGE.storageKey], 'exactly the key the row carried');
  });

  it('still reports the deletion when the object cannot be removed', async () => {
    const stored = storedJourney({ image: IMAGE });
    const storage = recordingStorage({ failDelete: true });

    const captured = await deleteWithStorage(SLUG, storage.provider);

    // An orphaned object is the acceptable side of this seam. The journey
    // really is gone, and saying otherwise would be false.
    assert.equal(captured.status, 204);
    assert.equal(captured.ended, true);
    assert.equal(stored.packageExists, false, 'the database stays deleted');
    assert.equal(stored.mediaRelations, 0);
    assert.equal(stored.mediaAssets, 0);
    assert.equal(storage.deleted.length, 1, 'exactly one attempt, never retried');
  });

  it('still reports the deletion when object storage is not configured at all', async () => {
    const stored = storedJourney({ image: IMAGE });
    // What the lazy R2 provider does on a deployment with no R2 variables:
    // it throws MediaConfigurationError before any client exists.
    const unconfigured = (() => {
      throw new Error('R2_BUCKET must be set');
    }) as never;

    const captured = await deleteWithStorage(SLUG, unconfigured);

    assert.equal(captured.status, 204, 'a delivery misconfiguration is not a failed deletion');
    assert.equal(stored.packageExists, false);
  });

  it('makes no storage call when a statement fails before COMMIT', async () => {
    const storage = recordingStorage();
    const calls: string[] = [];

    __setClientFactoryForTests(async () => ({
      async query(text: string) {
        calls.push(text.trim().split(/\s/)[0]!);
        if (text.includes('DELETE FROM packages')) throw new Error('deadlock detected');
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: PACKAGE_ID, code: CODE, slug: SLUG, is_active: false }] } as never;
        }
        if (text.includes('FROM package_media pm')) {
          return {
            rows: [{ media_asset_id: IMAGE.mediaAssetId, storage_key: IMAGE.storageKey }],
          } as never;
        }
        return { rows: [] } as never;
      },
      release() {},
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      createDeleteAdminPackageHandler(storage.provider)(request(SLUG), res),
      /deadlock detected/,
    );

    // The rows are still there, so the object they point at must be too.
    assert.ok(calls.includes('ROLLBACK'));
    assert.deepEqual(storage.deleted, [], 'nothing committed, so nothing is removed');
    assert.equal(storage.resolutions, 0);
  });

  it('makes no storage call when COMMIT itself does not answer', async () => {
    const storage = recordingStorage();
    let discarded: boolean | undefined;

    __setClientFactoryForTests(async () => ({
      async query(text: string) {
        if (text.startsWith('COMMIT')) throw new Error('commit failed');
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: PACKAGE_ID, code: CODE, slug: SLUG, is_active: false }] } as never;
        }
        if (text.includes('FROM package_media pm')) {
          return {
            rows: [{ media_asset_id: IMAGE.mediaAssetId, storage_key: IMAGE.storageKey }],
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
      createDeleteAdminPackageHandler(storage.provider)(request(SLUG), res),
      /commit failed/,
    );

    // Nobody knows whether the transaction applied. If it did, the object is
    // an orphan, which is survivable; if it did not, the journey still points
    // at the object, and removing it would be the one failure this
    // architecture refuses. So it stays, and nothing is retried.
    assert.deepEqual(storage.deleted, [], 'an unanswered COMMIT removes nothing');
    assert.equal(storage.resolutions, 0);
    assert.equal(discarded, true, 'and the existing poisoned-connection behaviour is kept');
  });

  it('removes nothing at all when the journey is refused', async () => {
    const cases = [
      { label: 'live journey', options: { isActive: true, image: IMAGE }, slug: SLUG },
      { label: 'brochure code', options: { code: brochureCode, image: IMAGE }, slug: SLUG },
      { label: 'brochure slug', options: { slug: brochureSlug, image: IMAGE }, slug: brochureSlug },
      { label: 'ever booked', options: { reserved: true, image: IMAGE }, slug: SLUG },
    ];

    for (const { label, options, slug } of cases) {
      const stored = storedJourney(options);
      const storage = recordingStorage();

      const captured = await deleteWithStorage(slug, storage.provider);

      assert.equal(captured.status, 409, `${label}: refused`);
      assert.deepEqual(storage.deleted, [], `${label}: no object is removed`);
      assert.equal(storage.resolutions, 0, `${label}: storage is never even resolved`);
      assert.equal(stored.mediaRelations, 1, `${label}: the relation survives`);
      assert.equal(stored.mediaAssets, 1, `${label}: the asset survives`);
      assert.equal(stored.packageExists, true, `${label}: the journey survives`);
      assert.ok(
        !stored.calls.some((call) => /DELETE FROM/i.test(call.text)),
        `${label}: nothing is deleted at all`,
      );
    }
  });

  it('reads the image only after the package row is locked', async () => {
    const stored = storedJourney({ image: IMAGE });

    await deleteWithStorage(SLUG, recordingStorage().provider);

    const lock = stored.calls.findIndex((call) => call.text.includes('FROM packages WHERE slug'));
    const image = stored.calls.findIndex((call) => call.text.includes('FROM package_media pm'));

    assert.ok(lock >= 0 && image > lock, 'the package row is locked first, always');
    assert.match(stored.calls[lock]!.text, /FOR UPDATE/);
    // And it is the only lock: the media rows are reached through a package
    // row no concurrent writer can move, so they need none of their own.
    assert.equal(stored.calls.filter((call) => /FOR UPDATE|FOR SHARE/.test(call.text)).length, 1);
  });

  it('puts no storage key, asset id or media field in the response', async () => {
    const stored = storedJourney({ image: IMAGE });
    const captured = await deleteWithStorage(SLUG, recordingStorage().provider);

    assert.equal(captured.status, 204);
    assert.equal(captured.body, undefined, '204 carries no body at all');
    assert.equal(stored.mediaAssets, 0);

    const serialised = JSON.stringify(captured);
    for (const internal of [IMAGE.storageKey, IMAGE.mediaAssetId, 'storage_key', 'mediaStorageKey']) {
      assert.ok(!serialised.includes(internal), `${internal} must not reach the caller`);
    }
  });
});
