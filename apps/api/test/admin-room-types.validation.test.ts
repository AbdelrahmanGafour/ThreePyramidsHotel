import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INVALID_ROOM_TYPE_SLUG_ERROR_CODE,
  INVALID_ROOM_TYPE_SLUG_ERROR_MESSAGE,
  INVALID_ROOM_TYPE_UPDATE_ERROR_CODE,
  INVALID_ROOM_TYPE_UPDATE_ERROR_MESSAGE,
  ROOM_TYPE_NOT_FOUND_RESPONSE,
  isInvalidRoomTypeSlugError,
  isInvalidRoomTypeUpdateError,
} from '../src/modules/admin-room-types/admin-room-types.types';
import { PG_INT4_MAX } from '../src/modules/admin-room-types/admin-room-types.fields';
import {
  parseAdminRoomTypeUpdate,
  parseRoomTypeSlugParam,
} from '../src/modules/admin-room-types/admin-room-types.validation';

// Pure: the validation module imports no database code.

function assertRejectedSlug(value: unknown, label: string): void {
  assert.throws(
    () => parseRoomTypeSlugParam(value),
    (error: unknown) => {
      assert.ok(isInvalidRoomTypeSlugError(error), `expected a slug error for ${label}, got: ${String(error)}`);
      assert.equal(error.code, INVALID_ROOM_TYPE_SLUG_ERROR_CODE);
      // The message is part of the locked response contract, not free text.
      assert.equal(error.message, INVALID_ROOM_TYPE_SLUG_ERROR_MESSAGE);
      return true;
    },
    `expected ${label} to be rejected`,
  );
}

function assertRejectedUpdate(body: unknown, label: string): void {
  assert.throws(
    () => parseAdminRoomTypeUpdate(body),
    (error: unknown) => {
      assert.ok(isInvalidRoomTypeUpdateError(error), `expected an update error for ${label}, got: ${String(error)}`);
      assert.equal(error.code, INVALID_ROOM_TYPE_UPDATE_ERROR_CODE);
      assert.equal(error.message, INVALID_ROOM_TYPE_UPDATE_ERROR_MESSAGE);
      // Naming the offending field would map the model for a caller. Matched
      // on word boundaries: a bare "id" would otherwise hit "Invalid".
      assert.ok(
        !/\b(slug|capacity|isActive|currency|createdAt|updatedAt|roomCount)\b/i.test(error.message),
        'the message must not name the offending field',
      );
      return true;
    },
    `expected ${label} to be rejected`,
  );
}

describe('parseRoomTypeSlugParam', () => {
  describe('accepts the slugs this system actually uses', () => {
    for (const slug of ['demo-standard', 'demo-deluxe', 'demo-suite', 'room-concept-01', 'suite', 'a', '2b']) {
      it(slug, () => {
        assert.equal(parseRoomTypeSlugParam(slug), slug);
      });
    }

    it('a slug at the maximum length', () => {
      const slug = 'a'.repeat(120);

      assert.equal(parseRoomTypeSlugParam(slug), slug);
    });
  });

  describe('rejects', () => {
    it('uppercase rather than lowercasing it', () => {
      // Matched case-sensitively in SQL, so a value needing repair is not the
      // value the database holds.
      assertRejectedSlug('Demo-Standard', 'title case');
      assertRejectedSlug('DEMO-STANDARD', 'upper case');
      assertRejectedSlug('demo-Standard', 'mixed case');
    });

    it('padding rather than trimming it', () => {
      assertRejectedSlug(' demo-standard', 'leading space');
      assertRejectedSlug('demo-standard ', 'trailing space');
      assertRejectedSlug(' demo-standard ', 'both');
      assertRejectedSlug('demo standard', 'internal space');
      assertRejectedSlug('demo-standard\n', 'trailing newline');
    });

    const malformed: [string, unknown][] = [
      ['an empty string', ''],
      ['a leading hyphen', '-demo'],
      ['a trailing hyphen', 'demo-'],
      ['a doubled hyphen', 'demo--standard'],
      ['only a hyphen', '-'],
      ['an underscore', 'demo_standard'],
      ['a dot', 'demo.standard'],
      ['a slash', 'demo/standard'],
      ['path traversal', '../admin'],
      ['an encoded slash', 'demo%2Fstandard'],
      ['a SQL fragment', "demo' OR '1'='1"],
      ['a wildcard', 'demo%'],
      ['an HTML fragment', '<script>alert(1)</script>'],
      ['an accented letter', 'démo'],
      ['over the maximum length', `${'a'.repeat(121)}`],
      ['null', null],
      ['undefined', undefined],
      ['a number', 42],
      ['an array', ['demo-standard']],
      ['an object', { slug: 'demo-standard' }],
    ];

    for (const [label, value] of malformed) {
      it(label, () => {
        assertRejectedSlug(value, label);
      });
    }
  });
});

describe('parseAdminRoomTypeUpdate', () => {
  describe('accepts a single editable field', () => {
    it('name, trimmed', () => {
      assert.deepEqual(parseAdminRoomTypeUpdate({ name: '  Plateau Suite  ' }), { name: 'Plateau Suite' });
    });

    it('baseNightlyRate as an exact decimal string', () => {
      assert.deepEqual(parseAdminRoomTypeUpdate({ baseNightlyRate: '1500.00' }), {
        baseNightlyRate: '1500.00',
      });
    });

    it('sortOrder', () => {
      assert.deepEqual(parseAdminRoomTypeUpdate({ sortOrder: 0 }), { sortOrder: 0 });
    });

    it('sizeSqm', () => {
      assert.deepEqual(parseAdminRoomTypeUpdate({ sizeSqm: '42.50' }), { sizeSqm: '42.50' });
    });

    it('bedCount', () => {
      assert.deepEqual(parseAdminRoomTypeUpdate({ bedCount: 2 }), { bedCount: 2 });
    });
  });

  it('accepts every editable field at once, and returns only those keys', () => {
    const update = parseAdminRoomTypeUpdate({
      name: 'Plateau Suite',
      shortDescription: 'An upper-floor suite.',
      description: 'A longer passage.',
      bedType: 'King bed',
      bedCount: 1,
      sizeSqm: '42.00',
      view: 'Terrace & plateau view',
      baseNightlyRate: '1500.00',
      sortOrder: 2,
    });

    assert.deepEqual(update, {
      name: 'Plateau Suite',
      shortDescription: 'An upper-floor suite.',
      description: 'A longer passage.',
      bedType: 'King bed',
      bedCount: 1,
      sizeSqm: '42.00',
      view: 'Terrace & plateau view',
      baseNightlyRate: '1500.00',
      sortOrder: 2,
    });
    assert.deepEqual(Object.keys(update).sort(), [
      'baseNightlyRate',
      'bedCount',
      'bedType',
      'description',
      'name',
      'shortDescription',
      'sizeSqm',
      'sortOrder',
      'view',
    ]);
  });

  it('returns only the fields that were supplied', () => {
    const update = parseAdminRoomTypeUpdate({ name: 'Plateau Suite', sortOrder: 3 });

    assert.deepEqual(Object.keys(update).sort(), ['name', 'sortOrder']);
    assert.ok(!('baseNightlyRate' in update), 'an unmentioned field must not appear');
  });

  it('does not mutate the body it was given', () => {
    const body = { name: '  Plateau Suite  ' };
    parseAdminRoomTypeUpdate(body);

    assert.deepEqual(body, { name: '  Plateau Suite  ' });
  });

  describe('nullable fields', () => {
    it('accept an explicit null', () => {
      assert.deepEqual(
        parseAdminRoomTypeUpdate({
          shortDescription: null,
          description: null,
          bedType: null,
          bedCount: null,
          sizeSqm: null,
          view: null,
        }),
        {
          shortDescription: null,
          description: null,
          bedType: null,
          bedCount: null,
          sizeSqm: null,
          view: null,
        },
      );
    });

    it('treat an empty or whitespace-only string as null', () => {
      // "" and "absent" mean the same thing for a description; storing both
      // would leave the public API returning two values for one state.
      assert.deepEqual(parseAdminRoomTypeUpdate({ shortDescription: '' }), { shortDescription: null });
      assert.deepEqual(parseAdminRoomTypeUpdate({ description: '   ' }), { description: null });
      assert.deepEqual(parseAdminRoomTypeUpdate({ view: '\t\n' }), { view: null });
    });

    it('trim a supplied value', () => {
      assert.deepEqual(parseAdminRoomTypeUpdate({ bedType: '  King bed  ' }), { bedType: 'King bed' });
    });
  });

  describe('rejects a body that is not a usable object', () => {
    const bodies: [string, unknown][] = [
      ['an empty object', {}],
      ['null', null],
      ['undefined', undefined],
      ['a string', 'name'],
      ['a number', 42],
      ['a boolean', true],
      ['an array', ['name']],
      ['an empty array', []],
      ['a Date', new Date()],
      ['a Map', new Map([['name', 'x']])],
    ];

    for (const [label, body] of bodies) {
      it(label, () => {
        assertRejectedUpdate(body, label);
      });
    }
  });

  describe('rejects read-only and server-controlled fields', () => {
    // Rejected, never silently dropped: a caller who believed they were
    // changing the slug must be told they were not.
    const forbidden: [string, Record<string, unknown>][] = [
      ['slug', { slug: 'new-slug' }],
      ['slug alongside a valid field', { name: 'Plateau Suite', slug: 'new-slug' }],
      ['id', { id: 7 }],
      ['capacity', { capacity: 4 }],
      ['capacity alongside a valid field', { name: 'Plateau Suite', capacity: 4 }],
      ['isActive', { isActive: false }],
      ['currency', { currency: 'USD' }],
      ['createdAt', { createdAt: '2026-01-01T00:00:00.000Z' }],
      ['updatedAt', { updatedAt: '2026-01-01T00:00:00.000Z' }],
      ['roomCount', { roomCount: 5 }],
    ];

    for (const [label, body] of forbidden) {
      it(label, () => {
        assertRejectedUpdate(body, label);
      });
    }
  });

  describe('rejects unknown keys', () => {
    for (const body of [{ nickname: 'x' }, { name: 'Valid', nickname: 'x' }, { Name: 'Valid' }, { ' name': 'x' }]) {
      it(JSON.stringify(body), () => {
        assertRejectedUpdate(body, JSON.stringify(body));
      });
    }
  });

  describe('name', () => {
    it('rejects an empty or whitespace-only value', () => {
      assertRejectedUpdate({ name: '' }, 'empty name');
      assertRejectedUpdate({ name: '   ' }, 'whitespace name');
    });

    it('rejects a non-string', () => {
      for (const name of [null, 42, true, {}, ['x']]) {
        assertRejectedUpdate({ name }, `name ${JSON.stringify(name)}`);
      }
    });

    it('accepts the maximum length and rejects one more', () => {
      assert.equal(parseAdminRoomTypeUpdate({ name: 'a'.repeat(120) }).name, 'a'.repeat(120));
      assertRejectedUpdate({ name: 'a'.repeat(121) }, 'name over 120');
    });
  });

  describe('bedCount', () => {
    it('accepts the lowest allowed value', () => {
      assert.equal(parseAdminRoomTypeUpdate({ bedCount: 1 }).bedCount, 1);
    });

    it('rejects zero and negatives, matching the column CHECK', () => {
      assertRejectedUpdate({ bedCount: 0 }, 'bedCount 0');
      assertRejectedUpdate({ bedCount: -1 }, 'bedCount -1');
    });

    it('rejects a fraction, a string and an unsafe integer', () => {
      assertRejectedUpdate({ bedCount: 1.5 }, 'fractional bedCount');
      assertRejectedUpdate({ bedCount: '2' }, 'string bedCount');
      assertRejectedUpdate({ bedCount: Number.MAX_SAFE_INTEGER + 2 }, 'unsafe bedCount');
      assertRejectedUpdate({ bedCount: Number.NaN }, 'NaN bedCount');
      assertRejectedUpdate({ bedCount: Number.POSITIVE_INFINITY }, 'infinite bedCount');
    });

    it('accepts the integer column maximum and rejects one past it', () => {
      // bed_count is an int4 column, so this is the real ceiling.
      assert.equal(parseAdminRoomTypeUpdate({ bedCount: PG_INT4_MAX }).bedCount, PG_INT4_MAX);
      assertRejectedUpdate({ bedCount: PG_INT4_MAX + 1 }, 'bedCount past int4');
    });

    it('still accepts an explicit null', () => {
      assert.equal(parseAdminRoomTypeUpdate({ bedCount: null }).bedCount, null);
    });
  });

  describe('sortOrder', () => {
    it('accepts zero', () => {
      assert.equal(parseAdminRoomTypeUpdate({ sortOrder: 0 }).sortOrder, 0);
    });

    it('rejects a negative, matching the column CHECK', () => {
      assertRejectedUpdate({ sortOrder: -1 }, 'sortOrder -1');
    });

    it('rejects a fraction, a string and an unsafe integer', () => {
      assertRejectedUpdate({ sortOrder: 1.5 }, 'fractional sortOrder');
      assertRejectedUpdate({ sortOrder: '1' }, 'string sortOrder');
      assertRejectedUpdate({ sortOrder: Number.MAX_SAFE_INTEGER + 2 }, 'unsafe sortOrder');
    });

    it('accepts the integer column maximum and rejects one past it', () => {
      // sort_order is an int4 column, so this is the real ceiling.
      assert.equal(parseAdminRoomTypeUpdate({ sortOrder: PG_INT4_MAX }).sortOrder, PG_INT4_MAX);
      assertRejectedUpdate({ sortOrder: PG_INT4_MAX + 1 }, 'sortOrder past int4');
    });
  });

  describe('baseNightlyRate', () => {
    it('accepts exact decimal strings within numeric(12,2)', () => {
      for (const rate of ['0', '0.00', '1500', '1500.5', '1500.55', '9999999999.99']) {
        assert.equal(parseAdminRoomTypeUpdate({ baseNightlyRate: rate }).baseNightlyRate, rate);
      }
    });

    it('returns the string exactly as given, never reformatted', () => {
      // Whether the operator typed "1500" or "1500.00" is preserved; only
      // PostgreSQL decides the stored scale.
      assert.equal(parseAdminRoomTypeUpdate({ baseNightlyRate: '1500' }).baseNightlyRate, '1500');
    });

    it('rejects a number, even an exact-looking one', () => {
      // A JavaScript number has already been through a float by the time it
      // arrives; accepting it would defeat the point of a numeric column.
      assertRejectedUpdate({ baseNightlyRate: 1500 }, 'numeric rate');
      assertRejectedUpdate({ baseNightlyRate: 1500.55 }, 'fractional numeric rate');
    });

    it('rejects more than two decimal places', () => {
      assertRejectedUpdate({ baseNightlyRate: '1500.555' }, 'three decimals');
    });

    it('rejects more than ten integer digits', () => {
      assertRejectedUpdate({ baseNightlyRate: '12345678901' }, 'eleven integer digits');
      assertRejectedUpdate({ baseNightlyRate: '12345678901.00' }, 'eleven integer digits with decimals');
    });

    it('rejects signs, exponents and malformed decimals', () => {
      const malformed = [
        '-1',
        '-0.01',
        '+1500',
        '1e3',
        '1E3',
        '1.5e2',
        'Infinity',
        'NaN',
        '.5',
        '1.',
        '1..5',
        '1,500',
        '0x10',
        '',
      ];

      for (const rate of malformed) {
        assertRejectedUpdate({ baseNightlyRate: rate }, `rate ${JSON.stringify(rate)}`);
      }
    });

    it('rejects whitespace padding rather than trimming it', () => {
      assertRejectedUpdate({ baseNightlyRate: ' 1500.00' }, 'leading space');
      assertRejectedUpdate({ baseNightlyRate: '1500.00 ' }, 'trailing space');
    });

    it('rejects null, since a room type must always have a rate', () => {
      assertRejectedUpdate({ baseNightlyRate: null }, 'null rate');
    });
  });

  describe('sizeSqm', () => {
    it('accepts exact decimal strings within numeric(6,2)', () => {
      for (const size of ['1', '0.01', '42.5', '42.50', '9999.99']) {
        assert.equal(parseAdminRoomTypeUpdate({ sizeSqm: size }).sizeSqm, size);
      }
    });

    it('rejects zero, matching the column CHECK that it be positive', () => {
      assertRejectedUpdate({ sizeSqm: '0' }, 'zero size');
      assertRejectedUpdate({ sizeSqm: '0.0' }, 'zero size with a decimal');
      assertRejectedUpdate({ sizeSqm: '0.00' }, 'zero size with two decimals');
    });

    it('rejects more than four integer digits or two decimals', () => {
      assertRejectedUpdate({ sizeSqm: '10000' }, 'five integer digits');
      assertRejectedUpdate({ sizeSqm: '42.555' }, 'three decimals');
    });

    it('rejects a number, a sign, an exponent and padding', () => {
      assertRejectedUpdate({ sizeSqm: 42 }, 'numeric size');
      assertRejectedUpdate({ sizeSqm: '-42' }, 'negative size');
      assertRejectedUpdate({ sizeSqm: '4.2e1' }, 'exponent size');
      assertRejectedUpdate({ sizeSqm: ' 42.00' }, 'padded size');
    });
  });

  describe('text maxima', () => {
    it('accept the boundary and reject one more', () => {
      const cases: [keyof typeof limits, number][] = [
        ['shortDescription', 300],
        ['description', 2000],
        ['bedType', 60],
        ['view', 120],
      ];
      const limits = { shortDescription: 0, description: 0, bedType: 0, view: 0 };

      for (const [field, max] of cases) {
        const atLimit = parseAdminRoomTypeUpdate({ [field]: 'a'.repeat(max) });

        assert.equal(atLimit[field as 'view'], 'a'.repeat(max), `${field} should accept ${max}`);
        assertRejectedUpdate({ [field]: 'a'.repeat(max + 1) }, `${field} over ${max}`);
      }
    });

    it('measure the trimmed value, not the padding', () => {
      assert.equal(parseAdminRoomTypeUpdate({ view: `  ${'a'.repeat(120)}  ` }).view, 'a'.repeat(120));
    });
  });
});

describe('ROOM_TYPE_NOT_FOUND_RESPONSE', () => {
  it('is the locked 404 body', () => {
    assert.deepEqual(ROOM_TYPE_NOT_FOUND_RESPONSE, {
      error: { code: 'ROOM_TYPE_NOT_FOUND', message: 'Room type not found' },
    });
  });

  it('is frozen, so a handler cannot alter the contract it sends', () => {
    assert.ok(Object.isFrozen(ROOM_TYPE_NOT_FOUND_RESPONSE));
    assert.ok(Object.isFrozen(ROOM_TYPE_NOT_FOUND_RESPONSE.error));
  });
});
