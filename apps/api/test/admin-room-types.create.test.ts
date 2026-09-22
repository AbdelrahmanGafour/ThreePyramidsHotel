import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INVALID_ROOM_TYPE_CREATE_ERROR_CODE,
  INVALID_ROOM_TYPE_CREATE_ERROR_MESSAGE,
  ROOM_TYPE_SLUG_TAKEN_RESPONSE,
  isInvalidRoomTypeCreateError,
} from '../src/modules/admin-room-types/admin-room-types.types';
import { PG_INT4_MAX } from '../src/modules/admin-room-types/admin-room-types.fields';
import { parseAdminRoomTypeCreate } from '../src/modules/admin-room-types/admin-room-types.validation';

// Pure: the validation module imports no database code.

/** The four required fields, so each test can vary exactly one thing. */
const MINIMUM = {
  slug: 'garden-suite',
  name: 'Garden Suite',
  capacity: 2,
  baseNightlyRate: '2400.00',
} as const;

function assertRejected(body: unknown, label: string): void {
  assert.throws(
    () => parseAdminRoomTypeCreate(body),
    (error: unknown) => {
      assert.ok(isInvalidRoomTypeCreateError(error), `expected a create error for ${label}, got: ${String(error)}`);
      assert.equal(error.code, INVALID_ROOM_TYPE_CREATE_ERROR_CODE);
      // The message is part of the locked response contract, not free text.
      assert.equal(error.message, INVALID_ROOM_TYPE_CREATE_ERROR_MESSAGE);
      // Naming the offending field would map the model for a caller. Matched
      // on word boundaries: a bare "id" would otherwise hit "Invalid".
      assert.ok(
        !/\b(slug|capacity|isActive|currency|createdAt|updatedAt|roomCount|baseNightlyRate|sortOrder)\b/i.test(
          error.message,
        ),
        'the message must not name the offending field',
      );
      return true;
    },
    `expected ${label} to be rejected`,
  );
}

/** Varies one field of the minimum valid body. */
const withField = (field: string, value: unknown) => ({ ...MINIMUM, [field]: value });

describe('parseAdminRoomTypeCreate', () => {
  describe('accepts', () => {
    it('the minimum valid create, filling every optional field', () => {
      assert.deepEqual(parseAdminRoomTypeCreate({ ...MINIMUM }), {
        slug: 'garden-suite',
        name: 'Garden Suite',
        capacity: 2,
        baseNightlyRate: '2400.00',
        sortOrder: 0,
        shortDescription: null,
        description: null,
        bedType: null,
        bedCount: null,
        sizeSqm: null,
        view: null,
      });
    });

    it('a full create carrying every accepted field', () => {
      assert.deepEqual(
        parseAdminRoomTypeCreate({
          slug: 'plateau-suite',
          name: '  Plateau Suite  ',
          capacity: 3,
          baseNightlyRate: '3200.50',
          sortOrder: 7,
          shortDescription: '  A quiet upper floor.  ',
          description: 'Longer copy.',
          bedType: 'King',
          bedCount: 2,
          sizeSqm: '42.50',
          view: 'Plateau',
        }),
        {
          slug: 'plateau-suite',
          name: 'Plateau Suite',
          capacity: 3,
          baseNightlyRate: '3200.50',
          sortOrder: 7,
          shortDescription: 'A quiet upper floor.',
          description: 'Longer copy.',
          bedType: 'King',
          bedCount: 2,
          sizeSqm: '42.50',
          view: 'Plateau',
        },
      );
    });

    it('a zero nightly rate — a room type may be priced on request', () => {
      assert.equal(parseAdminRoomTypeCreate(withField('baseNightlyRate', '0')).baseNightlyRate, '0');
      assert.equal(parseAdminRoomTypeCreate(withField('baseNightlyRate', '0.00')).baseNightlyRate, '0.00');
    });

    it('an explicit null for every nullable field', () => {
      const created = parseAdminRoomTypeCreate({
        ...MINIMUM,
        shortDescription: null,
        description: null,
        bedType: null,
        bedCount: null,
        sizeSqm: null,
        view: null,
      });

      for (const field of ['shortDescription', 'description', 'bedType', 'bedCount', 'sizeSqm', 'view'] as const) {
        assert.equal(created[field], null, field);
      }
    });

    it('an empty or whitespace-only descriptive field, as null', () => {
      assert.equal(parseAdminRoomTypeCreate(withField('shortDescription', '')).shortDescription, null);
      assert.equal(parseAdminRoomTypeCreate(withField('description', '   ')).description, null);
      assert.equal(parseAdminRoomTypeCreate(withField('view', '\t\n')).view, null);
    });

    it('sortOrder 0 explicitly, and defaults to 0 when omitted', () => {
      assert.equal(parseAdminRoomTypeCreate(withField('sortOrder', 0)).sortOrder, 0);
      assert.equal(parseAdminRoomTypeCreate({ ...MINIMUM }).sortOrder, 0);
    });

    it('capacity of exactly 1, the schema floor', () => {
      assert.equal(parseAdminRoomTypeCreate(withField('capacity', 1)).capacity, 1);
    });

    it('every count at the integer column maximum', () => {
      // capacity, bed_count and sort_order are all int4 columns. This is the
      // real ceiling, not Number.MAX_SAFE_INTEGER: a larger value used to pass
      // validation and then fail inside PostgreSQL as a 22003.
      assert.equal(parseAdminRoomTypeCreate(withField('capacity', PG_INT4_MAX)).capacity, PG_INT4_MAX);
      assert.equal(parseAdminRoomTypeCreate(withField('bedCount', PG_INT4_MAX)).bedCount, PG_INT4_MAX);
      assert.equal(parseAdminRoomTypeCreate(withField('sortOrder', PG_INT4_MAX)).sortOrder, PG_INT4_MAX);
    });

    it('a null bedCount, still, now that the field is bounded', () => {
      assert.equal(parseAdminRoomTypeCreate(withField('bedCount', null)).bedCount, null);
    });

    it('decimal precision at both boundaries', () => {
      // numeric(12,2): ten digits before the point, two after.
      assert.equal(
        parseAdminRoomTypeCreate(withField('baseNightlyRate', '9999999999.99')).baseNightlyRate,
        '9999999999.99',
      );
      // numeric(6,2): four before, two after.
      assert.equal(parseAdminRoomTypeCreate(withField('sizeSqm', '9999.99')).sizeSqm, '9999.99');
      assert.equal(parseAdminRoomTypeCreate(withField('sizeSqm', '0.01')).sizeSqm, '0.01');
    });

    it('a slug at the maximum length', () => {
      const slug = 'a'.repeat(120);
      assert.equal(parseAdminRoomTypeCreate(withField('slug', slug)).slug, slug);
    });

    it('text fields at their maximum lengths', () => {
      const created = parseAdminRoomTypeCreate({
        ...MINIMUM,
        name: 'n'.repeat(120),
        shortDescription: 's'.repeat(300),
        description: 'd'.repeat(2000),
        bedType: 'b'.repeat(60),
        view: 'v'.repeat(120),
      });

      assert.equal(created.name.length, 120);
      assert.equal(created.shortDescription?.length, 300);
      assert.equal(created.description?.length, 2000);
      assert.equal(created.bedType?.length, 60);
      assert.equal(created.view?.length, 120);
    });
  });

  describe('never decides isActive', () => {
    it('produces no isActive key at all — creation always yields a draft', () => {
      const created = parseAdminRoomTypeCreate({ ...MINIMUM });

      assert.ok(!('isActive' in created));
      assert.deepEqual(Object.keys(created).sort(), [
        'baseNightlyRate',
        'bedCount',
        'bedType',
        'capacity',
        'description',
        'name',
        'shortDescription',
        'sizeSqm',
        'slug',
        'sortOrder',
        'view',
      ]);
    });
  });

  describe('does not mutate the caller', () => {
    it('leaves the supplied body untouched', () => {
      const body = { ...MINIMUM, name: '  Garden Suite  ', shortDescription: '  x  ' };
      const before = JSON.stringify(body);

      parseAdminRoomTypeCreate(body);

      assert.equal(JSON.stringify(body), before);
    });
  });

  describe('rejects a body that is not a JSON object', () => {
    for (const [label, body] of [
      ['null', null],
      ['undefined', undefined],
      ['an array', [{ ...MINIMUM }]],
      ['a string', 'garden-suite'],
      ['a number', 1],
      ['a boolean', true],
      ['a Date', new Date()],
      ['a Map', new Map()],
      ['an empty object', {}],
    ] as const) {
      it(label, () => {
        assertRejected(body, label);
      });
    }

    it('accepts a null-prototype object, which JSON.parse can produce', () => {
      const body = Object.assign(Object.create(null), MINIMUM);
      assert.equal(parseAdminRoomTypeCreate(body).slug, 'garden-suite');
    });
  });

  describe('rejects a missing required field', () => {
    for (const field of ['slug', 'name', 'capacity', 'baseNightlyRate'] as const) {
      it(`without ${field}`, () => {
        const body: Record<string, unknown> = { ...MINIMUM };
        delete body[field];
        assertRejected(body, `missing ${field}`);
      });

      it(`with ${field} explicitly undefined`, () => {
        assertRejected(withField(field, undefined), `${field}: undefined`);
      });

      it(`with ${field} explicitly null`, () => {
        assertRejected(withField(field, null), `${field}: null`);
      });
    }
  });

  describe('rejects a malformed slug', () => {
    for (const [label, slug] of [
      ['uppercase', 'Garden-Suite'],
      ['mixed case', 'gardenSuite'],
      ['padded', ' garden-suite '],
      ['leading hyphen', '-garden'],
      ['trailing hyphen', 'garden-'],
      ['doubled hyphen', 'garden--suite'],
      ['underscore', 'garden_suite'],
      ['a space', 'garden suite'],
      ['a slash', 'garden/suite'],
      ['a dot', 'garden.suite'],
      ['empty', ''],
      ['over the maximum length', 'a'.repeat(121)],
      ['a number', 12],
    ] as const) {
      it(label, () => {
        assertRejected(withField('slug', slug), `slug: ${label}`);
      });
    }
  });

  describe('rejects an unusable capacity', () => {
    for (const [label, capacity] of [
      ['zero', 0],
      ['negative', -1],
      ['fractional', 2.5],
      ['one past the integer column maximum', PG_INT4_MAX + 1],
      ['not a safe integer', Number.MAX_SAFE_INTEGER + 1],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['NaN', Number.NaN],
      ['a numeric string', '2'],
      ['a boolean', true],
    ] as const) {
      it(label, () => {
        assertRejected(withField('capacity', capacity), `capacity: ${label}`);
      });
    }
  });

  describe('rejects an unusable base nightly rate', () => {
    for (const [label, rate] of [
      ['a number, which has already lost precision', 2400],
      ['a float', 2400.5],
      ['negative', '-1.00'],
      ['a leading plus', '+1.00'],
      ['an exponent', '1e3'],
      ['padded', ' 2400.00 '],
      ['three decimal places', '2400.000'],
      ['eleven digits before the point', '12345678901.00'],
      ['a bare decimal point', '2400.'],
      ['no integer part', '.50'],
      ['empty', ''],
      ['a comma separator', '2,400.00'],
      ['null', null],
    ] as const) {
      it(label, () => {
        assertRejected(withField('baseNightlyRate', rate), `baseNightlyRate: ${label}`);
      });
    }
  });

  describe('rejects an unusable sizeSqm', () => {
    for (const [label, size] of [
      ['zero', '0'],
      ['zero with decimals', '0.00'],
      ['a number', 42],
      ['negative', '-42.00'],
      ['an exponent', '4e1'],
      ['five digits before the point', '12345.00'],
      ['three decimal places', '42.500'],
      ['padded', ' 42.50 '],
    ] as const) {
      it(label, () => {
        assertRejected(withField('sizeSqm', size), `sizeSqm: ${label}`);
      });
    }
  });

  describe('rejects an unusable bedCount', () => {
    for (const [label, bedCount] of [
      ['zero', 0],
      ['negative', -1],
      ['fractional', 1.5],
      ['a numeric string', '2'],
      ['one past the integer column maximum', PG_INT4_MAX + 1],
      ['not a safe integer', Number.MAX_SAFE_INTEGER + 1],
    ] as const) {
      it(label, () => {
        assertRejected(withField('bedCount', bedCount), `bedCount: ${label}`);
      });
    }
  });

  describe('rejects an unusable sortOrder', () => {
    for (const [label, sortOrder] of [
      ['negative', -1],
      ['fractional', 1.5],
      ['a numeric string', '1'],
      ['null', null],
      ['one past the integer column maximum', PG_INT4_MAX + 1],
      ['not a safe integer', Number.MAX_SAFE_INTEGER + 1],
    ] as const) {
      it(label, () => {
        assertRejected(withField('sortOrder', sortOrder), `sortOrder: ${label}`);
      });
    }
  });

  describe('rejects text past its maximum length', () => {
    for (const [field, maxLength] of [
      ['name', 120],
      ['shortDescription', 300],
      ['description', 2000],
      ['bedType', 60],
      ['view', 120],
    ] as const) {
      it(`${field} at ${maxLength + 1} characters`, () => {
        assertRejected(withField(field, 'x'.repeat(maxLength + 1)), `${field}: too long`);
      });
    }

    it('a name that is only whitespace', () => {
      assertRejected(withField('name', '   '), 'name: whitespace only');
    });

    it('a name that is not a string', () => {
      assertRejected(withField('name', 42), 'name: number');
    });
  });

  describe('rejects a server-controlled key', () => {
    for (const key of ['id', 'isActive', 'roomCount', 'currency', 'createdAt', 'updatedAt'] as const) {
      it(key, () => {
        assertRejected({ ...MINIMUM, [key]: 'anything' }, `server-controlled ${key}`);
      });
    }

    it('isActive: true, the one a caller is most likely to try', () => {
      assertRejected({ ...MINIMUM, isActive: true }, 'isActive: true');
    });
  });

  describe('rejects an unknown key', () => {
    for (const key of ['roomNumber', 'rooms', 'amenities', 'image', 'sort_order', 'Name'] as const) {
      it(key, () => {
        assertRejected({ ...MINIMUM, [key]: 'x' }, `unknown ${key}`);
      });
    }
  });
});

describe('ROOM_TYPE_SLUG_TAKEN_RESPONSE', () => {
  it('is exactly the locked 409 contract', () => {
    assert.deepEqual(ROOM_TYPE_SLUG_TAKEN_RESPONSE, {
      error: {
        code: 'ROOM_TYPE_SLUG_TAKEN',
        message: 'Room type reference is already in use',
      },
    });
  });

  it('is frozen, inside and out', () => {
    assert.ok(Object.isFrozen(ROOM_TYPE_SLUG_TAKEN_RESPONSE));
    assert.ok(Object.isFrozen(ROOM_TYPE_SLUG_TAKEN_RESPONSE.error));
  });

  it('does not echo the requested slug', () => {
    assert.deepEqual(Object.keys(ROOM_TYPE_SLUG_TAKEN_RESPONSE.error).sort(), ['code', 'message']);
  });
});
