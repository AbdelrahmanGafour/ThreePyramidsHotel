import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from '../src/db/pool';
import {
  assertBrochureCatalogue,
  seedBrochurePackageCatalogue,
  type BrochurePackageSeed,
} from '../src/db/seeds/packageCatalogueSeed';

// Synthetic schema fixtures only, not brochure products. No pool or database import.
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

describe('generic package catalogue validation', () => {
  it('accepts empty and single-product catalogues without a fixed code set', () => {
    assert.doesNotThrow(() => assertBrochureCatalogue([]));
    assert.doesNotThrow(() => assertBrochureCatalogue([fixture()]));
  });

  it('accepts unsorted nonoverlapping 1/2/3+ tiers without mutating input', () => {
    const item = fixture();
    item.variants[0].rates.reverse();
    const before = structuredClone(item);
    assertBrochureCatalogue([item]);
    assert.deepEqual(item, before);
  });

  it('accepts a constant per-person rate and confirmation-required product', () => {
    const item = fixture();
    item.requiresPriceConfirmation = true;
    item.variants[0].rates = [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '25.00' }];
    assert.doesNotThrow(() => assertBrochureCatalogue([item]));
  });

  it('accepts multiple options without inventing a default', () => {
    const item = fixture();
    item.variants[0].isDefault = false;
    item.variants.push({ ...structuredClone(item.variants[0]), key: 'second', label: 'Second' });
    assert.doesNotThrow(() => assertBrochureCatalogue([item]));
  });

  for (const discount of ['0.00', '12.34', '100.00']) {
    it(`accepts an explicit child age band with ${discount} percent discount`, () => {
      const item = fixture();
      Object.assign(item.variants[0], { childMinAge: 6, childMaxAge: 12, childDiscountPercent: discount });
      assert.doesNotThrow(() => assertBrochureCatalogue([item]));
    });
  }

  it('accepts a variant with no known rate instead of inventing a price', () => {
    const item = fixture();
    item.requiresPriceConfirmation = true;
    item.variants[0].rates = [];
    assert.doesNotThrow(() => assertBrochureCatalogue([item]));
  });

  for (const amount of ['0.00', '0.01', '9999999999.99']) {
    it(`accepts exact USD amount ${amount}`, () => {
      const item = fixture();
      item.variants[0].rates[0].adultUnitRate = amount;
      assert.doesNotThrow(() => assertBrochureCatalogue([item]));
    });
  }

  for (const amount of ['-0.01', '1.001', '1', '01.00', '1e2', 'NaN', 'Infinity',
    '10000000000.00', '1.00\n', ' 1.00', 1]) {
    it(`rejects invalid USD amount ${JSON.stringify(amount)}`, () => {
      const item = fixture();
      item.variants[0].rates[0].adultUnitRate = amount as string;
      assert.throws(() => assertBrochureCatalogue([item]), /invalid USD rate/);
    });
  }

  const invalid: [string, (item: BrochurePackageSeed) => void, RegExp][] = [
    ['blank code', p => { p.code = '\t'; }, /must not be blank/],
    ['padded code', p => { p.code = ' TEST'; }, /must be trimmed/],
    ['padded title', p => { p.title += ' '; }, /must be trimmed/],
    ['blank title', p => { p.title = ''; }, /must not be blank/],
    ['invalid slug', p => { p.slug = 'Test'; }, /invalid slug/],
    ['newline slug', p => { p.slug += '\n'; }, /invalid slug/],
    ['empty weekdays', p => { p.operatingDays = []; }, /operating days/],
    ['duplicate weekdays', p => { p.operatingDays = ['monday', 'monday']; }, /operating days/],
    ['unknown weekday', p => { p.operatingDays = ['Funday'] as never; }, /operating days/],
    ['null weekday', p => { p.operatingDays = [null] as never; }, /operating days/],
    ['nested weekdays', p => { p.operatingDays = [['monday']] as never; }, /operating days/],
    ['sparse weekdays', p => { p.operatingDays = new Array(1); }, /operating days/],
    ['zero itinerary day', p => { p.itinerary[0].dayNumber = 0; }, /day number/],
    ['invalid content kind', p => { p.content[0].kind = 'other' as never; }, /content kind/],
    ['missing variants', p => { p.variants = []; }, /no sellable variants/],
    ['duplicate variants', p => { p.variants.push(structuredClone(p.variants[0])); }, /invalid variant/],
    ['multiple defaults', p => { p.variants.push({ ...structuredClone(p.variants[0]), key: 'other' }); }, /default variant/],
    ['missing single default', p => { p.variants[0].isDefault = false; }, /default variant/],
    ['invalid boolean', p => { p.requiresPriceConfirmation = 'false' as never; }, /confirmation flag/],
    ['zero party size', p => { p.variants[0].rates[0].minPartySize = 0; }, /min party size/],
    ['fractional party size', p => { p.variants[0].rates[0].minPartySize = 1.5; }, /min party size/],
    ['integer overflow', p => { p.variants[0].rates[0].maxPartySize = 2147483648; }, /max party size/],
    ['inverted tier', p => { p.variants[0].rates[1].maxPartySize = 1; }, /max party size/],
    ['touching inclusive tiers', p => { p.variants[0].rates[0].maxPartySize = 2; }, /overlapping/],
    ['unbounded tier overlap', p => { p.variants[0].rates[0].maxPartySize = null; }, /overlapping/],
    ['partial child rule', p => { p.variants[0].childMinAge = 6; }, /incomplete child pricing/],
    ['inverted child ages', p => { Object.assign(p.variants[0], { childMinAge: 12, childMaxAge: 6, childDiscountPercent: '50.00' }); }, /invalid child pricing/],
    ['excessive discount', p => { Object.assign(p.variants[0], { childMinAge: 6, childMaxAge: 12, childDiscountPercent: '100.01' }); }, /invalid child discount/],
  ];

  for (const [label, mutate, error] of invalid) {
    it(`rejects ${label}`, () => {
      const item = fixture();
      mutate(item);
      assert.throws(() => assertBrochureCatalogue([item]), error);
    });
  }

  it('accepts explicit weekdays and rejects duplicate catalogue identities', () => {
    const item = fixture();
    item.operatingDays = ['monday', 'sunday'];
    assert.doesNotThrow(() => assertBrochureCatalogue([item]));
    assert.throws(() => assertBrochureCatalogue([item, structuredClone(item)]), /invalid code/);
    assert.throws(() => assertBrochureCatalogue([item, { ...structuredClone(item), code: 'OTHER' }]), /invalid slug/);
  });

  it('validates the entire catalogue before issuing any SQL', async () => {
    let queries = 0;
    const client = { query: async () => { queries += 1; throw new Error('Unexpected SQL'); } } as unknown as PoolClient;
    const invalidItem = fixture();
    invalidItem.code = 'OTHER';
    invalidItem.slug = 'other';
    invalidItem.variants[0].rates[0].adultUnitRate = 'NaN';
    await assert.rejects(seedBrochurePackageCatalogue(client, [fixture(), invalidItem]), /invalid USD rate/);
    assert.equal(queries, 0);
  });
});

// Parking existing variants before a reorder. UNIQUE(package_id, sort_order)
// is NOT DEFERRABLE, so PostgreSQL checks it as each row is written rather
// than at statement end; these prove the seed never asks it to hold a
// duplicate, and that an impossible reorder is refused before anything moves.
describe('variant reorder parking', () => {
  type Recorded = { text: string; values: unknown[] };

  function reconcileClient(existingVariants: { key: string; sortOrder: number }[]) {
    const statements: Recorded[] = [];

    const client = {
      async query(text: string, values: unknown[] = []): Promise<unknown> {
        statements.push({ text, values });

        if (text.includes('FROM packages')) {
          return { rows: [{ id: '1', code: 'TEST-EXCURSION', slug: 'test-excursion', seed_managed: true }] };
        }
        if (text.includes('SELECT key, sort_order FROM package_variants')) {
          return { rows: existingVariants.map((v) => ({ key: v.key, sort_order: v.sortOrder })) };
        }
        if (text.includes('INSERT INTO package_variants')) {
          return { rows: [{ id: '10' }] };
        }
        return { rows: [] };
      },
    } as unknown as PoolClient;

    return { client, statements };
  }

  const find = (statements: Recorded[], needle: string) =>
    statements.findIndex((statement) => statement.text.includes(needle));

  const parkStatements = (statements: Recorded[]) =>
    statements.filter((statement) => statement.text.includes('WITH parked'));

  /** Two variants, so a genuine reorder is expressible. */
  function twoVariantFixture(): BrochurePackageSeed {
    const item = fixture();
    item.variants[0].isDefault = false;
    item.variants.push({
      ...structuredClone(item.variants[0]),
      key: 'second',
      label: 'Second',
      isDefault: false,
    });
    return item;
  }

  it('parks existing rows above both the values in use and the final range', async () => {
    // The immediate-unique regression: a naive temporary range starting at
    // n + 1 would target 3, which the second row still holds.
    const { client, statements } = reconcileClient([
      { key: 'standard', sortOrder: 1 },
      { key: 'second', sortOrder: 3 },
    ]);

    await seedBrochurePackageCatalogue(client, [twoVariantFixture()]);

    const park = parkStatements(statements);
    assert.equal(park.length, 1, 'exactly one parking statement');
    assert.equal(park[0]!.values[1], 3, 'base = max(maxExisting 3, n 2)');
  });

  it('uses the variant count as the base when existing values are lower', async () => {
    const { client, statements } = reconcileClient([{ key: 'standard', sortOrder: 0 }]);

    await seedBrochurePackageCatalogue(client, [twoVariantFixture()]);

    // A legal sort_order of 0 must not drag the base below the final range.
    assert.equal(parkStatements(statements)[0]!.values[1], 2, 'base = max(maxExisting 0, n 2)');
  });

  it('skips parking entirely when the package has no existing variants', async () => {
    const { client, statements } = reconcileClient([]);

    await seedBrochurePackageCatalogue(client, [twoVariantFixture()]);

    assert.equal(parkStatements(statements).length, 0, 'nothing to park on a fresh package');
  });

  it('parks after the guards and before any other variant mutation', async () => {
    const { client, statements } = reconcileClient([{ key: 'standard', sortOrder: 5 }]);

    await seedBrochurePackageCatalogue(client, [twoVariantFixture()]);

    const load = find(statements, 'SELECT key, sort_order FROM package_variants');
    const park = find(statements, 'WITH parked');
    const clearDefaults = find(statements, 'SET is_default = false');
    const upsert = find(statements, 'INSERT INTO package_variants');

    assert.ok(load >= 0 && park >= 0 && clearDefaults >= 0 && upsert >= 0);
    assert.ok(load < park, 'the locked read and its guards come first');
    assert.ok(park < clearDefaults, 'parking precedes the default reset');
    assert.ok(park < upsert, 'parking precedes the first final position');
  });

  it('never deletes an existing variant while reordering', async () => {
    const { client, statements } = reconcileClient([
      { key: 'standard', sortOrder: 1 },
      { key: 'second', sortOrder: 2 },
    ]);

    await seedBrochurePackageCatalogue(client, [twoVariantFixture()]);

    for (const statement of statements) {
      assert.doesNotMatch(statement.text, /DELETE FROM package_variants/i,
        'variant ids must survive: package_reservations references them with RESTRICT');
    }
  });

  it('writes final positions 1..n through the upsert loop', async () => {
    const { client, statements } = reconcileClient([
      { key: 'standard', sortOrder: 1 },
      { key: 'second', sortOrder: 3 },
    ]);

    await seedBrochurePackageCatalogue(client, [twoVariantFixture()]);

    const finals = statements
      .filter((statement) => statement.text.includes('INSERT INTO package_variants'))
      .map((statement) => statement.values[4]);

    assert.deepEqual(finals, [1, 2], 'no parked value may survive a successful seed');
  });

  it('refuses a reorder that cannot fit int4, before touching any variant row', async () => {
    const { client, statements } = reconcileClient([{ key: 'standard', sortOrder: 2147483647 }]);
    const item = fixture();

    await assert.rejects(
      seedBrochurePackageCatalogue(client, [item]),
      /cannot reorder variants without exceeding the sort order range/,
    );

    // The locked read happened; nothing after it did.
    assert.ok(find(statements, 'SELECT key, sort_order FROM package_variants') >= 0);
    assert.equal(parkStatements(statements).length, 0, 'no parking write');
    assert.equal(find(statements, 'SET is_default = false'), -1, 'no default reset');
    assert.equal(find(statements, 'INSERT INTO package_variants'), -1, 'no upsert');
  });

  it('still refuses an unexpected existing variant before any mutation', async () => {
    const { client, statements } = reconcileClient([
      { key: 'standard', sortOrder: 1 },
      { key: 'removed', sortOrder: 2 },
    ]);

    await assert.rejects(
      seedBrochurePackageCatalogue(client, [fixture()]),
      /unexpected existing variants: removed/,
    );

    assert.equal(parkStatements(statements).length, 0);
    assert.equal(find(statements, 'SET is_default = false'), -1);
    assert.equal(find(statements, 'INSERT INTO package_variants'), -1);
  });
});
