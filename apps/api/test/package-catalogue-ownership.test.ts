import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { describe, it } from 'node:test';
import {
  seedBrochurePackageCatalogue,
  type BrochurePackageSeed,
} from '../src/db/seeds/packageCatalogueSeed';

// Who owns a package row.
//
// `packages.seed_managed` is the boundary between an offering the brochure
// still authors and one an administrator has taken over. These prove the seed
// reconciles the first exactly as before and does not write a single statement
// against the second — the property the whole ownership model rests on.
//
// No database: the client is a double that records every statement, so a test
// can assert not only what the seed produced but that it produced nothing.

function fixture(): BrochurePackageSeed {
  return {
    code: 'TEST-EXCURSION', slug: 'test-excursion', title: 'Synthetic excursion',
    summary: null, description: null, durationLabel: null, scheduleLabel: null,
    operatingDays: null, requiresPriceConfirmation: false,
    itinerary: [{ dayNumber: null, heading: null, body: 'Synthetic itinerary.' }],
    content: [{ kind: 'note', text: 'Test data only.' }],
    variants: [{
      key: 'standard', label: 'Standard', isDefault: true,
      childMinAge: null, childMaxAge: null, childDiscountPercent: null,
      rates: [
        { minPartySize: 1, maxPartySize: 1, adultUnitRate: '100.00' },
        { minPartySize: 2, maxPartySize: 2, adultUnitRate: '90.00' },
        { minPartySize: 3, maxPartySize: null, adultUnitRate: '80.00' },
      ],
    }],
  };
}

type Recorded = { text: string; values: unknown[] };

/** Every write the seed could make against a package, named individually. */
const EVERY_WRITE = [
  'UPDATE packages',
  'INSERT INTO packages',
  'SET sort_order',
  'DELETE FROM package_itinerary_sections',
  'INSERT INTO package_itinerary_sections',
  'DELETE FROM package_content_items',
  'INSERT INTO package_content_items',
  'SELECT key, sort_order FROM package_variants',
  'UPDATE package_variants',
  'INSERT INTO package_variants',
  'DELETE FROM package_rate_tiers',
  'INSERT INTO package_rate_tiers',
  'WITH parked',
] as const;

/** A database holding one row for the fixture's code, owned as stated. */
function ownershipClient(row: Record<string, unknown> | null) {
  const statements: Recorded[] = [];

  const client = {
    async query(text: string, values: unknown[] = []): Promise<unknown> {
      statements.push({ text, values });

      if (text.includes('FROM packages')) {
        return { rows: row ? [row] : [] };
      }
      if (text.includes('SELECT key, sort_order FROM package_variants')) {
        return { rows: [] };
      }
      if (text.includes('INSERT INTO packages')) {
        return { rows: [{ id: '5' }] };
      }
      if (text.includes('INSERT INTO package_variants')) {
        return { rows: [{ id: '10' }] };
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;

  return { client, statements };
}

const wrote = (statements: Recorded[], needle: string) =>
  statements.some((statement) => statement.text.includes(needle));

describe('package catalogue ownership', () => {
  it('reconciles a seed-managed package exactly as before', async () => {
    const { client, statements } = ownershipClient({
      id: '1', code: 'TEST-EXCURSION', slug: 'test-excursion', seed_managed: true,
    });

    await seedBrochurePackageCatalogue(client, [fixture()]);

    assert.ok(wrote(statements, 'UPDATE packages'), 'its fields are rewritten');
    assert.ok(wrote(statements, 'DELETE FROM package_itinerary_sections'), 'itinerary is replaced');
    assert.ok(wrote(statements, 'DELETE FROM package_content_items'), 'content is replaced');
    assert.ok(wrote(statements, 'INSERT INTO package_variants'), 'variants are upserted');
    assert.ok(wrote(statements, 'DELETE FROM package_rate_tiers'), 'rate tiers are replaced');
  });

  it('writes nothing at all for an admin-managed package', async () => {
    const { client, statements } = ownershipClient({
      id: '1', code: 'TEST-EXCURSION', slug: 'test-excursion', seed_managed: false,
    });

    await seedBrochurePackageCatalogue(client, [fixture()]);

    // Exactly one statement: the lookup that discovered who owns the row.
    assert.equal(statements.length, 1, 'the seed should stop at the ownership lookup');
    assert.match(statements[0]!.text, /FROM packages/);
    assert.match(statements[0]!.text, /seed_managed/, 'ownership is read in that same lookup');

    for (const write of EVERY_WRITE) {
      assert.ok(!wrote(statements, write), `${write} must not run for an admin-managed package`);
    }
  });

  it('does not judge an admin-managed package against the brochure identity', async () => {
    // The row matched on code but carries a different slug — an ordinary
    // rename once an administrator owns it, and never a seed conflict.
    const { client, statements } = ownershipClient({
      id: '1', code: 'TEST-EXCURSION', slug: 'renamed-by-admin', seed_managed: false,
    });

    await assert.doesNotReject(seedBrochurePackageCatalogue(client, [fixture()]));
    assert.equal(statements.length, 1);
  });

  it('still refuses an identity mismatch on a seed-managed package', async () => {
    const { client } = ownershipClient({
      id: '1', code: 'TEST-EXCURSION', slug: 'something-else', seed_managed: true,
    });

    await assert.rejects(
      seedBrochurePackageCatalogue(client, [fixture()]),
      /immutable package identity mismatch/,
    );
  });

  it('creates a missing package as seed-owned', async () => {
    const { client, statements } = ownershipClient(null);

    await seedBrochurePackageCatalogue(client, [fixture()]);

    const insert = statements.find((statement) => statement.text.includes('INSERT INTO packages'));
    assert.ok(insert, 'a missing package is inserted');
    assert.match(insert.text, /seed_managed/, 'ownership is stated, not left to the column default');
  });

  it('reconciles a row read without the column, rather than skipping it', async () => {
    // The column is NOT NULL, so this cannot happen against the real schema.
    // The check is `=== false` precisely so that anything else still
    // reconciles: silently skipping a brochure package would be the worse
    // failure of the two.
    const { client, statements } = ownershipClient({
      id: '1', code: 'TEST-EXCURSION', slug: 'test-excursion',
    });

    await seedBrochurePackageCatalogue(client, [fixture()]);

    assert.ok(wrote(statements, 'UPDATE packages'));
  });

  it('skips only the admin-managed entry in a mixed catalogue', async () => {
    const second = fixture();
    second.code = 'TEST-SECOND';
    second.slug = 'test-second';

    const statements: Recorded[] = [];
    const client = {
      async query(text: string, values: unknown[] = []): Promise<unknown> {
        statements.push({ text, values });

        if (text.includes('FROM packages')) {
          const code = values[0];
          const admin = code === 'TEST-SECOND';
          return {
            rows: [{
              id: admin ? '2' : '1',
              code,
              slug: admin ? 'test-second' : 'test-excursion',
              seed_managed: !admin,
            }],
          };
        }
        if (text.includes('SELECT key, sort_order FROM package_variants')) return { rows: [] };
        if (text.includes('INSERT INTO package_variants')) return { rows: [{ id: '10' }] };
        return { rows: [] };
      },
    } as unknown as PoolClient;

    await seedBrochurePackageCatalogue(client, [fixture(), second]);

    const writes = statements.filter((statement) => !statement.text.includes('FROM packages'));
    assert.ok(writes.length > 0, 'the seed-managed entry is still reconciled');
    for (const write of writes) {
      assert.ok(
        !write.values.includes('2'),
        'no statement may reference the admin-managed package',
      );
    }
  });
});
