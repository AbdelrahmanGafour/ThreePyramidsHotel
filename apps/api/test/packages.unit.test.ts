import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { mapPackageCardRow, mapPackageDetailRow } from '../src/modules/packages/packages.mapping';
import { parsePackageSlug } from '../src/modules/packages/packages.validation';
import { InvalidPackageSlugError, PackageNotFoundError } from '../src/modules/packages/packages.types';

const rate = { min_party_size: 3, max_party_size: null, adult_unit_rate: '80.25', currency: 'USD' };
const card = {
  code: 'TEST', slug: 'synthetic-tour', title: 'Synthetic tour', summary: null,
  duration_label: null, schedule_label: null, operating_days: null,
  requires_price_confirmation: false, from_rate: { ...rate, variant_key: 'standard' },
  // Selected by every catalogue query now, so a fixture without it is a row
  // this system would never produce. `null` is a journey with no image.
  image: null,
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
  it('rejects a non-USD currency, inverted tiers, invalid content and incomplete child rules', () => {
    // The V1 package catalogue is USD-only; a stored row in any other
    // currency is malformed catalogue data, not something to render.
    assert.throws(() => mapPackageCardRow({ ...card, from_rate: { ...card.from_rate, currency: 'EGP' } }));
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
    assert.equal(result.currency, 'USD');
    assert.ok(!('fromRate' in result));
  });
  it('preserves display rates while marking confirmation-required products honestly', () => {
    const result = service.toPackageCard(mapPackageCardRow({ ...card, requires_price_confirmation: true }));
    assert.deepEqual(result.pricing, { status: 'requires_confirmation', unit: 'per_person',
      from: { adultUnitRate: '80.25', variantKey: 'standard', minPartySize: 3, maxPartySize: null } });
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

// ---------------------------------------------------------------------------
// The journey's one image, in the public catalogue
// ---------------------------------------------------------------------------
//
// Two rules carry this feature. The reference must never leave the API — it
// is what a URL is composed FROM, and a guest is given the URL — and an
// absent image must be `null` rather than a placeholder somebody has to
// notice is fake.

const REFERENCE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const imageRow = { reference: REFERENCE, alt_text: 'Dawn over the plateau', width: 1200, height: 800 };
const BASE = 'https://media.example.test';

describe('journey image row mapping', () => {
  it('maps the four fields and keeps the reference internal to the record', () => {
    const mapped = mapPackageCardRow({ ...card, image: imageRow });

    assert.deepEqual(mapped.image, {
      reference: REFERENCE,
      altText: 'Dawn over the plateau',
      width: 1200,
      height: 800,
    });
  });

  it('maps a journey with no image to null', () => {
    assert.equal(mapPackageCardRow({ ...card, image: null }).image, null);
  });

  it('accepts a null description, because a decorative image is a real case', () => {
    assert.equal(mapPackageCardRow({ ...card, image: { ...imageRow, alt_text: null } }).image?.altText, null);
  });

  it('fails closed on a malformed image row rather than reporting no image', () => {
    // Every one of these is this system's own data being wrong. Coercing any
    // of them into `image: null` would look exactly like a journey that
    // simply has no picture, which is the one answer that must not be
    // guessed at.
    for (const [label, value] of [
      ['a missing key', undefined],
      ['a non-canonical reference', { ...imageRow, reference: REFERENCE.toUpperCase() }],
      ['a braced reference', { ...imageRow, reference: `{${REFERENCE}}` }],
      ['a padded reference', { ...imageRow, reference: ` ${REFERENCE} ` }],
      ['a v1 reference', { ...imageRow, reference: 'a1b2c3d4-e5f6-1a7b-8c9d-0e1f2a3b4c5d' }],
      ['a missing reference', { ...imageRow, reference: null }],
      ['a zero width', { ...imageRow, width: 0 }],
      ['a negative height', { ...imageRow, height: -1 }],
      ['a fractional width', { ...imageRow, width: 12.5 }],
      ['a string height', { ...imageRow, height: '800' }],
      ['alt text that is not text', { ...imageRow, alt_text: 42 }],
      ['an array instead of an object', [imageRow]],
    ] as const) {
      assert.throws(
        () => mapPackageCardRow({ ...card, image: value }),
        /Invalid package catalogue row/,
        `${label} must fail closed`,
      );
    }
  });

  it('never lets an internal media field reach the record', () => {
    const mapped = mapPackageCardRow({
      ...card,
      image: { ...imageRow, id: '7', media_asset_id: '9', storage_key: `media/${REFERENCE}.webp`,
        checksum_sha256: 'a'.repeat(64), content_type: 'image/webp', byte_size: '4096' },
    });

    const serialised = JSON.stringify(mapped);
    for (const leaked of ['media_asset_id', 'storage_key', 'checksum', 'content_type', 'byte_size', '"id"']) {
      assert.ok(!serialised.includes(leaked), `${leaked} must not survive mapping`);
    }
  });
});

describe('journey image URL composition', () => {
  let service: typeof import('../src/modules/packages/packages.service');

  before(async () => {
    process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
    service = await import('../src/modules/packages/packages.service.js');
  });

  it('turns the reference into the shared media URL and drops it', () => {
    const result = service.toPackageCard(mapPackageCardRow({ ...card, image: imageRow }), () => BASE);

    assert.deepEqual(result.image, {
      url: `${BASE}/media/${REFERENCE}.webp`,
      altText: 'Dawn over the plateau',
      width: 1200,
      height: 800,
    });
    assert.ok(!JSON.stringify(result).includes('reference'), 'the reference stays inside the API');
  });

  it('composes the same URL the shared delivery module would', async () => {
    const { composePublicMediaUrl } = await import('../src/modules/media/media.delivery.js');
    const { parseMediaReference } = await import('../src/modules/media/media.validation.js');
    const { mediaStorageKey } = await import('../src/modules/media/media.validation.js');

    const reference = parseMediaReference(REFERENCE)!;
    const result = service.toPackageCard(mapPackageCardRow({ ...card, image: imageRow }), () => BASE);

    // Not merely "looks like a URL": byte for byte what room-type media
    // produces from the same base and the same reference, and carrying the
    // unchanged `media/<uuid>.webp` key.
    assert.equal(result.image?.url, composePublicMediaUrl(BASE, reference));
    assert.ok(result.image?.url.endsWith(mediaStorageKey(reference)));
    assert.match(result.image!.url, /\/media\/[0-9a-f-]{36}\.webp$/);
  });

  it('keeps a configured path prefix, joining rather than replacing it', () => {
    const result = service.toPackageCard(
      mapPackageCardRow({ ...card, image: imageRow }),
      () => 'https://media.example.test/assets',
    );

    assert.equal(result.image?.url, `https://media.example.test/assets/media/${REFERENCE}.webp`);
  });

  it('never resolves the base for a journey with no image', () => {
    let resolutions = 0;
    const resolve = () => {
      resolutions += 1;
      return BASE;
    };

    const result = service.toPackageCard(mapPackageCardRow({ ...card, image: null }), resolve);

    assert.equal(result.image, null);
    assert.equal(resolutions, 0, 'an unconfigured deployment still serves a catalogue with no images');
  });

  it('lets a configuration failure surface rather than reporting no image', () => {
    // The half that matters as much: answering "this journey has no picture"
    // because the server cannot work out where its pictures live would be a
    // lie that looks exactly like the truth.
    assert.throws(
      () => service.toPackageCard(mapPackageCardRow({ ...card, image: imageRow }), () => {
        throw new Error('R2_PUBLIC_BASE_URL must be set');
      }),
      /R2_PUBLIC_BASE_URL must be set/,
    );
  });

  it('refuses to invent a base when a caller supplied no resolver', () => {
    assert.throws(
      () => service.toPackageCard(mapPackageCardRow({ ...card, image: imageRow })),
      /needs the public media base/,
    );

    // And a card with no image still needs none, which is what lets the
    // pure pricing tests above call this with one argument.
    assert.equal(service.toPackageCard(mapPackageCardRow({ ...card, image: null })).image, null);
  });
});

describe('journey catalogue reads', () => {
  let service: typeof import('../src/modules/packages/packages.service');
  let pool: typeof import('../src/db/pool');

  before(async () => {
    process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
    service = await import('../src/modules/packages/packages.service.js');
    pool = await import('../src/db/pool.js');
  });

  /** Captures every statement the read issues, and answers with fixed rows. */
  function stubQuery(rows: Record<string, unknown>[]) {
    const statements: string[] = [];
    const query = mock.method(pool.dbPool, 'query', (text: string) => {
      statements.push(text);
      return Promise.resolve({ rows });
    });

    return { statements, restore: () => query.mock.restore() };
  }

  it('reads a whole catalogue in one statement, whatever its size', async () => {
    // The point of the LEFT JOIN. `package_media` has UNIQUE (package_id),
    // so a journey contributes at most one row and thirty journeys still
    // cost the one statement three did.
    const many = Array.from({ length: 30 }, (_, index) => ({
      ...card,
      code: `T${index}`,
      slug: `journey-${index}`,
      image: index % 2 === 0 ? imageRow : null,
    }));
    const stub = stubQuery(many);

    try {
      const cards = await service.listPackages(() => BASE);

      assert.equal(stub.statements.length, 1, 'one query, never one per journey');
      assert.equal(cards.length, 30);
      assert.equal(cards.filter((entry) => entry.image !== null).length, 15);
      assert.equal(cards.filter((entry) => entry.image === null).length, 15);
    } finally {
      stub.restore();
    }
  });

  it('joins the image into the existing catalogue query rather than adding one', async () => {
    const stub = stubQuery([{ ...card, image: imageRow }]);

    try {
      await service.listPackages(() => BASE);

      const [statement] = stub.statements;
      assert.match(statement!, /LEFT JOIN package_media pm ON pm\.package_id = p\.id/);
      assert.match(statement!, /LEFT JOIN media_assets ma ON ma\.id = pm\.media_asset_id/);
      // The filter and the order the catalogue already had, unchanged.
      assert.match(statement!, /WHERE p\.is_active = true/);
      assert.match(statement!, /ORDER BY p\.sort_order, p\.id/);
      // And no id or object key is selected at all.
      assert.ok(!/pm\.id|ma\.id AS|storage_key|checksum_sha256|byte_size|content_type/.test(statement!));
    } finally {
      stub.restore();
    }
  });

  it('reads one journey in one statement, image included', async () => {
    const stub = stubQuery([{
      ...detail,
      image: imageRow,
    }]);

    try {
      const result = await service.getPackageBySlug('synthetic-tour', () => BASE);

      assert.equal(stub.statements.length, 1, 'the detail read gains no second query');
      assert.equal(result.image?.url, `${BASE}/media/${REFERENCE}.webp`);
      // Everything the detail already projected is still there.
      assert.equal(result.variants.length, 1);
      assert.equal(result.itinerary.length, 1);
      assert.deepEqual(result.notes, ['Source qualification']);
      assert.equal(result.pricing.status, 'from');
    } finally {
      stub.restore();
    }
  });

  it('answers a journey with no image as null, in both shapes', async () => {
    const listStub = stubQuery([{ ...card, image: null }]);

    try {
      assert.equal((await service.listPackages(() => BASE))[0]!.image, null);
    } finally {
      listStub.restore();
    }

    const detailStub = stubQuery([{ ...detail, image: null }]);

    try {
      const result = await service.getPackageBySlug('synthetic-tour', () => BASE);
      assert.equal(result.image, null);
      assert.ok('image' in result, 'the key is always present, so null is distinguishable from absent');
    } finally {
      detailStub.restore();
    }
  });

  it('still answers a slug nothing matches with PackageNotFoundError', async () => {
    const stub = stubQuery([]);

    try {
      await assert.rejects(service.getPackageBySlug('synthetic-tour', () => BASE), PackageNotFoundError);
    } finally {
      stub.restore();
    }
  });

  it('exposes no internal media field anywhere in a response', async () => {
    const stub = stubQuery([{ ...detail, image: imageRow }]);

    try {
      const serialised = JSON.stringify(await service.getPackageBySlug('synthetic-tour', () => BASE));

      for (const leaked of [
        'reference',
        'storage_key',
        'storageKey',
        'media_asset_id',
        'mediaAssetId',
        'checksum',
        'content_type',
        'contentType',
        'byte_size',
        'byteSize',
        'bucket',
      ]) {
        assert.ok(!serialised.includes(leaked), `${leaked} must not reach a guest`);
      }

      // The UUID itself is deliberately NOT forbidden: it is the object
      // key, and it belongs inside the URL a browser fetches. What must
      // not appear is a `reference` FIELD handing it over as data.
      assert.match(serialised, new RegExp(`"url":"[^"]*media/${REFERENCE}\\.webp"`));
      assert.equal(serialised.split(REFERENCE).length - 1, 1, 'once, in the URL, and nowhere else');
    } finally {
      stub.restore();
    }
  });
});
