import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

// Covers the repository's pure parts only: row mapping. The SQL itself, the
// locking and the transaction behaviour are left to T02's integration tests
// against real PostgreSQL — asserting on query strings here would test the
// text, not the behaviour. No pool is mocked and no connection is made.

type RoomsModule = typeof import('../src/modules/admin-rooms/admin-rooms.repository.js');
type RoomTypesModule = typeof import('../src/modules/admin-room-types/admin-room-types.repository.js');

let toAdminPhysicalRoom: RoomsModule['toAdminPhysicalRoom'];
let toResolvedAdminPhysicalRoom: RoomsModule['toResolvedAdminPhysicalRoom'];
let parseRoomReservationCount: RoomsModule['parseRoomReservationCount'];
let toLockedAdminRoomType: RoomTypesModule['toLockedAdminRoomType'];
let parseReservationConflictCount: RoomTypesModule['parseReservationConflictCount'];

before(async () => {
  // Both module graphs reach db/pool, which requires DATABASE_URL at import
  // time. Nothing here connects or queries, so a placeholder is enough.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';

  ({ toAdminPhysicalRoom, toResolvedAdminPhysicalRoom, parseRoomReservationCount } = await import(
    '../src/modules/admin-rooms/admin-rooms.repository.js'
  ));
  ({ toLockedAdminRoomType, parseReservationConflictCount } = await import(
    '../src/modules/admin-room-types/admin-room-types.repository.js'
  ));
});

const CREATED = new Date('2026-09-18T08:30:00.000Z');
const UPDATED = new Date('2026-09-20T18:45:00.000Z');

const ROOM_ROW = {
  room_number: 'D-101',
  is_active: true,
  created_at: CREATED,
  updated_at: UPDATED,
};

const RESOLVED_ROW = {
  id: '42',
  room_type_id: '7',
  room_number: 'D-101',
  is_active: true,
};

const LOCKED_TYPE_ROW = {
  id: '7',
  slug: 'garden-suite',
  capacity: 2,
  is_active: false,
};

/** Varies one column of an otherwise valid row. */
function withColumn<T extends object>(row: T, column: string, value: unknown): T {
  return { ...row, [column]: value } as T;
}

function assertRejectedRow(
  map: (row: never) => unknown,
  row: object,
  pattern: RegExp,
  label: string,
): void {
  assert.throws(
    () => map(row as never),
    (error: unknown) => {
      assert.ok(error instanceof Error, `expected an Error for ${label}`);
      // A malformed row is a data or migration problem, named as such.
      assert.match(error.message, pattern);
      return true;
    },
    `expected ${label} to be rejected`,
  );
}

describe('toAdminPhysicalRoom', () => {
  describe('maps a well-formed row', () => {
    it('an active room', () => {
      assert.deepEqual(toAdminPhysicalRoom(ROOM_ROW), {
        roomNumber: 'D-101',
        isActive: true,
        createdAt: '2026-09-18T08:30:00.000Z',
        updatedAt: '2026-09-20T18:45:00.000Z',
      });
    });

    it('an inactive room', () => {
      assert.equal(toAdminPhysicalRoom(withColumn(ROOM_ROW, 'is_active', false)).isActive, false);
    });

    it('timestamps as canonical ISO instants that round-trip', () => {
      const room = toAdminPhysicalRoom(ROOM_ROW);

      assert.equal(room.createdAt, CREATED.toISOString());
      assert.equal(room.updatedAt, UPDATED.toISOString());
      assert.equal(new Date(room.createdAt).toISOString(), room.createdAt);
      assert.equal(new Date(room.updatedAt).toISOString(), room.updatedAt);
    });
  });

  describe('preserves the room number exactly', () => {
    for (const roomNumber of ['D-101', 'd-101', 'PH-1', 'Suite 4', 'annexe 2b', 'A']) {
      it(JSON.stringify(roomNumber), () => {
        assert.equal(
          toAdminPhysicalRoom(withColumn(ROOM_ROW, 'room_number', roomNumber)).roomNumber,
          roomNumber,
        );
      });
    }

    it('never re-cases a stored value', () => {
      // The case-insensitive unique index constrains which numbers may
      // coexist, not how any one of them is written.
      assert.equal(toAdminPhysicalRoom(withColumn(ROOM_ROW, 'room_number', 'd-101')).roomNumber, 'd-101');
      assert.equal(toAdminPhysicalRoom(withColumn(ROOM_ROW, 'room_number', 'D-101')).roomNumber, 'D-101');
    });

    it('never re-trims a stored value', () => {
      // Trimming is the parser's job on the way in; storage comes back as it is.
      assert.equal(
        toAdminPhysicalRoom(withColumn(ROOM_ROW, 'room_number', 'Suite  4')).roomNumber,
        'Suite  4',
      );
    });
  });

  describe('leaks no internal identifier', () => {
    it('returns exactly the four contracted keys', () => {
      assert.deepEqual(Object.keys(toAdminPhysicalRoom(ROOM_ROW)).sort(), [
        'createdAt',
        'isActive',
        'roomNumber',
        'updatedAt',
      ]);
    });

    it('drops an id a query should never have selected', () => {
      const room = toAdminPhysicalRoom(
        { ...ROOM_ROW, id: '42', room_type_id: '7' } as unknown as typeof ROOM_ROW,
      );

      assert.ok(!('id' in room));
      assert.ok(!('roomTypeId' in room));
      assert.ok(!('room_type_id' in room));
    });
  });

  describe('rejects a malformed row rather than coercing it', () => {
    for (const [label, value] of [
      ['null', null],
      ['undefined', undefined],
      ['a number', 101],
      ['a boolean', true],
      ['an empty string', ''],
      ['an object', {}],
    ] as const) {
      it(`room_number: ${label}`, () => {
        assertRejectedRow(
          toAdminPhysicalRoom,
          withColumn(ROOM_ROW, 'room_number', value),
          /Unexpected room room_number/,
          `room_number: ${label}`,
        );
      });
    }

    for (const [label, value] of [
      ['null', null],
      ['undefined', undefined],
      ['the string "true"', 'true'],
      ['1', 1],
      ['0', 0],
    ] as const) {
      it(`is_active: ${label}`, () => {
        assertRejectedRow(
          toAdminPhysicalRoom,
          withColumn(ROOM_ROW, 'is_active', value),
          /Unexpected room is_active/,
          `is_active: ${label}`,
        );
      });
    }

    for (const column of ['created_at', 'updated_at'] as const) {
      for (const [label, value] of [
        ['null', null],
        ['undefined', undefined],
        ['an ISO string rather than a Date', '2026-09-18T08:30:00.000Z'],
        ['an epoch number', 1_789_672_697_457],
        ['an invalid Date', new Date('not a date')],
      ] as const) {
        it(`${column}: ${label}`, () => {
          assertRejectedRow(
            toAdminPhysicalRoom,
            withColumn(ROOM_ROW, column, value),
            new RegExp(`Unexpected room ${column}`),
            `${column}: ${label}`,
          );
        });
      }
    }
  });
});

describe('toResolvedAdminPhysicalRoom — the repository-private locked room', () => {
  it('maps a well-formed row', () => {
    assert.deepEqual(toResolvedAdminPhysicalRoom(RESOLVED_ROW), {
      roomId: '42',
      roomTypeId: '7',
      roomNumber: 'D-101',
      isActive: true,
    });
  });

  it('keeps internal ids as strings, never numbers', () => {
    // bigint outruns exact integer arithmetic in JavaScript; a key that has
    // been through a float may no longer identify the row it came from.
    const resolved = toResolvedAdminPhysicalRoom(RESOLVED_ROW);

    assert.equal(typeof resolved.roomId, 'string');
    assert.equal(typeof resolved.roomTypeId, 'string');
  });

  it('accepts an id past exact integer arithmetic', () => {
    const big = '9007199254740993';
    const resolved = toResolvedAdminPhysicalRoom(withColumn(RESOLVED_ROW, 'id', big));

    assert.equal(resolved.roomId, big);
  });

  it('carries the current room number, so a caller can detect a rename', () => {
    const resolved = toResolvedAdminPhysicalRoom(withColumn(RESOLVED_ROW, 'room_number', 'D-999'));

    assert.equal(resolved.roomNumber, 'D-999');
    assert.notEqual(resolved.roomNumber, RESOLVED_ROW.room_number);
  });

  it('maps an inactive room', () => {
    assert.equal(toResolvedAdminPhysicalRoom(withColumn(RESOLVED_ROW, 'is_active', false)).isActive, false);
  });

  describe('rejects a malformed internal id', () => {
    for (const column of ['id', 'room_type_id'] as const) {
      for (const [label, value] of [
        ['a number', 42],
        ['zero', '0'],
        ['a leading zero', '042'],
        ['negative', '-1'],
        ['a decimal string', '4.2'],
        ['an empty string', ''],
        ['whitespace', ' 42 '],
        ['null', null],
        ['undefined', undefined],
        ['a non-numeric string', 'forty-two'],
      ] as const) {
        it(`${column}: ${label}`, () => {
          assertRejectedRow(
            toResolvedAdminPhysicalRoom,
            withColumn(RESOLVED_ROW, column, value),
            new RegExp(`Unexpected room ${column}`),
            `${column}: ${label}`,
          );
        });
      }
    }
  });

  describe('rejects a malformed room number or boolean', () => {
    for (const [label, value] of [
      ['null', null],
      ['an empty string', ''],
      ['a number', 101],
    ] as const) {
      it(`room_number: ${label}`, () => {
        assertRejectedRow(
          toResolvedAdminPhysicalRoom,
          withColumn(RESOLVED_ROW, 'room_number', value),
          /Unexpected room room_number/,
          `room_number: ${label}`,
        );
      });
    }

    for (const [label, value] of [
      ['null', null],
      ['the string "false"', 'false'],
      ['0', 0],
    ] as const) {
      it(`is_active: ${label}`, () => {
        assertRejectedRow(
          toResolvedAdminPhysicalRoom,
          withColumn(RESOLVED_ROW, 'is_active', value),
          /Unexpected room is_active/,
          `is_active: ${label}`,
        );
      });
    }
  });
});

describe('toLockedAdminRoomType — the repository-private locked room type', () => {
  it('maps a well-formed row', () => {
    assert.deepEqual(toLockedAdminRoomType(LOCKED_TYPE_ROW), {
      roomTypeId: '7',
      slug: 'garden-suite',
      capacity: 2,
      isActive: false,
    });
  });

  it('keeps the internal id as a string', () => {
    assert.equal(typeof toLockedAdminRoomType(LOCKED_TYPE_ROW).roomTypeId, 'string');
  });

  it('maps an active room type', () => {
    assert.equal(toLockedAdminRoomType(withColumn(LOCKED_TYPE_ROW, 'is_active', true)).isActive, true);
  });

  it('maps the schema floor capacity of 1', () => {
    assert.equal(toLockedAdminRoomType(withColumn(LOCKED_TYPE_ROW, 'capacity', 1)).capacity, 1);
  });

  describe('rejects a malformed id', () => {
    for (const [label, value] of [
      ['a number', 7],
      ['zero', '0'],
      ['negative', '-7'],
      ['a leading zero', '007'],
      ['an empty string', ''],
      ['null', null],
    ] as const) {
      it(label, () => {
        assertRejectedRow(
          toLockedAdminRoomType,
          withColumn(LOCKED_TYPE_ROW, 'id', value),
          /Unexpected room type id/,
          `id: ${label}`,
        );
      });
    }
  });

  describe('rejects a malformed capacity', () => {
    // capacity > 0 is a CHECK constraint, so anything less is impossible data.
    for (const [label, value] of [
      ['zero', 0],
      ['negative', -1],
      ['fractional', 2.5],
      ['a numeric string', '2'],
      ['null', null],
      ['undefined', undefined],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['past exact integer arithmetic', Number.MAX_SAFE_INTEGER + 1],
    ] as const) {
      it(label, () => {
        assertRejectedRow(
          toLockedAdminRoomType,
          withColumn(LOCKED_TYPE_ROW, 'capacity', value),
          /Unexpected room type capacity/,
          `capacity: ${label}`,
        );
      });
    }
  });

  describe('rejects a malformed boolean or slug', () => {
    for (const [label, value] of [
      ['null', null],
      ['the string "false"', 'false'],
      ['0', 0],
      ['undefined', undefined],
    ] as const) {
      it(`is_active: ${label}`, () => {
        assertRejectedRow(
          toLockedAdminRoomType,
          withColumn(LOCKED_TYPE_ROW, 'is_active', value),
          /Unexpected room type is_active/,
          `is_active: ${label}`,
        );
      });
    }

    it('slug: a number', () => {
      assertRejectedRow(
        toLockedAdminRoomType,
        withColumn(LOCKED_TYPE_ROW, 'slug', 7),
        /Unexpected room type slug/,
        'slug: a number',
      );
    });
  });
});

describe('count mapping', () => {
  // Both repositories answer the same question about the same driver, so both
  // parsers are held to the same contract.
  const parsers = () =>
    [
      ['admin-rooms.parseRoomReservationCount', parseRoomReservationCount],
      ['admin-room-types.parseReservationConflictCount', parseReservationConflictCount],
    ] as const;

  it('maps zero', () => {
    for (const [name, parse] of parsers()) {
      assert.equal(parse('0'), 0, name);
    }
  });

  it('maps a positive count', () => {
    for (const [name, parse] of parsers()) {
      assert.equal(parse('1'), 1, name);
      assert.equal(parse('42'), 42, name);
      assert.equal(parse('1000000'), 1_000_000, name);
    }
  });

  it('maps the largest exactly representable count', () => {
    for (const [name, parse] of parsers()) {
      assert.equal(parse(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER, name);
    }
  });

  it('rejects a count past exact integer arithmetic', () => {
    for (const [name, parse] of parsers()) {
      assert.throws(
        () => parse('9007199254740993'),
        /exceeds exact integer arithmetic/,
        `${name}: a count that cannot round-trip must not be reported as a number`,
      );
    }
  });

  for (const [label, value] of [
    ['a negative string', '-1'],
    ['a decimal string', '1.5'],
    ['a number', 1],
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace padding', ' 1 '],
    ['a non-numeric string', 'many'],
    ['an exponent', '1e3'],
    ['a boolean', true],
    ['an object', {}],
  ] as const) {
    it(`rejects ${label}`, () => {
      for (const [name, parse] of parsers()) {
        assert.throws(() => parse(value), /Unexpected reservation count/, `${name}: ${label}`);
      }
    });
  }
});
