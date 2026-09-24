import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BROCHURE_PACKAGE_CATALOGUE } from '../src/db/seeds/packageCatalogue';
import { assertBrochureCatalogue, type BrochurePackageSeed } from '../src/db/seeds/packageCatalogueSeed';

// The real brochure catalogue, checked against the brochure's own facts. No
// database and no network: this is the data itself, not the seeding of it.

const byCode = new Map(BROCHURE_PACKAGE_CATALOGUE.map((item) => [item.code, item]));

function offering(code: string): BrochurePackageSeed {
  const item = byCode.get(code);
  assert.ok(item, `${code} must exist in the catalogue`);
  return item;
}

const TOUR_CODES = Array.from({ length: 25 }, (_, index) => `T${String(index + 1).padStart(3, '0')}`);
const PACKAGE_CODES = Array.from({ length: 17 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`);

/** Exactly the products whose brochure page warns the price can change. */
const PRICE_CONFIRMATION_CODES = [
  'T023', 'P01', 'P02', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P16', 'P17',
];

/** Every product whose brochure page prints no child column. */
const NO_CHILD_RULE_CODES = ['T010', 'T016', 'P13', 'P14', 'P15', 'P16', 'P17'];

describe('brochure catalogue composition', () => {
  it('contains exactly 42 offerings', () => {
    assert.equal(BROCHURE_PACKAGE_CATALOGUE.length, 42);
  });

  it('contains T001-T025 and P01-P17, each exactly once', () => {
    const codes = BROCHURE_PACKAGE_CATALOGUE.map((item) => item.code);

    assert.deepEqual([...codes].sort(), [...TOUR_CODES, ...PACKAGE_CODES].sort());
    assert.equal(new Set(codes).size, 42);
  });

  it('has unique slugs', () => {
    const slugs = BROCHURE_PACKAGE_CATALOGUE.map((item) => item.slug);

    assert.equal(new Set(slugs).size, 42, 'every public address must be distinct');
  });

  it('is accepted by the generic seed validator', () => {
    assert.doesNotThrow(() => assertBrochureCatalogue(BROCHURE_PACKAGE_CATALOGUE));
  });
});

describe('money is exact USD decimal strings', () => {
  // The catalogue carries no currency field: the schema and the API contract
  // pin USD, so the obligation here is that every amount is an exact decimal
  // string the USD contract accepts, never a JavaScript number.
  const MONEY = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;

  it('states every rate as a two-decimal string', () => {
    for (const item of BROCHURE_PACKAGE_CATALOGUE) {
      for (const variant of item.variants) {
        for (const rate of variant.rates) {
          assert.equal(typeof rate.adultUnitRate, 'string', `${item.code} rate must stay a string`);
          assert.match(rate.adultUnitRate, MONEY, `${item.code} rate ${rate.adultUnitRate}`);
        }
      }
    }
  });

  it('states every child discount as a two-decimal string', () => {
    for (const item of BROCHURE_PACKAGE_CATALOGUE) {
      for (const variant of item.variants) {
        if (variant.childDiscountPercent === null) continue;
        assert.match(variant.childDiscountPercent, MONEY, `${item.code}/${variant.key}`);
      }
    }
  });

  it('sells at least one rate for every offering', () => {
    for (const item of BROCHURE_PACKAGE_CATALOGUE) {
      const rates = item.variants.flatMap((variant) => variant.rates);
      assert.ok(rates.length > 0, `${item.code} must be priced`);
    }
  });
});

describe('party-size tiers', () => {
  it('maps T001 to 1 / 2 / 3+ with the brochure child rule', () => {
    const t001 = offering('T001');

    assert.equal(t001.variants.length, 1);
    const [variant] = t001.variants;
    assert.deepEqual(variant!.rates, [
      { minPartySize: 1, maxPartySize: 1, adultUnitRate: '104.00' },
      { minPartySize: 2, maxPartySize: 2, adultUnitRate: '92.00' },
      { minPartySize: 3, maxPartySize: null, adultUnitRate: '78.00' },
    ]);
    assert.equal(variant!.childMinAge, 6);
    assert.equal(variant!.childMaxAge, 12);
    assert.equal(variant!.childDiscountPercent, '50.00');
  });

  it('never bounds a 3+ tier anywhere in the catalogue', () => {
    for (const item of BROCHURE_PACKAGE_CATALOGUE) {
      for (const variant of item.variants) {
        for (const rate of variant.rates) {
          if (rate.minPartySize < 3) continue;
          assert.equal(
            rate.maxPartySize,
            null,
            `${item.code}/${variant.key} must leave the open-ended tier unbounded`,
          );
        }
      }
    }
  });

  it('keeps the 4x4 desert packages unbounded and records the vehicle note instead', () => {
    for (const code of ['P09', 'P10', 'P11', 'P12', 'P13', 'P14']) {
      const item = offering(code);
      const openTier = item.variants[0]!.rates.find((rate) => rate.minPartySize === 3);

      assert.ok(openTier, `${code} must price a 3+ party`);
      assert.equal(openTier.maxPartySize, null, `${code} must not cap the party at the vehicle size`);
      assert.ok(
        item.content.some(
          (entry) => entry.kind === 'note' && entry.text.includes('Maximum 4 people per 4 x 4 Car'),
        ),
        `${code} must keep the brochure's vehicle note`,
      );
    }
  });
});

describe('pricing shapes that are not party-size tiers', () => {
  it('gives T010 a single flat per-person price', () => {
    const t010 = offering('T010');

    assert.equal(t010.variants.length, 1);
    assert.deepEqual(t010.variants[0]!.rates, [
      { minPartySize: 1, maxPartySize: null, adultUnitRate: '91.00' },
    ]);
  });

  it('gives T016 the two brochure service options and no invented default', () => {
    const t016 = offering('T016');

    assert.equal(t016.variants.length, 2);
    assert.deepEqual(
      t016.variants.map((variant) => [variant.key, variant.label, variant.rates[0]!.adultUnitRate]),
      [
        ['lunch-or-dinner-included', 'Lunch or Dinner Included', '110.00'],
        ['only-drinks-included', 'Only Drinks Included', '98.00'],
      ],
    );
    assert.equal(t016.variants.filter((variant) => variant.isDefault).length, 0);
  });

  for (const [code, single, double] of [
    ['P16', '1638.00', '1313.00'],
    ['P17', '1898.00', '1651.00'],
  ] as const) {
    it(`gives ${code} single and double cabin variants with no bookable weekdays derived`, () => {
      const item = offering(code);

      assert.deepEqual(
        item.variants.map((variant) => [variant.key, variant.label, variant.rates[0]!.adultUnitRate]),
        [
          ['single-cabin', 'Single Cabin', single],
          ['double-cabin', 'Double Cabin', double],
        ],
      );
      assert.equal(item.variants.filter((variant) => variant.isDefault).length, 0);
      // The brochure's weekday range is preserved as a label only.
      assert.equal(item.operatingDays, null);
      assert.ok(item.scheduleLabel && item.scheduleLabel.length > 0);
    });
  }

  it('marks every single-variant offering as its own default', () => {
    for (const item of BROCHURE_PACKAGE_CATALOGUE) {
      if (item.variants.length !== 1) continue;
      assert.equal(item.variants[0]!.isDefault, true, `${item.code} single variant must be default`);
    }
  });
});

describe('child pricing comes only from the brochure', () => {
  it('leaves all three child fields null where no child column is printed', () => {
    for (const code of NO_CHILD_RULE_CODES) {
      for (const variant of offering(code).variants) {
        assert.equal(variant.childMinAge, null, `${code}/${variant.key} childMinAge`);
        assert.equal(variant.childMaxAge, null, `${code}/${variant.key} childMaxAge`);
        assert.equal(variant.childDiscountPercent, null, `${code}/${variant.key} childDiscountPercent`);
      }
    }
  });

  it('uses 6-12 at 50% wherever a child rule exists, and never any other rule', () => {
    for (const item of BROCHURE_PACKAGE_CATALOGUE) {
      for (const variant of item.variants) {
        if (variant.childMinAge === null) continue;
        assert.deepEqual(
          [variant.childMinAge, variant.childMaxAge, variant.childDiscountPercent],
          [6, 12, '50.00'],
          `${item.code}/${variant.key} must match the only child rule the brochure states`,
        );
      }
    }
  });

  it('states a child rule for exactly the offerings outside the no-child list', () => {
    const withRule = BROCHURE_PACKAGE_CATALOGUE
      .filter((item) => item.variants.some((variant) => variant.childMinAge !== null))
      .map((item) => item.code);

    assert.equal(withRule.length, 42 - NO_CHILD_RULE_CODES.length);
    for (const code of NO_CHILD_RULE_CODES) {
      assert.ok(!withRule.includes(code), `${code} must carry no child rule`);
    }
  });
});

describe('price confirmation', () => {
  it('flags exactly the twelve products whose brochure page warns of price change', () => {
    const flagged = BROCHURE_PACKAGE_CATALOGUE
      .filter((item) => item.requiresPriceConfirmation)
      .map((item) => item.code);

    assert.deepEqual([...flagged].sort(), [...PRICE_CONFIRMATION_CODES].sort());
  });

  it('keeps every other product unflagged', () => {
    for (const item of BROCHURE_PACKAGE_CATALOGUE) {
      if (PRICE_CONFIRMATION_CODES.includes(item.code)) continue;
      assert.equal(item.requiresPriceConfirmation, false, `${item.code}`);
    }
  });
});

describe('operating days are only ever transcribed', () => {
  it('opens every day for a page that says Every Day', () => {
    assert.deepEqual(offering('T001').operatingDays, [
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    ]);
  });

  it('opens Friday and Sunday only for T015', () => {
    assert.deepEqual(offering('T015').operatingDays, ['friday', 'sunday']);
    assert.equal(offering('T015').scheduleLabel, 'Every Friday & Sunday');
  });

  it('excludes Saturday and Thursday for P01', () => {
    const p01 = offering('P01');

    assert.equal(p01.scheduleLabel, 'Every Day Except Sat. & Thurs.');
    assert.deepEqual(p01.operatingDays, ['sunday', 'monday', 'tuesday', 'wednesday', 'friday']);
    assert.ok(!p01.operatingDays!.includes('saturday'));
    assert.ok(!p01.operatingDays!.includes('thursday'));
  });

  it('leaves operating days null wherever the page prints no Run line', () => {
    for (const code of ['T007', 'T008', 'T009', 'T012', 'T013', 'T014', 'T022', 'T024', 'T025']) {
      const item = offering(code);
      assert.equal(item.scheduleLabel, null, `${code} scheduleLabel`);
      assert.equal(item.operatingDays, null, `${code} operatingDays`);
    }
  });
});

describe('T004 carries the brochure’s own truncated title', () => {
  it('stores the visible text without completing it', () => {
    const t004 = offering('T004');

    assert.equal(t004.title, 'Desert Safari: Quad Bike around The Pyra');
    assert.equal(t004.slug, 'desert-safari-quad-bike');
    // The slug must not depend on guessing the cut-off word.
    assert.ok(!t004.slug.includes('pyramid'));
  });
});

describe('content is transcribed, never synthesised', () => {
  it('leaves summary null everywhere, because the brochure has no summary field', () => {
    for (const item of BROCHURE_PACKAGE_CATALOGUE) {
      assert.equal(item.summary, null, `${item.code} must not invent a summary`);
    }
  });

  it('records the multi-day packages as itinerary days', () => {
    for (const [code, days] of [['P01', 2], ['P02', 2], ['P13', 7], ['P14', 5], ['P17', 5]] as const) {
      const numbered = offering(code).itinerary.filter((section) => section.dayNumber !== null);
      assert.equal(numbered.length, days, `${code} itinerary days`);
    }
  });

  it('gives the single-price day tours no itinerary rows', () => {
    for (const code of ['T001', 'T010', 'T024', 'T025']) {
      assert.deepEqual(offering(code).itinerary, [], `${code} has no brochure itinerary`);
    }
  });

  it('keeps the brochure exclusions only where they are printed', () => {
    for (const code of ['P09', 'P10', 'P11', 'P12']) {
      assert.ok(
        offering(code).content.some((entry) => entry.kind === 'excluded'),
        `${code} must keep its alcohol exclusion`,
      );
    }
    assert.ok(offering('P17').content.some((entry) => entry.kind === 'excluded'));
    // T001's page prints only a Fees Include block.
    assert.ok(!offering('T001').content.some((entry) => entry.kind === 'excluded'));
  });
});
