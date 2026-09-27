import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

// One invariant, asserted across every admin write that touches a package and
// its variants: the PARENT IS LOCKED FIRST.
//
// This is not a style rule. Each of these transactions ends by writing to the
// package row — the `seed_managed` flip — so a path that locks a variant
// first and the package afterwards sits in a deadlock cycle with every path
// that takes them the other way round: one holds the package and waits for
// the variant, the other holds the variant and waits for the package.
// PostgreSQL resolves that by aborting one side with 40P01, which nothing in
// this codebase handles, so it surfaces as a 500 on an operation that was
// perfectly valid.
//
// The catalogue seed and the public reservation path both take package then
// variants. These four must agree, and this file is the one place that fails
// if any of them stops agreeing.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');

let repository: RepositoryModule;

const SLUG = 'nile-dinner-cruise';
const KEY = 'standard-service';
const PACKAGE_ID = '42';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  repository = await import('../src/modules/admin-packages/admin-packages.repository.js');
});

afterEach(() => {
  repository.__setClientFactoryForTests(null);
});

/** A detail row complete enough for the projection's mapper. */
function detailRow() {
  return {
    code: 'T016',
    slug: SLUG,
    title: 'Nile Dinner Cruise',
    summary: null,
    duration_label: null,
    schedule_label: null,
    requires_price_confirmation: false,
    is_active: false,
    sort_order: 16,
    seed_managed: false,
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
      rates: [],
    }],
  };
}

/**
 * A client that answers every statement these four paths issue, and records
 * the order it was asked.
 *
 * Deliberately permissive: this file is not testing what any path decides,
 * only the sequence in which it takes its locks, so every read is answered
 * with something that keeps the happy path moving.
 */
function recordingClient(): { statements: string[] } {
  const statements: string[] = [];

  repository.__setClientFactoryForTests(async () => ({
    async query(text: string) {
      statements.push(text);

      if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
        return { rows: [] } as never;
      }

      if (text.includes('FROM packages WHERE slug')) {
        return {
          rows: [{ id: PACKAGE_ID, is_active: false, requires_price_confirmation: false }],
        } as never;
      }

      // The variant-create aggregate, which takes no row lock of its own: it
      // is covered by the parent lock, and a state that lets the insert run.
      if (text.includes('default_count')) {
        return {
          rows: [{ variant_count: 1, default_count: 1, max_sort_order: 1 }],
        } as never;
      }

      if (text.includes('FROM package_variants') && text.includes('FOR UPDATE')) {
        // `is_default: false` so the default switch takes its writing path
        // rather than answering `unchanged`.
        return { rows: [{ id: '7', key: KEY, is_default: false }] } as never;
      }

      if (text.includes('FROM packages p')) {
        return { rows: [detailRow()] } as never;
      }

      return { rows: [] } as never;
    },
    release() {},
  }) as never);

  return { statements };
}

/** Where each lock sits in the recorded sequence, or -1. */
function lockPositions(statements: string[]): {
  begin: number;
  packageLock: number;
  variantLock: number;
  firstWrite: number;
} {
  const isPackageLock = (text: string) =>
    text.includes('FROM packages WHERE slug') && text.includes('FOR UPDATE');
  const isVariantLock = (text: string) =>
    text.includes('FROM package_variants') && text.includes('FOR UPDATE');
  const isWrite = (text: string) =>
    /^(UPDATE |INSERT INTO|DELETE FROM)/.test(text.trim());

  return {
    begin: statements.findIndex((text) => text.startsWith('BEGIN')),
    packageLock: statements.findIndex(isPackageLock),
    variantLock: statements.findIndex(isVariantLock),
    firstWrite: statements.findIndex(isWrite),
  };
}

const RATES = [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '100.00' }];

const VARIANT_EDIT = {
  label: 'Premium service',
  childMinAge: null,
  childMaxAge: null,
  childDiscountPercent: null,
};

const VARIANT_CREATE = {
  key: 'premium-service',
  label: 'Premium service',
  childMinAge: null,
  childMaxAge: null,
  childDiscountPercent: null,
};

/** Every admin write that touches a package and its variants together. */
const paths: Array<{ name: string; run: () => Promise<unknown>; locksVariantRows: boolean }> = [
  {
    name: 'updateAdminPackageVariant',
    run: () => repository.updateAdminPackageVariant(SLUG, KEY, VARIANT_EDIT),
    locksVariantRows: true,
  },
  {
    name: 'replaceAdminPackageVariantRates',
    run: () => repository.replaceAdminPackageVariantRates(SLUG, KEY, RATES),
    locksVariantRows: true,
  },
  {
    name: 'insertAdminPackageVariant',
    run: () => repository.insertAdminPackageVariant(SLUG, VARIANT_CREATE),
    // Covered by the parent lock alone: there is no variant row to lock yet.
    locksVariantRows: false,
  },
  {
    name: 'setAdminPackageDefaultVariant',
    run: () => repository.setAdminPackageDefaultVariant(SLUG, KEY),
    locksVariantRows: true,
  },
];

describe('admin package writes: canonical lock order', () => {
  for (const path of paths) {
    it(`${path.name} locks the package as its first statement`, async () => {
      const recorded = recordingClient();
      await path.run();

      const { begin, packageLock } = lockPositions(recorded.statements);

      assert.equal(begin, 0, 'the transaction opens first');
      assert.ok(packageLock >= 0, 'the package row is locked');
      assert.equal(
        packageLock,
        1,
        `${path.name} should lock the package immediately after BEGIN`,
      );
    });

    it(`${path.name} never locks a variant before the package`, async () => {
      const recorded = recordingClient();
      await path.run();

      const { packageLock, variantLock } = lockPositions(recorded.statements);

      if (variantLock === -1) {
        assert.equal(
          path.locksVariantRows,
          false,
          `${path.name} was expected to lock variant rows`,
        );
        return;
      }

      assert.ok(
        packageLock < variantLock,
        `${path.name} must take the package before the variant, never the reverse`,
      );
    });

    it(`${path.name} holds both locks before it writes anything`, async () => {
      const recorded = recordingClient();
      await path.run();

      const { packageLock, variantLock, firstWrite } = lockPositions(recorded.statements);

      assert.ok(firstWrite > packageLock, 'nothing is written before the package is locked');

      if (variantLock !== -1) {
        assert.ok(firstWrite > variantLock, 'nothing is written before the variant is locked');
      }
    });

    it(`${path.name} keeps the package lock to the end of the transaction`, async () => {
      // A row lock is held until the transaction ends, so what this asserts
      // is that the transaction is not closed early and reopened: the
      // ownership flip and the read-back both sit inside the same one.
      const recorded = recordingClient();
      await path.run();

      const closes = recorded.statements.filter(
        (text) => text.startsWith('COMMIT') || text.startsWith('ROLLBACK'),
      );

      assert.equal(closes.length, 1, 'the transaction ends exactly once');
      assert.equal(
        recorded.statements[recorded.statements.length - 1],
        closes[0],
        'and it ends last, so the lock covered every statement',
      );
    });
  }

  it('gives all four paths the identical opening sequence', async () => {
    const openings: Record<string, string> = {};

    for (const path of paths) {
      const recorded = recordingClient();
      await path.run();

      openings[path.name] = recorded.statements
        .slice(0, 2)
        .map((text) => (text.startsWith('BEGIN') ? 'BEGIN' : 'LOCK-PACKAGE'))
        .join(' -> ');
    }

    assert.deepEqual(openings, {
      updateAdminPackageVariant: 'BEGIN -> LOCK-PACKAGE',
      replaceAdminPackageVariantRates: 'BEGIN -> LOCK-PACKAGE',
      insertAdminPackageVariant: 'BEGIN -> LOCK-PACKAGE',
      setAdminPackageDefaultVariant: 'BEGIN -> LOCK-PACKAGE',
    });
  });

  it('locks the package by slug and the variants by the id it returned', async () => {
    // The variant lock keys off the locked parent's id rather than the slug,
    // so it cannot reach a row belonging to a package this transaction does
    // not hold.
    for (const path of paths) {
      const statements: Array<{ text: string; values: unknown[] | undefined }> = [];

      repository.__setClientFactoryForTests(async () => ({
        async query(text: string, values?: unknown[]) {
          statements.push({ text, values });

          if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
            return { rows: [] } as never;
          }
          if (text.includes('FROM packages WHERE slug')) {
            return {
              rows: [{ id: PACKAGE_ID, is_active: false, requires_price_confirmation: false }],
            } as never;
          }
          if (text.includes('default_count')) {
            return { rows: [{ variant_count: 1, default_count: 1, max_sort_order: 1 }] } as never;
          }
          if (text.includes('FROM package_variants') && text.includes('FOR UPDATE')) {
            return { rows: [{ id: '7', key: KEY, is_default: false }] } as never;
          }
          if (text.includes('FROM packages p')) {
            return { rows: [detailRow()] } as never;
          }
          return { rows: [] } as never;
        },
        release() {},
      }) as never);

      await path.run();

      const packageLock = statements.find(
        (call) => call.text.includes('FROM packages WHERE slug') && call.text.includes('FOR UPDATE'),
      )!;
      assert.deepEqual(packageLock.values, [SLUG], `${path.name} locks by slug`);

      const variantLock = statements.find(
        (call) => call.text.includes('FROM package_variants') && call.text.includes('FOR UPDATE'),
      );

      if (variantLock) {
        assert.equal(
          variantLock.values?.[0],
          PACKAGE_ID,
          `${path.name} locks variants by the locked package's id`,
        );
      }
    }
  });
});
