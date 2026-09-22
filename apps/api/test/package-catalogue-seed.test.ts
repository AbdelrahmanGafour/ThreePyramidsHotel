import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
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

  for (const amount of ['0.00', '0.01', '9999999999.99']) {
    it(`accepts exact EGP amount ${amount}`, () => {
      const item = fixture();
      item.variants[0].rates[0].adultUnitRate = amount;
      assert.doesNotThrow(() => assertBrochureCatalogue([item]));
    });
  }

  for (const amount of ['-0.01', '1.001', '1', '01.00', '1e2', 'NaN', 'Infinity',
    '10000000000.00', '1.00\n', ' 1.00', 1]) {
    it(`rejects invalid EGP amount ${JSON.stringify(amount)}`, () => {
      const item = fixture();
      item.variants[0].rates[0].adultUnitRate = amount as string;
      assert.throws(() => assertBrochureCatalogue([item]), /invalid EGP rate/);
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
    ['missing rates', p => { p.variants[0].rates = []; }, /no rate tiers/],
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
    await assert.rejects(seedBrochurePackageCatalogue(client, [fixture(), invalidItem]), /invalid EGP rate/);
    assert.equal(queries, 0);
  });
});
