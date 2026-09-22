import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INVALID_ROOM_TYPE_CAPACITY_ERROR_CODE,
  INVALID_ROOM_TYPE_CAPACITY_ERROR_MESSAGE,
  ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_RESPONSE,
  isInvalidRoomTypeCapacityError,
} from '../src/modules/admin-room-types/admin-room-types.types';
import { PG_INT4_MAX } from '../src/modules/admin-room-types/admin-room-types.fields';
import { parseAdminRoomTypeCapacity } from '../src/modules/admin-room-types/admin-room-types.validation';

// Pure: the validation module imports no database code. Whether a capacity
// conflicts with stays already booked is a question about reservations, and no
// pure function can answer it — that belongs to the service, under a lock.

function assertRejected(body: unknown, label: string): void {
  assert.throws(
    () => parseAdminRoomTypeCapacity(body),
    (error: unknown) => {
      assert.ok(
        isInvalidRoomTypeCapacityError(error),
        `expected a capacity error for ${label}, got: ${String(error)}`,
      );
      assert.equal(error.code, INVALID_ROOM_TYPE_CAPACITY_ERROR_CODE);
      assert.equal(error.message, INVALID_ROOM_TYPE_CAPACITY_ERROR_MESSAGE);
      return true;
    },
    `expected ${label} to be rejected`,
  );
}

describe('parseAdminRoomTypeCapacity', () => {
  describe('accepts', () => {
    it('the schema floor of 1', () => {
      assert.deepEqual(parseAdminRoomTypeCapacity({ capacity: 1 }), { capacity: 1 });
    });

    it('an ordinary capacity', () => {
      assert.deepEqual(parseAdminRoomTypeCapacity({ capacity: 4 }), { capacity: 4 });
    });

    it('the largest value the integer column can hold', () => {
      // Corrected from Number.MAX_SAFE_INTEGER: room_types.capacity is an
      // int4 column, so anything above this was never storable and used to
      // fail inside PostgreSQL as a 22003 rather than as a bad request.
      assert.deepEqual(parseAdminRoomTypeCapacity({ capacity: PG_INT4_MAX }), {
        capacity: PG_INT4_MAX,
      });
    });

    it('a null-prototype object, which JSON.parse can produce', () => {
      const body = Object.assign(Object.create(null), { capacity: 2 });
      assert.deepEqual(parseAdminRoomTypeCapacity(body), { capacity: 2 });
    });

    it('returning a fresh object, not the caller body', () => {
      const body = { capacity: 2 };
      const parsed = parseAdminRoomTypeCapacity(body);

      assert.notEqual(parsed, body);
      assert.deepEqual(Object.keys(parsed), ['capacity']);
    });
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
      ['null', null],
      ['undefined', undefined],
      ['an object', { value: 2 }],
      ['an array', [2]],
    ] as const) {
      it(label, () => {
        assertRejected({ capacity }, `capacity: ${label}`);
      });
    }
  });

  describe('rejects a body that is not exactly { capacity }', () => {
    for (const [label, body] of [
      ['an empty object', {}],
      ['null', null],
      ['undefined', undefined],
      ['an array', [{ capacity: 2 }]],
      ['a number', 2],
      ['a string', '2'],
      ['a boolean', true],
      ['a Date', new Date()],
      ['a Map', new Map()],
    ] as const) {
      it(label, () => {
        assertRejected(body, label);
      });
    }

    it('capacity alongside an unknown key', () => {
      assertRejected({ capacity: 2, reason: 'refurbishment' }, 'capacity + unknown key');
    });

    it('capacity alongside a room-type field', () => {
      assertRejected({ capacity: 2, name: 'Garden Suite' }, 'capacity + name');
    });

    it('capacity alongside a server-controlled key', () => {
      assertRejected({ capacity: 2, isActive: false }, 'capacity + isActive');
    });

    it('a differently spelled key', () => {
      assertRejected({ Capacity: 2 }, 'Capacity');
      assertRejected({ capacity_: 2 }, 'capacity_');
      assertRejected({ maxGuests: 2 }, 'maxGuests');
    });
  });
});

describe('ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_RESPONSE', () => {
  it('is exactly the locked 409 contract', () => {
    assert.deepEqual(ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_RESPONSE, {
      error: {
        code: 'ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS',
        message: 'Room type capacity conflicts with existing upcoming reservations',
      },
    });
  });

  it('is frozen, inside and out', () => {
    assert.ok(Object.isFrozen(ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_RESPONSE));
    assert.ok(Object.isFrozen(ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_RESPONSE.error));
  });

  it('carries no guest or reservation data', () => {
    assert.deepEqual(Object.keys(ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_RESPONSE.error).sort(), [
      'code',
      'message',
    ]);
    const serialised = JSON.stringify(ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_RESPONSE);
    assert.ok(!/\d/.test(serialised), 'the base body must carry no counts or dates');
  });
});
