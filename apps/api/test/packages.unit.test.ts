import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { mapPackageCardRow, mapPackageDetailRow } from '../src/modules/packages/packages.mapping';
import { parsePackageSlug } from '../src/modules/packages/packages.validation';
import { InvalidPackageSlugError } from '../src/modules/packages/packages.types';

const rate = { min_party_size: 3, max_party_size: null, adult_unit_rate: '80.25', currency: 'EGP' };
const card = {
  code: 'TEST', slug: 'synthetic-tour', title: 'Synthetic tour', summary: null,
  duration_label: null, schedule_label: null, operating_days: null,
  requires_price_confirmation: false, from_rate: { ...rate, variant_key: 'standard' },
};
const detail = {
  ...card, description: null,
  itinerary: [{ day_number: null, heading: null, body: 'Narrative' }],
  content: [{ kind: 'note', text: 'Source qualification' }],
  variants: [{ key: 'standard', label: 'Standard', is_default: true,
    child_min_age: 6, child_max_age: 12, child_discount_percent: '50.00', rates: [rate] }],
};

describe('package slug validation', () => {
  for (const value of ['a', 'tour-123', 'a'.repeat(120)]) {
    it(`accepts a canonical slug of length ${value.length}`, () => assert.equal(parsePackageSlug(value), value));
  }
  for (const value of [undefined, null, [], 1, '', 'Tour', '-tour', 'tour-', 'tour--option', ' tour',
    'tour ', 'tour\n', 'tour/name', '../tour', '%2F', 'tour?x=1', 'a'.repeat(121), 'رحلة']) {
    it(`rejects ${JSON.stringify(value)}`, () => assert.throws(() => parsePackageSlug(value), InvalidPackageSlugError));
  }
});

describe('strict package row mapping', () => {
  it('whitelists public fields and preserves exact rates and nullable data', () => {
    const mapped = mapPackageDetailRow({ ...detail, id: '42', created_at: 'private', is_active: true,
      variants: [{ ...detail.variants[0], id: '88', package_id: '42' }] });
    assert.equal(mapped.fromRate?.adultUnitRate, '80.25');
    assert.equal(mapped.variants[0].childDiscountPercent, '50.00');
    assert.equal(mapped.description, null);
    assert.equal(mapped.itinerary[0].dayNumber, null);
    assert.deepEqual(mapped.notes, ['Source qualification']);
    assert.deepEqual(mapped.included, []);
    assert.deepEqual(mapped.excluded, []);
    assert.ok(!JSON.stringify(mapped).includes('"id"'));
    assert.ok(!JSON.stringify(mapped).includes('created_at'));
    assert.ok(!JSON.stringify(mapped).includes('package_id'));
  });
  it('represents absent pricing as null and empty detail collections as arrays', () => {
    const mapped = mapPackageDetailRow({ ...detail, from_rate: null, itinerary: [], content: [], variants: [] });
    assert.equal(mapped.fromRate, null);
    assert.deepEqual(mapped.variants, []);
  });
  for (const amount of ['0.00', '0.01', '9999999999.99']) {
    it(`preserves amount ${amount}`, () => {
      assert.equal(mapPackageCardRow({ ...card, from_rate: { ...card.from_rate, adult_unit_rate: amount } }).fromRate?.adultUnitRate, amount);
    });
  }
  for (const amount of [80.25, 'NaN', '-1.00', '1e2', '1.001', '1.00\n', '10000000000.00', null]) {
    it(`rejects malformed rate ${JSON.stringify(amount)}`, () => {
      assert.throws(() => mapPackageCardRow({ ...card, from_rate: { ...card.from_rate, adult_unit_rate: amount } }), /Invalid package catalogue row/);
    });
  }
  const invalid: [string, unknown][] = [
    ['requires_price_confirmation', 'false'], ['slug', 'Bad'], ['title', ''], ['summary', 3],
    ['operating_days', []], ['operating_days', ['monday', 'monday']], ['operating_days', [null]],
    ['operating_days', ['funday']], ['from_rate', undefined],
  ];
  for (const [field, value] of invalid) {
    it(`rejects invalid ${field}=${JSON.stringify(value)}`, () => {
      assert.throws(() => mapPackageCardRow({ ...card, [field]: value }), /Invalid package catalogue row/);
    });
  }
  it('rejects USD, inverted tiers, invalid content and incomplete child rules', () => {
    assert.throws(() => mapPackageCardRow({ ...card, from_rate: { ...card.from_rate, currency: 'USD' } }));
    assert.throws(() => mapPackageCardRow({ ...card, from_rate: { ...card.from_rate, max_party_size: 2 } }));
    assert.throws(() => mapPackageDetailRow({ ...detail, content: [{ kind: 'other', text: 'Text' }] }));
    assert.throws(() => mapPackageDetailRow({ ...detail, variants: [{ ...detail.variants[0], child_max_age: null }] }));
    assert.throws(() => mapPackageDetailRow({ ...detail, variants: [{ ...detail.variants[0], child_discount_percent: '100.01' }] }));
    assert.throws(() => mapPackageDetailRow({ ...detail, variants: [{ ...detail.variants[0], is_default: 'true' }] }));
    assert.throws(() => mapPackageDetailRow({ ...detail, variants: [{ ...detail.variants[0], rates: null }] }));
    assert.throws(() => mapPackageDetailRow({ ...detail, itinerary: [{ day_number: 0, heading: null, body: 'Text' }] }));
  });
});

describe('package service pricing and validation', () => {
  let service: typeof import('../src/modules/packages/packages.service');
  let pool: typeof import('../src/db/pool');
  before(async () => {
    process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
    service = await import('../src/modules/packages/packages.service.js');
    pool = await import('../src/db/pool.js');
  });
  it('returns the rate with its actual variant and party-size condition, never a quote', () => {
    const result = service.toPackageCard(mapPackageCardRow(card));
    assert.deepEqual(result.pricing, { status: 'from', unit: 'per_person',
      from: { adultUnitRate: '80.25', variantKey: 'standard', minPartySize: 3, maxPartySize: null } });
    assert.equal(result.currency, 'EGP');
    assert.ok(!('fromRate' in result));
  });
  it('suppresses guaranteed display prices for confirmation-required products', () => {
    const result = service.toPackageCard(mapPackageCardRow({ ...card, requires_price_confirmation: true }));
    assert.deepEqual(result.pricing, { status: 'requires_confirmation', unit: 'per_person', from: null });
  });
  it('does not invent zero prices when no rates exist', () => {
    const result = service.toPackageCard(mapPackageCardRow({ ...card, from_rate: null }));
    assert.equal(result.pricing.status, 'unavailable');
    assert.equal(result.pricing.from, null);
  });
  it('rejects malformed slugs before issuing a query', async () => {
    const query = mock.method(pool.dbPool, 'query', () => { throw new Error('Query must not run'); });
    try {
      await assert.rejects(service.getPackageBySlug("x' OR 1=1"), InvalidPackageSlugError);
      assert.equal(query.mock.callCount(), 0);
    } finally { query.mock.restore(); }
  });
});
