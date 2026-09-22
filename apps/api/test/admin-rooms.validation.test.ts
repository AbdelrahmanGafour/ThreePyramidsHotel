import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INVALID_ROOM_CREATE_ERROR_CODE,
  INVALID_ROOM_CREATE_ERROR_MESSAGE,
  INVALID_ROOM_NUMBER_ERROR_CODE,
  INVALID_ROOM_NUMBER_ERROR_MESSAGE,
  INVALID_ROOM_UPDATE_ERROR_CODE,
  INVALID_ROOM_UPDATE_ERROR_MESSAGE,
  ROOM_HAS_FUTURE_RESERVATIONS_RESPONSE,
  ROOM_NOT_FOUND_RESPONSE,
  ROOM_NUMBER_TAKEN_RESPONSE,
  isInvalidRoomCreateError,
  isInvalidRoomNumberError,
  isInvalidRoomUpdateError,
} from '../src/modules/admin-rooms/admin-rooms.types';
import {
  parseAdminPhysicalRoomCreate,
  parseAdminPhysicalRoomUpdate,
  parseRoomNumberInput,
  parseRoomNumberParam,
} from '../src/modules/admin-rooms/admin-rooms.validation';

// Pure: the validation module imports no database code. Uniqueness — exact and
// case-insensitive alike — is PostgreSQL's, through rooms_room_number_key and
// rooms_room_number_lower_key. Nothing here checks it or could.

const FORBIDDEN_DELIMITERS = ['/', '\\', '?', '#', '%'] as const;

function assertRejectedNumber(parse: (value: unknown) => string, value: unknown, label: string): void {
  assert.throws(
    () => parse(value),
    (error: unknown) => {
      assert.ok(isInvalidRoomNumberError(error), `expected a room number error for ${label}, got: ${String(error)}`);
      assert.equal(error.code, INVALID_ROOM_NUMBER_ERROR_CODE);
      assert.equal(error.message, INVALID_ROOM_NUMBER_ERROR_MESSAGE);
      return true;
    },
    `expected ${label} to be rejected`,
  );
}

function assertRejectedCreate(body: unknown, label: string): void {
  assert.throws(
    () => parseAdminPhysicalRoomCreate(body),
    (error: unknown) => {
      assert.ok(isInvalidRoomCreateError(error), `expected a create error for ${label}, got: ${String(error)}`);
      assert.equal(error.code, INVALID_ROOM_CREATE_ERROR_CODE);
      assert.equal(error.message, INVALID_ROOM_CREATE_ERROR_MESSAGE);
      // Never the route identifier's contract: a body is not an identifier.
      assert.ok(!isInvalidRoomNumberError(error), 'a create body must not answer INVALID_ROOM_NUMBER');
      return true;
    },
    `expected ${label} to be rejected`,
  );
}

function assertRejectedUpdate(body: unknown, label: string): void {
  assert.throws(
    () => parseAdminPhysicalRoomUpdate(body),
    (error: unknown) => {
      assert.ok(isInvalidRoomUpdateError(error), `expected an update error for ${label}, got: ${String(error)}`);
      assert.equal(error.code, INVALID_ROOM_UPDATE_ERROR_CODE);
      assert.equal(error.message, INVALID_ROOM_UPDATE_ERROR_MESSAGE);
      return true;
    },
    `expected ${label} to be rejected`,
  );
}

describe('parseRoomNumberInput — a room number on its way to storage', () => {
  describe('accepts', () => {
    for (const value of ['D-101', '101', 'A', 'Suite 4', 'G.12', 'PH-1', 'annexe 2b', '1-A(north)']) {
      it(JSON.stringify(value), () => {
        assert.equal(parseRoomNumberInput(value), value);
      });
    }

    it('preserving case exactly', () => {
      assert.equal(parseRoomNumberInput('D-101'), 'D-101');
      assert.equal(parseRoomNumberInput('d-101'), 'd-101');
      assert.equal(parseRoomNumberInput('Ph-Suite'), 'Ph-Suite');
    });

    it('internal spaces', () => {
      assert.equal(parseRoomNumberInput('Garden Suite 2'), 'Garden Suite 2');
    });

    it('trimming leading and trailing whitespace', () => {
      assert.equal(parseRoomNumberInput('  D-101  '), 'D-101');
      assert.equal(parseRoomNumberInput('\tD-101\n'), 'D-101');
      assert.equal(parseRoomNumberInput('D-101 '), 'D-101');
    });

    it('a value that is exactly 20 characters after trimming', () => {
      const twenty = 'A'.repeat(20);
      assert.equal(parseRoomNumberInput(`  ${twenty}  `), twenty);
      assert.equal(parseRoomNumberInput(twenty).length, 20);
    });

    it('non-ASCII text, since a room number is whatever the hotel calls it', () => {
      assert.equal(parseRoomNumberInput('Suite Été'), 'Suite Été');
    });
  });

  describe('rejects', () => {
    it('a value that is empty or only whitespace', () => {
      for (const value of ['', '   ', '\t', '\n', '  \t\n  ']) {
        assertRejectedNumber(parseRoomNumberInput, value, `empty: ${JSON.stringify(value)}`);
      }
    });

    it('21 characters after trimming', () => {
      assertRejectedNumber(parseRoomNumberInput, 'A'.repeat(21), '21 characters');
      assertRejectedNumber(parseRoomNumberInput, `  ${'A'.repeat(21)}  `, '21 characters padded');
    });

    for (const delimiter of FORBIDDEN_DELIMITERS) {
      it(`the delimiter ${JSON.stringify(delimiter)}`, () => {
        assertRejectedNumber(parseRoomNumberInput, `D-1${delimiter}01`, `internal ${delimiter}`);
        assertRejectedNumber(parseRoomNumberInput, `${delimiter}D-101`, `leading ${delimiter}`);
        assertRejectedNumber(parseRoomNumberInput, `D-101${delimiter}`, `trailing ${delimiter}`);
      });
    }

    it('a C0 control character', () => {
      for (const code of [0x00, 0x01, 0x08, 0x0b, 0x1f]) {
        const value = `D-1${String.fromCharCode(code)}01`;
        assertRejectedNumber(parseRoomNumberInput, value, `C0 U+${code.toString(16)}`);
      }
    });

    it('an internal tab or newline, which are C0 even though they look like spacing', () => {
      assertRejectedNumber(parseRoomNumberInput, 'D\t101', 'internal tab');
      assertRejectedNumber(parseRoomNumberInput, 'D\n101', 'internal newline');
    });

    it('DEL and the C1 range', () => {
      for (const code of [0x7f, 0x80, 0x90, 0x9f]) {
        const value = `D-1${String.fromCharCode(code)}01`;
        assertRejectedNumber(parseRoomNumberInput, value, `C1 U+${code.toString(16)}`);
      }
    });

    for (const [label, value] of [
      ['null', null],
      ['undefined', undefined],
      ['a number', 101],
      ['a boolean', true],
      ['an array', ['D-101']],
      ['an object', { roomNumber: 'D-101' }],
      ['a Date', new Date()],
    ] as const) {
      it(`a non-string: ${label}`, () => {
        assertRejectedNumber(parseRoomNumberInput, value, label);
      });
    }
  });
});

describe('parseRoomNumberParam — a room number identifying a stored room', () => {
  describe('accepts', () => {
    for (const value of ['D-101', 'd-101', '101', 'Suite 4', 'A'.repeat(20)]) {
      it(JSON.stringify(value), () => {
        assert.equal(parseRoomNumberParam(value), value);
      });
    }

    it('preserving case exactly, so the two are different identifiers', () => {
      assert.equal(parseRoomNumberParam('D-101'), 'D-101');
      assert.equal(parseRoomNumberParam('d-101'), 'd-101');
    });
  });

  describe('rejects padding rather than trimming it', () => {
    // The distinction that matters: a body is input on its way to storage, a
    // URL names something that already exists. " D-101 " is not the name of
    // anything, and trimming here would let two URLs address one room.
    for (const value of [' D-101', 'D-101 ', '  D-101  ', '\tD-101', 'D-101\n']) {
      it(JSON.stringify(value), () => {
        assertRejectedNumber(parseRoomNumberParam, value, `padded: ${JSON.stringify(value)}`);
      });
    }

    it('where the body validator would have accepted the same value', () => {
      assert.equal(parseRoomNumberInput(' D-101 '), 'D-101');
      assertRejectedNumber(parseRoomNumberParam, ' D-101 ', 'padded param');
    });
  });

  describe('rejects', () => {
    it('empty and whitespace-only', () => {
      assertRejectedNumber(parseRoomNumberParam, '', 'empty');
      assertRejectedNumber(parseRoomNumberParam, '   ', 'whitespace only');
    });

    it('over the maximum length', () => {
      assertRejectedNumber(parseRoomNumberParam, 'A'.repeat(21), '21 characters');
    });

    for (const delimiter of FORBIDDEN_DELIMITERS) {
      it(`the delimiter ${JSON.stringify(delimiter)}, as a decoded percent-escape would arrive`, () => {
        assertRejectedNumber(parseRoomNumberParam, `D-1${delimiter}01`, `param ${delimiter}`);
      });
    }

    it('control characters', () => {
      assertRejectedNumber(parseRoomNumberParam, 'D-1\u000001', 'C0');
      assertRejectedNumber(parseRoomNumberParam, 'D-1\u007f01', 'DEL');
      assertRejectedNumber(parseRoomNumberParam, 'D-1\u009f01', 'C1');
    });

    it('a non-string', () => {
      assertRejectedNumber(parseRoomNumberParam, 101, 'a number');
      assertRejectedNumber(parseRoomNumberParam, undefined, 'undefined');
    });
  });
});

describe('parseAdminPhysicalRoomCreate', () => {
  it('accepts a room number and returns it trimmed', () => {
    assert.deepEqual(parseAdminPhysicalRoomCreate({ roomNumber: '  D-101  ' }), { roomNumber: 'D-101' });
  });

  it('carries no room type — that comes from the route, not the body', () => {
    const created = parseAdminPhysicalRoomCreate({ roomNumber: 'D-101' });
    assert.deepEqual(Object.keys(created), ['roomNumber']);
  });

  // Every rejection is the body's own contract, never the route identifier's.
  describe('rejects with INVALID_ROOM_CREATE', () => {
    for (const [label, body] of [
      ['a non-object: null', null],
      ['a non-object: undefined', undefined],
      ['a non-object: an array', [{ roomNumber: 'D-101' }]],
      ['a non-object: a bare string', 'D-101'],
      ['a non-object: a number', 101],
      ['a non-object: a boolean', true],
      ['a non-object: a Date', new Date()],
      ['a non-object: a Map', new Map()],
      ['an empty object', {}],
      ['a missing roomNumber', { room: 'D-101' }],
    ] as const) {
      it(label, () => {
        assertRejectedCreate(body, label);
      });
    }

    it('an unknown key alongside the room number', () => {
      assertRejectedCreate({ roomNumber: 'D-101', isActive: true }, 'roomNumber + isActive');
      assertRejectedCreate({ roomNumber: 'D-101', floor: 1 }, 'roomNumber + floor');
    });

    it('a server-controlled key', () => {
      for (const key of ['id', 'roomTypeId', 'createdAt', 'updatedAt']) {
        assertRejectedCreate({ roomNumber: 'D-101', [key]: 'x' }, `roomNumber + ${key}`);
      }
    });

    it('a malformed roomNumber value', () => {
      for (const [label, roomNumber] of [
        ['a slash', 'D/101'],
        ['a backslash', 'D\\101'],
        ['a question mark', 'D?101'],
        ['a hash', 'D#101'],
        ['a percent', 'D%101'],
        ['blank', '   '],
        ['empty', ''],
        ['21 characters', 'A'.repeat(21)],
        ['a control character', 'D\u0001101'],
        ['DEL', 'D\u007f101'],
        ['a number', 101],
        ['null', null],
      ] as const) {
        assertRejectedCreate({ roomNumber }, `roomNumber: ${label}`);
      }
    });
  });
});

describe('the three-way error ownership is exact', () => {
  // The same malformed value, in each of the three positions a room number can
  // occupy. Each answers for the part of the request it belongs to.
  const malformed = 'D/101';

  it('a route identifier answers INVALID_ROOM_NUMBER', () => {
    assertRejectedNumber(parseRoomNumberParam, malformed, 'route identifier');
  });

  it('a POST create body answers INVALID_ROOM_CREATE', () => {
    assertRejectedCreate({ roomNumber: malformed }, 'create body');
  });

  it('a PATCH update body answers INVALID_ROOM_UPDATE', () => {
    assertRejectedUpdate({ roomNumber: malformed }, 'update body');
  });

  it('the three codes are distinct', () => {
    assert.deepEqual(
      [INVALID_ROOM_NUMBER_ERROR_CODE, INVALID_ROOM_CREATE_ERROR_CODE, INVALID_ROOM_UPDATE_ERROR_CODE].sort(),
      ['INVALID_ROOM_CREATE', 'INVALID_ROOM_NUMBER', 'INVALID_ROOM_UPDATE'],
    );
  });
});

describe('INVALID_ROOM_CREATE is exactly the locked 400 body', () => {
  it('serialises to the contracted body', () => {
    // 400s in this codebase are thrown errors a controller maps onto
    // { error: { code, message } }; only 404 and 409 carry frozen constants.
    // This asserts the exact body that mapping produces.
    const error = (() => {
      try {
        parseAdminPhysicalRoomCreate({});
        return null;
      } catch (thrown) {
        return thrown as { code: string; message: string };
      }
    })();

    assert.ok(error);
    assert.deepEqual(
      { error: { code: error.code, message: error.message } },
      { error: { code: 'INVALID_ROOM_CREATE', message: 'Invalid room creation request' } },
    );
  });

  it('exposes the code and message as locked constants', () => {
    assert.equal(INVALID_ROOM_CREATE_ERROR_CODE, 'INVALID_ROOM_CREATE');
    assert.equal(INVALID_ROOM_CREATE_ERROR_MESSAGE, 'Invalid room creation request');
  });

  it('names no field, so the message maps nothing of the model', () => {
    assert.ok(
      !/\b(roomNumber|roomTypeId|isActive|id|createdAt|updatedAt)\b/i.test(INVALID_ROOM_CREATE_ERROR_MESSAGE),
      'the message must not name the offending field',
    );
  });
});

describe('parseAdminPhysicalRoomUpdate', () => {
  describe('accepts', () => {
    it('roomNumber only, trimmed and case-preserved', () => {
      assert.deepEqual(parseAdminPhysicalRoomUpdate({ roomNumber: '  D-101  ' }), { roomNumber: 'D-101' });
      assert.deepEqual(parseAdminPhysicalRoomUpdate({ roomNumber: 'd-101' }), { roomNumber: 'd-101' });
    });

    it('isActive only, either way', () => {
      assert.deepEqual(parseAdminPhysicalRoomUpdate({ isActive: true }), { isActive: true });
      assert.deepEqual(parseAdminPhysicalRoomUpdate({ isActive: false }), { isActive: false });
    });

    it('both together', () => {
      assert.deepEqual(parseAdminPhysicalRoomUpdate({ roomNumber: 'D-102', isActive: false }), {
        roomNumber: 'D-102',
        isActive: false,
      });
    });

    it('returning only the keys it accepted', () => {
      assert.deepEqual(Object.keys(parseAdminPhysicalRoomUpdate({ isActive: true })), ['isActive']);
      assert.deepEqual(Object.keys(parseAdminPhysicalRoomUpdate({ roomNumber: 'D-1' })), ['roomNumber']);
      assert.deepEqual(
        Object.keys(parseAdminPhysicalRoomUpdate({ isActive: true, roomNumber: 'D-1' })).sort(),
        ['isActive', 'roomNumber'],
      );
    });

    it('a null-prototype object, which JSON.parse can produce', () => {
      const body = Object.assign(Object.create(null), { isActive: false });
      assert.deepEqual(parseAdminPhysicalRoomUpdate(body), { isActive: false });
    });

    it('without mutating the caller body', () => {
      const body = { roomNumber: '  D-101  ' };
      parseAdminPhysicalRoomUpdate(body);
      assert.deepEqual(body, { roomNumber: '  D-101  ' });
    });
  });

  describe('rejects a body that changes nothing', () => {
    for (const [label, body] of [
      ['an empty object', {}],
      ['null', null],
      ['undefined', undefined],
      ['an array', [{ isActive: true }]],
      ['a string', 'true'],
      ['a number', 1],
      ['a boolean', true],
      ['a Date', new Date()],
      ['a Map', new Map()],
    ] as const) {
      it(label, () => {
        assertRejectedUpdate(body, label);
      });
    }
  });

  describe('rejects an unknown or server-controlled key', () => {
    for (const key of ['id', 'roomTypeId', 'roomType', 'createdAt', 'updatedAt', 'slug', 'status', 'RoomNumber']) {
      it(key, () => {
        assertRejectedUpdate({ isActive: true, [key]: 'x' }, `isActive + ${key}`);
      });
    }

    it('a lone unknown key', () => {
      assertRejectedUpdate({ outOfService: true }, 'outOfService');
    });
  });

  describe('rejects a non-boolean isActive', () => {
    for (const [label, isActive] of [
      ['the string "true"', 'true'],
      ['the string "false"', 'false'],
      ['1', 1],
      ['0', 0],
      ['null', null],
      ['undefined', undefined],
      ['an object', {}],
    ] as const) {
      it(label, () => {
        assertRejectedUpdate({ isActive }, `isActive: ${label}`);
      });
    }
  });

  describe('owns its own error contract for a malformed replacement number', () => {
    // The locked ownership model: a malformed identifier in the ROUTE is
    // INVALID_ROOM_NUMBER, a bad POST body is INVALID_ROOM_CREATE, and
    // anything wrong with a PATCH body is INVALID_ROOM_UPDATE — including the
    // replacement number. One body, one error contract.
    for (const [label, roomNumber] of [
      ['a slash', 'D/101'],
      ['a percent', 'D%101'],
      ['a backslash', 'D\\101'],
      ['a question mark', 'D?101'],
      ['a hash', 'D#101'],
      ['blank', '   '],
      ['empty', ''],
      ['21 characters', 'A'.repeat(21)],
      ['a control character', 'D\u0001101'],
      ['DEL', 'D\u007f101'],
      ['a number', 101],
      ['null', null],
    ] as const) {
      it(label, () => {
        assertRejectedUpdate({ roomNumber }, `roomNumber: ${label}`);
      });
    }

    it('even when paired with a valid isActive', () => {
      assertRejectedUpdate({ roomNumber: 'D/101', isActive: true }, 'bad number + good status');
    });

    it('while the route-param validator still answers INVALID_ROOM_NUMBER', () => {
      assertRejectedNumber(parseRoomNumberParam, 'D/101', 'route param');
    });
  });
});

describe('frozen physical-room error contracts', () => {
  for (const [label, response, expected] of [
    ['ROOM_NOT_FOUND_RESPONSE', ROOM_NOT_FOUND_RESPONSE, { code: 'ROOM_NOT_FOUND', message: 'Room not found' }],
    [
      'ROOM_NUMBER_TAKEN_RESPONSE',
      ROOM_NUMBER_TAKEN_RESPONSE,
      { code: 'ROOM_NUMBER_TAKEN', message: 'Room number is already in use' },
    ],
    [
      'ROOM_HAS_FUTURE_RESERVATIONS_RESPONSE',
      ROOM_HAS_FUTURE_RESERVATIONS_RESPONSE,
      { code: 'ROOM_HAS_FUTURE_RESERVATIONS', message: 'Room has upcoming reservations' },
    ],
  ] as const) {
    describe(label, () => {
      it('is exactly the locked contract', () => {
        assert.deepEqual(response, { error: expected });
      });

      it('is frozen, inside and out', () => {
        assert.ok(Object.isFrozen(response));
        assert.ok(Object.isFrozen(response.error));
      });

      it('carries only code and message', () => {
        assert.deepEqual(Object.keys(response.error).sort(), ['code', 'message']);
      });
    });
  }

  it('ROOM_NUMBER_TAKEN does not imply uniqueness is scoped to one room type', () => {
    const message = ROOM_NUMBER_TAKEN_RESPONSE.error.message;

    // Uniqueness is hotel-wide and case-insensitive. A message hinting the
    // clash were local to this room type would send an administrator looking
    // in the wrong place.
    assert.ok(
      !/\b(this|type|room type|category)\b/i.test(message),
      `the message must not scope the clash to a room type: ${message}`,
    );
  });

  it('ROOM_HAS_FUTURE_RESERVATIONS carries no guest or reservation data', () => {
    const serialised = JSON.stringify(ROOM_HAS_FUTURE_RESERVATIONS_RESPONSE);
    assert.ok(!/\d/.test(serialised), 'the base body must carry no counts or dates');
  });
});
