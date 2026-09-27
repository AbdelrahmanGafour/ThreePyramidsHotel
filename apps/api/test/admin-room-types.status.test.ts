import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  INVALID_ROOM_TYPE_STATUS_ERROR_CODE,
  INVALID_ROOM_TYPE_STATUS_ERROR_MESSAGE,
  ROOM_TYPE_NO_ACTIVE_ROOMS_ERROR_CODE,
  ROOM_TYPE_NO_ACTIVE_ROOMS_RESPONSE,
  isInvalidRoomTypeStatusError,
} from '../src/modules/admin-room-types/admin-room-types.types';
import { parseAdminRoomTypeStatus } from '../src/modules/admin-room-types/admin-room-types.validation';

// Publishing and archiving one room type.
//
// Two halves. The parser is pure and is tested as such. The service's decision
// — which turns on how many physical rooms are actually in service — is tested
// against a recording stand-in for the pool, so the real service runs and the
// statements it issues can be inspected.
//
// What this cannot test is the lock itself. `FOR UPDATE` only means something
// against real PostgreSQL, so the serialization it buys is proven in
// reservations.room-type-lock.integration.test.ts and nowhere here. What is
// proven here is that the lock is taken, that it is taken FIRST, and that
// every refusal happens inside the transaction it opened.

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

function assertRejected(body: unknown, label: string): void {
  assert.throws(
    () => parseAdminRoomTypeStatus(body),
    (error: unknown) => {
      assert.ok(
        isInvalidRoomTypeStatusError(error),
        `expected a status error for ${label}, got: ${String(error)}`,
      );
      assert.equal(error.code, INVALID_ROOM_TYPE_STATUS_ERROR_CODE);
      assert.equal(error.message, INVALID_ROOM_TYPE_STATUS_ERROR_MESSAGE);
      return true;
    },
    `expected ${label} to be rejected`,
  );
}

describe('parseAdminRoomTypeStatus', () => {
  describe('accepts exactly { isActive: boolean }', () => {
    it('true', () => {
      assert.deepEqual(parseAdminRoomTypeStatus({ isActive: true }), { isActive: true });
    });

    it('false', () => {
      assert.deepEqual(parseAdminRoomTypeStatus({ isActive: false }), { isActive: false });
    });

    it('a null-prototype object, which JSON.parse can produce', () => {
      const body = Object.assign(Object.create(null), { isActive: true });
      assert.deepEqual(parseAdminRoomTypeStatus(body), { isActive: true });
    });

    it('returning a fresh object, not the caller body', () => {
      const body = { isActive: true };
      const parsed = parseAdminRoomTypeStatus(body);

      assert.notEqual(parsed, body);
      assert.deepEqual(Object.keys(parsed), ['isActive']);
    });
  });

  describe('rejects a missing key', () => {
    for (const [label, body] of [
      ['an empty object', {}],
      ['a null-prototype empty object', Object.create(null)],
      ['isActive: undefined', { isActive: undefined }],
    ] as const) {
      it(label, () => {
        assertRejected(body, label);
      });
    }
  });

  describe('rejects an extra key', () => {
    for (const [label, body] of [
      ['isActive + an unknown key', { isActive: true, reason: 'refurbishment' }],
      ['isActive + a room-type field', { isActive: true, name: 'Garden Suite' }],
      ['isActive + capacity', { isActive: true, capacity: 2 }],
      ['isActive + slug', { isActive: false, slug: 'garden-suite' }],
      ['isActive twice over, differently spelled', { isActive: true, is_active: true }],
    ] as const) {
      it(label, () => {
        assertRejected(body, label);
      });
    }

    it('a differently spelled key on its own', () => {
      assertRejected({ IsActive: true }, 'IsActive');
      assertRejected({ is_active: true }, 'is_active');
      assertRejected({ active: true }, 'active');
      assertRejected({ status: 'active' }, 'status');
    });
  });

  describe('rejects a value that is not a boolean, and coerces nothing', () => {
    // Publishing and withdrawing are opposite acts. A server that guesses
    // which way a malformed request leaned will eventually guess wrong in
    // front of guests, so every one of these is an error rather than an
    // interpretation.
    for (const [label, isActive] of [
      ['the string "true"', 'true'],
      ['the string "false"', 'false'],
      ['the string "1"', '1'],
      ['the number 1', 1],
      ['the number 0', 0],
      ['null', null],
      ['an empty string', ''],
      ['an object', { value: true }],
      ['an array', [true]],
      ['a Boolean wrapper object', new Boolean(true)],
    ] as const) {
      it(label, () => {
        assertRejected({ isActive }, `isActive: ${label}`);
      });
    }
  });

  describe('rejects a body that is not an object at all', () => {
    for (const [label, body] of [
      ['null', null],
      ['undefined', undefined],
      ['an array', [{ isActive: true }]],
      ['a bare boolean', true],
      ['a number', 1],
      ['a string', 'true'],
      ['a Date', new Date()],
      ['a Map', new Map()],
    ] as const) {
      it(label, () => {
        assertRejected(body, label);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

type ServiceModule = typeof import('../src/modules/admin-room-types/admin-room-types.service.js');
type Pool = typeof import('../src/db/pool.js');

let changeAdminRoomTypeStatus: ServiceModule['changeAdminRoomTypeStatus'];
let dbPool: Pool['dbPool'];

type RecordedCall = { text: string; values: unknown[] };

let calls: RecordedCall[] = [];
/** Reset per test, so one test can assert its own client lifecycle. */
let released = 0;
/** Never reset: the whole-suite check below outlives beforeEach. */
let totalReleased = 0;
/** Rows the locking SELECT returns. */
let lockedRows: unknown[] = [];
/** Rows the active-room COUNT returns. */
let countRows: unknown[] = [];
/** Rows the status UPDATE returns. */
let updatedRows: unknown[] = [];

const SLUG = 'garden-suite';
const CREATED_AT = new Date('2026-09-18T08:30:00.000Z');
const UPDATED_AT = new Date('2026-09-22T09:15:00.000Z');

/** A row shaped like the detail contract the repository mapper expects. */
const detailRow = (isActive: boolean, roomCount = 2) => ({
  slug: SLUG,
  name: 'Garden Suite',
  short_description: null,
  description: null,
  capacity: 2,
  bed_type: null,
  bed_count: null,
  size_sqm: null,
  view: null,
  base_nightly_rate: '2400.00',
  is_active: isActive,
  sort_order: 0,
  room_count: roomCount,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
});

const lockedRow = (isActive: boolean) => ({
  id: '7',
  slug: SLUG,
  capacity: 2,
  is_active: isActive,
});

/** The statements issued, reduced for readability. */
const sequence = () =>
  calls.map((call) => {
    const text = call.text.trim();

    if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
      return text;
    }
    if (text.startsWith('SELECT COUNT')) {
      return 'COUNT';
    }

    return text.startsWith('SELECT') ? 'SELECT' : 'UPDATE';
  });

/**
 * A statement by what it *is*, not what it contains. The detail statements
 * carry a `(SELECT COUNT(*) FROM rooms ...)` subquery in their RETURNING
 * clause, so matching "SELECT COUNT" anywhere would find the UPDATE too.
 */
const statementStartingWith = (prefix: string) =>
  calls.find((call) => call.text.trim().startsWith(prefix));

/** The active-room count, which is the only statement that *starts* with it. */
const activeRoomCount = () => statementStartingWith('SELECT COUNT');

function respond(text: string): Promise<{ rows: unknown[] }> {
  const trimmed = text.trim();

  if (trimmed.startsWith('SELECT COUNT')) {
    return Promise.resolve({ rows: countRows });
  }
  if (trimmed.startsWith('SELECT')) {
    return Promise.resolve({ rows: lockedRows });
  }
  if (trimmed.startsWith('UPDATE')) {
    return Promise.resolve({ rows: updatedRows });
  }

  return Promise.resolve({ rows: [] });
}

before(async () => {
  // The service's module graph reaches db/pool, which requires DATABASE_URL at
  // import time. Nothing here connects: the pool is replaced before any call,
  // and a placeholder is enough to load the module.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ dbPool } = await import('../src/db/pool.js'));
  ({ changeAdminRoomTypeStatus } = await import(
    '../src/modules/admin-room-types/admin-room-types.service.js'
  ));

  // node:test runs each file in its own process, so this cannot reach another
  // suite.
  const record = (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    return respond(text);
  };

  (dbPool as unknown as { connect: unknown }).connect = () =>
    Promise.resolve({
      query: record,
      release: () => {
        released += 1;
        totalReleased += 1;
      },
    });

  (dbPool as unknown as { query: unknown }).query = record;
});

after(() => {
  // Cumulative, not per-test: the last describe below is pure and touches no
  // pool, and `beforeEach` has already zeroed the per-test counter by then.
  assert.ok(totalReleased > 0, 'the suite should have exercised the client lifecycle');
});

beforeEach(() => {
  calls = [];
  released = 0;
  lockedRows = [];
  countRows = [];
  updatedRows = [];
});

describe('changeAdminRoomTypeStatus: publishing', () => {
  it('publishes a draft that has at least one active physical room', async () => {
    lockedRows = [lockedRow(false)];
    countRows = [{ active_rooms: '1' }];
    updatedRows = [detailRow(true)];

    const result = await changeAdminRoomTypeStatus(SLUG, true);

    assert.equal(result.outcome, 'updated');
    assert.equal(result.outcome === 'updated' && result.roomType.isActive, true);
    assert.equal(result.outcome === 'updated' && result.roomType.slug, SLUG);
    assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'COUNT', 'UPDATE', 'COMMIT']);
  });

  it('refuses a draft with no physical rooms at all', async () => {
    lockedRows = [lockedRow(false)];
    countRows = [{ active_rooms: '0' }];

    const result = await changeAdminRoomTypeStatus(SLUG, true);

    assert.equal(result.outcome, 'no-active-rooms');
    assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'COUNT', 'ROLLBACK']);
    assert.ok(!calls.some((call) => call.text.trim().startsWith('UPDATE')), 'nothing was written');
  });

  it('refuses a draft whose rooms all exist but are out of service', async () => {
    // The count is what distinguishes these two cases, and it is the count of
    // ACTIVE rooms — so "three rooms, none in service" refuses exactly as
    // "no rooms at all" does. The detail's `room_count` would have said 3.
    lockedRows = [lockedRow(false)];
    countRows = [{ active_rooms: '0' }];

    const result = await changeAdminRoomTypeStatus(SLUG, true);

    assert.equal(result.outcome, 'no-active-rooms');
  });

  it('counts only rooms that are in service, never the inventory figure', async () => {
    // The guard must not be satisfiable by a room that no guest could be
    // allocated. This is the assertion that fails if anyone swaps this for
    // `room_count`.
    lockedRows = [lockedRow(false)];
    countRows = [{ active_rooms: '1' }];
    updatedRows = [detailRow(true)];

    await changeAdminRoomTypeStatus(SLUG, true);

    const count = activeRoomCount();
    assert.ok(count, 'the publish path should count active rooms');
    assert.match(count.text, /FROM rooms r/);
    assert.match(count.text, /r\.room_type_id = \$1/);
    assert.match(count.text, /r\.is_active = true/);
    assert.deepEqual(count.values, ['7'], 'counted by the locked internal id');
  });

  it('publishes when several rooms are in service', async () => {
    lockedRows = [lockedRow(false)];
    countRows = [{ active_rooms: '5' }];
    updatedRows = [detailRow(true, 5)];

    const result = await changeAdminRoomTypeStatus(SLUG, true);

    assert.equal(result.outcome, 'updated');
  });
});

describe('changeAdminRoomTypeStatus: archiving', () => {
  it('archives a published room type', async () => {
    lockedRows = [lockedRow(true)];
    updatedRows = [detailRow(false)];

    const result = await changeAdminRoomTypeStatus(SLUG, false);

    assert.equal(result.outcome, 'updated');
    assert.equal(result.outcome === 'updated' && result.roomType.isActive, false);
  });

  it('never counts rooms when archiving', async () => {
    // Archiving strands nothing and is reversible. A system that argues at
    // that moment keeps a broken room type on sale.
    lockedRows = [lockedRow(true)];
    updatedRows = [detailRow(false)];

    await changeAdminRoomTypeStatus(SLUG, false);

    assert.equal(activeRoomCount(), undefined);
    assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
  });

  it('archives a room type with no active rooms left', async () => {
    lockedRows = [lockedRow(true)];
    updatedRows = [detailRow(false, 0)];

    const result = await changeAdminRoomTypeStatus(SLUG, false);

    assert.equal(result.outcome, 'updated');
  });

  it('writes no reservation, so stays already booked are untouched', async () => {
    // Archiving hides a room type from the website, from availability and
    // from new bookings. The stays the hotel already promised are not this
    // endpoint's to cancel, and no statement here could.
    lockedRows = [lockedRow(true)];
    updatedRows = [detailRow(false)];

    await changeAdminRoomTypeStatus(SLUG, false);

    for (const call of calls) {
      assert.doesNotMatch(call.text, /reservations/i, 'no statement may touch reservations');
    }
  });

  it('writes only room_types.is_active and updated_at', async () => {
    lockedRows = [lockedRow(true)];
    updatedRows = [detailRow(false)];

    await changeAdminRoomTypeStatus(SLUG, false);

    const update = statementStartingWith('UPDATE');
    assert.ok(update);
    assert.match(update.text, /UPDATE room_types rt/);
    assert.match(update.text, /SET is_active = \$2/);
    assert.ok(!/SET[\s\S]*capacity =/.test(update.text), 'capacity is not this endpoint');
    assert.ok(!/UPDATE rooms/.test(update.text), 'physical rooms are not this endpoint');
  });
});

describe('changeAdminRoomTypeStatus: idempotence', () => {
  it('active -> active succeeds and changes nothing', async () => {
    lockedRows = [lockedRow(true)];
    updatedRows = [detailRow(true)];

    const result = await changeAdminRoomTypeStatus(SLUG, true);

    assert.equal(result.outcome, 'updated');
    assert.equal(result.outcome === 'updated' && result.roomType.isActive, true);
  });

  it('inactive -> inactive succeeds and changes nothing', async () => {
    lockedRows = [lockedRow(false)];
    updatedRows = [detailRow(false)];

    const result = await changeAdminRoomTypeStatus(SLUG, false);

    assert.equal(result.outcome, 'updated');
    assert.equal(result.outcome === 'updated' && result.roomType.isActive, false);
  });

  it('leaves updated_at alone when the value is unchanged', async () => {
    // The guard is in the statement rather than in a branch above it, so a
    // client re-sending the state it can already see never makes the
    // catalogue look edited.
    lockedRows = [lockedRow(true)];
    updatedRows = [detailRow(true)];

    await changeAdminRoomTypeStatus(SLUG, true);

    const update = statementStartingWith('UPDATE');
    assert.ok(update);
    assert.match(update.text, /updated_at = CASE/);
    assert.match(update.text, /WHEN rt\.is_active IS DISTINCT FROM \$2 THEN now\(\)/);
    assert.match(update.text, /ELSE rt\.updated_at/);
    assert.ok(!/SET[\s\S]*updated_at = now\(\)/.test(update.text), 'no unconditional now()');
  });

  it('does not re-run the publish guard for an already-published room type', async () => {
    // Asking for what is already true is not publishing. Refusing it would
    // refuse to leave things exactly as they are — the same reasoning the
    // physical-room path applies to taking a room out of service.
    lockedRows = [lockedRow(true)];
    updatedRows = [detailRow(true, 0)];

    const result = await changeAdminRoomTypeStatus(SLUG, true);

    assert.equal(result.outcome, 'updated');
    assert.equal(activeRoomCount(), undefined, 'no transition, no guard');
  });
});

describe('changeAdminRoomTypeStatus: the transaction and the lock', () => {
  it('locks the room type first, by slug, before anything is decided', async () => {
    lockedRows = [lockedRow(false)];
    countRows = [{ active_rooms: '1' }];
    updatedRows = [detailRow(true)];

    await changeAdminRoomTypeStatus(SLUG, true);

    assert.equal(calls[0]?.text.trim(), 'BEGIN', 'the lock means nothing outside a transaction');

    const lock = calls[1];
    assert.ok(lock);
    assert.match(lock.text, /FROM room_types rt/);
    assert.match(lock.text, /WHERE rt\.slug = \$1/);
    assert.match(lock.text, /FOR UPDATE/);
    assert.deepEqual(lock.values, [SLUG]);
  });

  it('takes no second lock, and never locks a room', async () => {
    // The canonical admin order is room_types then rooms, and every path
    // takes the parent first. This path needs only the parent: the room count
    // is a read under that lock, and locking rooms here would contend with
    // the booking allocator for nothing.
    lockedRows = [lockedRow(false)];
    countRows = [{ active_rooms: '1' }];
    updatedRows = [detailRow(true)];

    await changeAdminRoomTypeStatus(SLUG, true);

    const locks = calls.filter((call) => /FOR UPDATE/.test(call.text));
    assert.equal(locks.length, 1, 'exactly one lock');
    assert.ok(!/FOR UPDATE[\s\S]*rooms r\b/.test(locks[0]!.text), 'the parent row, not a room');
  });

  it('reports a missing room type without writing or counting', async () => {
    lockedRows = [];

    const result = await changeAdminRoomTypeStatus(SLUG, true);

    assert.equal(result.outcome, 'not-found');
    assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'ROLLBACK']);
  });

  it('releases the client on every path', async () => {
    lockedRows = [];
    await changeAdminRoomTypeStatus(SLUG, true);
    assert.equal(released, 1);

    lockedRows = [lockedRow(false)];
    countRows = [{ active_rooms: '0' }];
    await changeAdminRoomTypeStatus(SLUG, true);
    assert.equal(released, 2);

    lockedRows = [lockedRow(false)];
    countRows = [{ active_rooms: '1' }];
    updatedRows = [detailRow(true)];
    await changeAdminRoomTypeStatus(SLUG, true);
    assert.equal(released, 3);
  });

  it('treats a vanished row under its own lock as a fault, not a 404', async () => {
    lockedRows = [lockedRow(true)];
    updatedRows = [];

    await assert.rejects(
      () => changeAdminRoomTypeStatus(SLUG, false),
      /Room type vanished while its status was being updated/,
    );
  });
});

// ---------------------------------------------------------------------------
// The locked refusal body
// ---------------------------------------------------------------------------

describe('the publish refusal', () => {
  it('carries the agreed code and nothing else', () => {
    assert.deepEqual(ROOM_TYPE_NO_ACTIVE_ROOMS_RESPONSE, {
      error: {
        code: 'ROOM_TYPE_NO_ACTIVE_ROOMS',
        message: 'Room type cannot be published without at least one active physical room',
      },
    });
    assert.equal(ROOM_TYPE_NO_ACTIVE_ROOMS_ERROR_CODE, 'ROOM_TYPE_NO_ACTIVE_ROOMS');
  });

  it('is frozen, so no handler can edit the shared body', () => {
    assert.ok(Object.isFrozen(ROOM_TYPE_NO_ACTIVE_ROOMS_RESPONSE));
    assert.ok(Object.isFrozen(ROOM_TYPE_NO_ACTIVE_ROOMS_RESPONSE.error));
  });

  it('names no room, no count and no id', () => {
    const body = JSON.stringify(ROOM_TYPE_NO_ACTIVE_ROOMS_RESPONSE);

    assert.doesNotMatch(body, /\d/, 'a refusal is not a place to read inventory out of');
    assert.doesNotMatch(body, /garden-suite|room_type_id|rooms\./);
  });
});
