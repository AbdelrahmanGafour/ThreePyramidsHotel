import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseAdminReservationListQuery,
  parseBookingReferenceParam,
} from '../src/modules/admin-reservations/admin-reservations.validation';
import {
  INVALID_BOOKING_REFERENCE_ERROR_CODE,
  INVALID_BOOKING_REFERENCE_ERROR_MESSAGE,
  INVALID_PAGINATION_ERROR_CODE,
  INVALID_PAGINATION_ERROR_MESSAGE,
  isInvalidBookingReferenceError,
  isInvalidPaginationError,
} from '../src/modules/admin-reservations/admin-reservations.types';
import { generateBookingReference } from '../src/modules/reservations/booking-reference';

// Pure: the validation module imports no database code.

const DEFAULTS = { limit: 25, offset: 0 };

function assertRejected(query: Record<string, unknown>, label: string): void {
  assert.throws(
    () => parseAdminReservationListQuery(query),
    (error: unknown) => {
      assert.ok(isInvalidPaginationError(error), `expected a pagination error for ${label}, got: ${String(error)}`);
      assert.equal(error.code, INVALID_PAGINATION_ERROR_CODE);
      // The message is part of the locked response contract, not free text.
      assert.equal(error.message, INVALID_PAGINATION_ERROR_MESSAGE);
      return true;
    },
    `expected ${label} to be rejected`,
  );
}

describe('parseAdminReservationListQuery', () => {
  describe('accepts', () => {
    it('an empty query, applying the defaults', () => {
      assert.deepEqual(parseAdminReservationListQuery({}), DEFAULTS);
    });

    it('explicitly undefined values, applying the defaults', () => {
      assert.deepEqual(parseAdminReservationListQuery({ limit: undefined, offset: undefined }), DEFAULTS);
    });

    it('one supplied value alongside one default', () => {
      assert.deepEqual(parseAdminReservationListQuery({ limit: '10' }), { limit: 10, offset: 0 });
      assert.deepEqual(parseAdminReservationListQuery({ offset: '50' }), { limit: 25, offset: 50 });
    });

    it('a valid custom limit and offset', () => {
      assert.deepEqual(parseAdminReservationListQuery({ limit: '40', offset: '80' }), {
        limit: 40,
        offset: 80,
      });
    });

    it('the smallest allowed limit', () => {
      assert.equal(parseAdminReservationListQuery({ limit: '1' }).limit, 1);
    });

    it('the largest allowed limit', () => {
      assert.equal(parseAdminReservationListQuery({ limit: '100' }).limit, 100);
    });

    it('an offset of zero', () => {
      assert.equal(parseAdminReservationListQuery({ offset: '0' }).offset, 0);
    });

    it('a large but exactly representable offset', () => {
      assert.equal(
        parseAdminReservationListQuery({ offset: String(Number.MAX_SAFE_INTEGER) }).offset,
        Number.MAX_SAFE_INTEGER,
      );
    });

    it('leading zeros, which still completely represent the number', () => {
      assert.deepEqual(parseAdminReservationListQuery({ limit: '025', offset: '007' }), {
        limit: 25,
        offset: 7,
      });
    });

    it('unrelated query parameters, ignoring them', () => {
      // Filtering and sorting are not part of this contract; their presence in
      // the URL must not change the window that comes back.
      const query: Record<string, unknown> = { limit: '5', status: 'confirmed', sort: 'guest' };

      assert.deepEqual(parseAdminReservationListQuery(query), { limit: 5, offset: 0 });
    });

    it('without mutating the supplied query', () => {
      const query = { limit: '5', offset: '5' };
      parseAdminReservationListQuery(query);
      assert.deepEqual(query, { limit: '5', offset: '5' });
    });
  });

  describe('rejects out-of-range limits', () => {
    it('a limit of zero', () => {
      assertRejected({ limit: '0' }, 'limit=0');
    });

    it('a limit above the maximum', () => {
      assertRejected({ limit: '101' }, 'limit=101');
      assertRejected({ limit: '1000' }, 'limit=1000');
    });

    // The cap is a contract, not a suggestion: asking for more must fail rather
    // than quietly return 100 rows and let the caller believe that was all.
    it('rather than clamping an oversized limit', () => {
      assert.throws(() => parseAdminReservationListQuery({ limit: '500' }));
    });
  });

  describe('rejects malformed values', () => {
    const malformed: [string, unknown][] = [
      ['an empty string', ''],
      ['whitespace only', '   '],
      ['a value with surrounding whitespace', ' 25 '],
      ['a decimal', '2.5'],
      ['a decimal ending in zero', '25.0'],
      ['a negative number', '-1'],
      ['negative zero', '-0'],
      ['an explicit plus sign', '+5'],
      ['a garbage suffix', '25abc'],
      ['a garbage prefix', 'abc25'],
      ['exponent notation', '1e3'],
      ['hexadecimal', '0x10'],
      ['a thousands separator', '1,000'],
      ['a non-numeric word', 'twenty'],
      ['null', null],
      ['a number rather than a string', 25],
      ['a boolean', true],
      ['an object', { value: '25' }],
      ['an unsafe integer', '9007199254740993'],
      ['a very long digit run', '1'.repeat(40)],
    ];

    for (const [label, value] of malformed) {
      it(`${label} as a limit`, () => {
        assertRejected({ limit: value }, `limit=${label}`);
      });

      it(`${label} as an offset`, () => {
        assertRejected({ offset: value }, `offset=${label}`);
      });
    }
  });

  describe('rejects repeated parameters', () => {
    // Express turns `?limit=1&limit=2` into an array. Choosing one of two
    // conflicting values would silently answer a question the caller did not ask.
    it('a repeated limit', () => {
      assertRejected({ limit: ['1', '2'] }, 'repeated limit');
    });

    it('a repeated offset', () => {
      assertRejected({ offset: ['0', '10'] }, 'repeated offset');
    });

    it('a repeated parameter even when both values are identical', () => {
      assertRejected({ limit: ['25', '25'] }, 'repeated identical limit');
    });

    it('a single-element array', () => {
      assertRejected({ limit: ['25'] }, 'single-element array limit');
    });
  });

  it('rejects the whole query when either value is unusable', () => {
    assertRejected({ limit: '25', offset: '-5' }, 'valid limit with invalid offset');
    assertRejected({ limit: '0', offset: '10' }, 'invalid limit with valid offset');
  });
});

describe('parseBookingReferenceParam', () => {
  const VALID = 'TPH-A2B3C4D5E6F7';

  function assertRejectedReference(value: unknown, label: string): void {
    assert.throws(
      () => parseBookingReferenceParam(value),
      (error: unknown) => {
        assert.ok(
          isInvalidBookingReferenceError(error),
          `expected a booking reference error for ${label}, got: ${String(error)}`,
        );
        assert.equal(error.code, INVALID_BOOKING_REFERENCE_ERROR_CODE);
        // The message is part of the locked response contract, not free text.
        assert.equal(error.message, INVALID_BOOKING_REFERENCE_ERROR_MESSAGE);
        return true;
      },
      `expected ${label} to be rejected`,
    );
  }

  it('returns a canonical reference unchanged', () => {
    assert.equal(parseBookingReferenceParam(VALID), VALID);
  });

  it('accepts a freshly generated reference', () => {
    const generated = generateBookingReference();

    assert.equal(parseBookingReferenceParam(generated), generated);
  });

  it('rejects a lowercase reference rather than normalising it', () => {
    assertRejectedReference(VALID.toLowerCase(), 'lowercase');
  });

  it('rejects padded input rather than trimming it', () => {
    assertRejectedReference(` ${VALID}`, 'leading whitespace');
    assertRejectedReference(`${VALID} `, 'trailing whitespace');
  });

  it('rejects malformed references', () => {
    const invalid: [string, string][] = [
      ['wrong prefix', 'ABC-A2B3C4D5E6F7'],
      ['no prefix', 'A2B3C4D5E6F7'],
      ['too short', 'TPH-A2B3C4D5E6F'],
      ['too long', 'TPH-A2B3C4D5E6F7G'],
      ['contains 0', 'TPH-A2B3C4D5E6F0'],
      ['contains O', 'TPH-A2B3C4D5E6FO'],
      ['contains 1', 'TPH-A2B3C4D5E6F1'],
      ['contains I', 'TPH-A2B3C4D5E6FI'],
      ['empty', ''],
      ['injection shaped', "TPH-A2B3C4D5E6F7' OR '1'='1"],
      ['wildcard', 'TPH-A2B3C4D5E6%'],
    ];

    for (const [label, value] of invalid) {
      assertRejectedReference(value, label);
    }
  });

  it('rejects a value that is not a string', () => {
    // Express gives a string, but a repeated or missing parameter must not slip
    // through as something the SQL layer then has to cope with.
    for (const value of [undefined, null, 42, {}, [VALID]]) {
      assertRejectedReference(value, String(value));
    }
  });
});
