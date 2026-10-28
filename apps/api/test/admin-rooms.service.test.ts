import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

// Covers the service's decisions and the shape of the transactions it runs,
// without a database: `dbPool.connect` and `dbPool.query` are swapped for
// stand-ins that record statements and return programmed rows, so the real
// service runs and the sequence it issues can be inspected.
//
// What this cannot test is the locks themselves. `FOR UPDATE` only means
// something against real PostgreSQL, so lock behaviour is proven in
// reservations.room-type-lock.integration.test.ts and, for these flows, in
// T02-G once the HTTP layer exists. Nothing here claims locking correctness.

type ServiceModule = typeof import('../src/modules/admin-rooms/admin-rooms.service.js');
type Pool = typeof import('../src/db/pool.js');

let listAdminPhysicalRooms: ServiceModule['listAdminPhysicalRooms'];
let addAdminPhysicalRoom: ServiceModule['addAdminPhysicalRoom'];
let changeAdminPhysicalRoom: ServiceModule['changeAdminPhysicalRoom'];
let dbPool: Pool['dbPool'];

type RecordedCall = { text: string; values: unknown[] };

let calls: RecordedCall[] = [];
let released = 0;

/** Rows for each statement the flows issue, keyed by what the statement is. */
let listRows: unknown[] = [];
let insertRows: unknown[] = [];
let resolveRows: unknown[] = [];
let parentLockRows: unknown[] = [];
let roomLockRows: unknown[] = [];
let countRows: unknown[] = [];
let updateRows: unknown[] = [];

let failOn: string | null = null;
let failWith: unknown = null;

const SLUG = 'garden-suite';
const ROOM = 'D-101';
const CREATED_AT = new Date('2026-09-18T08:30:00.000Z');
const UPDATED_AT = new Date('2026-09-22T09:15:00.000Z');

const roomRow = (roomNumber: string, isActive: boolean) => ({
  room_number: roomNumber,
  is_active: isActive,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
});

const resolvedRow = (roomNumber: string, isActive: boolean, roomTypeId = '7') => ({
  id: '42',
  room_type_id: roomTypeId,
  room_number: roomNumber,
  is_active: isActive,
});

const uniqueViolation = (constraint: string) =>
  Object.assign(new Error('duplicate key'), { code: '23505', constraint });

/**
 * Classifies a statement by what it *is*. Several statements contain the word
 * SELECT or COUNT inside a subquery, so the prefix and a distinguishing clause
 * are both needed.
 */
function classify(text: string): string {
  const trimmed = text.trim();

  if (trimmed.startsWith('BEGIN') || trimmed.startsWith('COMMIT') || trimmed.startsWith('ROLLBACK')) {
    return trimmed;
  }
  if (trimmed.startsWith('INSERT')) {
    return 'INSERT';
  }
  if (trimmed.startsWith('UPDATE')) {
    return 'UPDATE';
  }
  if (trimmed.startsWith('SELECT COUNT')) {
    return 'COUNT';
  }
  if (/WHERE r\.id = \$1/.test(trimmed) && !/FOR UPDATE/.test(trimmed)) {
    // The plain read-back that replaces RETURNING in MySQL.
    return 'READBACK';
  }
  if (/FROM room_types rt\b/.test(trimmed) && /FOR UPDATE/.test(trimmed)) {
    return 'LOCK_TYPE';
  }
  if (/LEFT JOIN rooms/.test(trimmed)) {
    return 'LIST';
  }
  if (/FROM rooms r\b/.test(trimmed) && /FOR UPDATE/.test(trimmed)) {
    return 'LOCK_ROOM';
  }

  return 'RESOLVE';
}

const sequence = () => calls.map((call) => classify(call.text));

const statementOfKind = (kind: string) => calls.find((call) => classify(call.text) === kind);

function respond(text: string): Promise<{ rows: unknown[] }> {
  switch (classify(text)) {
    case 'LIST':
      return Promise.resolve({ rows: listRows });
    case 'INSERT':
      return Promise.resolve(
        insertRows.length > 0 ? { rows: [], rowCount: 1, insertId: '42' } : { rows: [], rowCount: 0 },
      );
    case 'READBACK':
      return Promise.resolve({ rows: [...insertRows, ...updateRows] });
    case 'RESOLVE':
      return Promise.resolve({ rows: resolveRows });
    case 'LOCK_TYPE':
      return Promise.resolve({ rows: parentLockRows });
    case 'LOCK_ROOM':
      return Promise.resolve({ rows: roomLockRows });
    case 'COUNT':
      return Promise.resolve({ rows: countRows });
    case 'UPDATE':
      return Promise.resolve({ rows: [], rowCount: 1 });
    default:
      return Promise.resolve({ rows: [] });
  }
}

before(async () => {
  // The service's module graph reaches db/pool, which requires DATABASE_URL at
  // import time. Nothing here connects: the pool is replaced before any call.
  process.env.DATABASE_URL ??= 'mysql://unused:unused@127.0.0.1:1/unused';
  ({ dbPool } = await import('../src/db/pool.js'));
  ({ listAdminPhysicalRooms, addAdminPhysicalRoom, changeAdminPhysicalRoom } = await import(
    '../src/modules/admin-rooms/admin-rooms.service.js'
  ));

  const record = (text: string, values: unknown[] = []) => {
    calls.push({ text, values });

    if (failOn && classify(text) === failOn) {
      return Promise.reject(failWith ?? new Error(`database failure during ${failOn}`));
    }

    return respond(text);
  };

  (dbPool as unknown as { connect: unknown }).connect = () =>
    Promise.resolve({
      query: record,
      release: () => {
        released += 1;
      },
    });

  (dbPool as unknown as { query: unknown }).query = record;
});

after(() => {
  assert.ok(released > 0, 'the suite should have exercised the client lifecycle');
});

beforeEach(() => {
  calls = [];
  released = 0;
  listRows = [];
  insertRows = [];
  resolveRows = [];
  parentLockRows = [];
  roomLockRows = [];
  countRows = [];
  updateRows = [];
  failOn = null;
  failWith = null;
});

describe('listAdminPhysicalRooms', () => {
  it('reports a missing room type when the repository returns null', async () => {
    listRows = [];

    assert.deepEqual(await listAdminPhysicalRooms(SLUG), { outcome: 'room-type-not-found' });
  });

  it('succeeds with an empty list for a room type that has no rooms', async () => {
    // The LEFT JOIN returns one row with every room column null.
    listRows = [{ room_number: null, is_active: null, created_at: null, updated_at: null }];

    const result = await listAdminPhysicalRooms(SLUG);

    assert.deepEqual(result, { outcome: 'listed', rooms: [] });
  });

  it('succeeds with the rooms it has, inactive ones included', async () => {
    listRows = [roomRow('D-101', true), roomRow('D-102', false)];

    const result = await listAdminPhysicalRooms(SLUG);

    assert.equal(result.outcome, 'listed');
    assert.equal(result.outcome === 'listed' && result.rooms.length, 2);
    assert.deepEqual(
      result.outcome === 'listed' && result.rooms.map((room) => [room.roomNumber, room.isActive]),
      [
        ['D-101', true],
        ['D-102', false],
      ],
    );
  });

  it('runs one statement, outside any transaction', async () => {
    listRows = [roomRow(ROOM, true)];

    await listAdminPhysicalRooms(SLUG);

    assert.deepEqual(sequence(), ['LIST']);
  });
});

describe('addAdminPhysicalRoom', () => {
  it('inserts and returns the new room', async () => {
    insertRows = [roomRow(ROOM, true)];

    const result = await addAdminPhysicalRoom(SLUG, ROOM);

    assert.equal(result.outcome, 'created');
    assert.equal(result.outcome === 'created' && result.room.roomNumber, ROOM);
    assert.equal(result.outcome === 'created' && result.room.isActive, true);
  });

  it('runs one statement and no transaction', async () => {
    insertRows = [roomRow(ROOM, true)];

    await addAdminPhysicalRoom(SLUG, ROOM);

    assert.deepEqual(sequence(), ['INSERT', 'READBACK']);
    assert.deepEqual(calls[0]!.values, [SLUG, ROOM]);
  });

  it('reports a missing room type when the insert matched no slug', async () => {
    insertRows = [];

    assert.deepEqual(await addAdminPhysicalRoom(SLUG, ROOM), { outcome: 'room-type-not-found' });
  });

  it('never pre-checks uniqueness', async () => {
    insertRows = [roomRow(ROOM, true)];

    await addAdminPhysicalRoom(SLUG, ROOM);

    assert.ok(!statementOfKind('RESOLVE'), 'the unique indexes are the authority, not a SELECT');
  });

  it('maps the exact unique violation to a taken room number', async () => {
    failOn = 'INSERT';
    failWith = uniqueViolation('rooms_room_number_key');

    assert.deepEqual(await addAdminPhysicalRoom(SLUG, ROOM), { outcome: 'room-number-taken' });
  });

  it('maps the case-insensitive unique violation to a taken room number', async () => {
    failOn = 'INSERT';
    failWith = uniqueViolation('rooms_room_number_lower_key');

    assert.deepEqual(await addAdminPhysicalRoom(SLUG, 'd-101'), { outcome: 'room-number-taken' });
  });

  it('propagates a unique violation on some other constraint', async () => {
    failOn = 'INSERT';
    failWith = uniqueViolation('rooms_pkey');

    await assert.rejects(() => addAdminPhysicalRoom(SLUG, ROOM), /duplicate key/);
  });

  it('propagates an unrelated database error', async () => {
    failOn = 'INSERT';
    failWith = Object.assign(new Error('connection terminated'), { code: '08006' });

    await assert.rejects(() => addAdminPhysicalRoom(SLUG, ROOM), /connection terminated/);
  });
});

describe('changeAdminPhysicalRoom', () => {
  /** The happy path's programmed rows, for a room that is currently active. */
  function givenActiveRoom(currentNumber = ROOM): void {
    resolveRows = [resolvedRow(currentNumber, true)];
    parentLockRows = [{ id: '7' }];
    roomLockRows = [resolvedRow(currentNumber, true)];
  }

  describe('provisional resolution', () => {
    it('reports not-found and opens no transaction when the room number is unknown', async () => {
      resolveRows = [];

      assert.deepEqual(await changeAdminPhysicalRoom(ROOM, { isActive: true }), { outcome: 'not-found' });
      assert.deepEqual(sequence(), ['RESOLVE']);
      assert.equal(released, 0, 'no client should be taken when there is nothing to lock');
    });

    it('resolves by the exact route number, case-sensitively', async () => {
      givenActiveRoom();
      updateRows = [roomRow(ROOM, true)];

      await changeAdminPhysicalRoom(ROOM, { isActive: true });

      const resolve = statementOfKind('RESOLVE')!;
      assert.deepEqual(resolve.values, [ROOM]);
      assert.doesNotMatch(resolve.text, /lower\(|upper\(|ILIKE/i);
    });
  });

  describe('lock order', () => {
    it('locks the room type before the room', async () => {
      givenActiveRoom();
      updateRows = [roomRow(ROOM, true)];

      await changeAdminPhysicalRoom(ROOM, { isActive: true });

      assert.deepEqual(sequence(), ['RESOLVE', 'BEGIN', 'LOCK_TYPE', 'LOCK_ROOM', 'UPDATE', 'READBACK', 'COMMIT']);

      const order = sequence();
      assert.ok(
        order.indexOf('LOCK_TYPE') < order.indexOf('LOCK_ROOM'),
        'the canonical order is room_types then rooms, never the reverse',
      );
    });

    it('locks the parent by the resolved internal id', async () => {
      givenActiveRoom();
      updateRows = [roomRow(ROOM, true)];

      await changeAdminPhysicalRoom(ROOM, { isActive: true });

      assert.deepEqual(statementOfKind('LOCK_TYPE')!.values, ['7']);
      assert.deepEqual(statementOfKind('LOCK_ROOM')!.values, ['42']);
    });

    it('reports not-found when the parent room type is gone', async () => {
      resolveRows = [resolvedRow(ROOM, true)];
      parentLockRows = [];

      const result = await changeAdminPhysicalRoom(ROOM, { isActive: true });

      assert.deepEqual(result, { outcome: 'not-found' });
      assert.deepEqual(sequence(), ['RESOLVE', 'BEGIN', 'LOCK_TYPE', 'ROLLBACK']);
      assert.equal(released, 1);
    });

    it('reports not-found when the room is gone by the time it is locked', async () => {
      resolveRows = [resolvedRow(ROOM, true)];
      parentLockRows = [{ id: '7' }];
      roomLockRows = [];

      const result = await changeAdminPhysicalRoom(ROOM, { isActive: true });

      assert.deepEqual(result, { outcome: 'not-found' });
      assert.deepEqual(sequence(), ['RESOLVE', 'BEGIN', 'LOCK_TYPE', 'LOCK_ROOM', 'ROLLBACK']);
    });
  });

  describe('stale route identity', () => {
    it('refuses to update through a URL naming the old number after a rename', async () => {
      // Another administrator renamed D-101 to D-999 between the provisional
      // resolution and the lock.
      resolveRows = [resolvedRow(ROOM, true)];
      parentLockRows = [{ id: '7' }];
      roomLockRows = [resolvedRow('D-999', true)];

      const result = await changeAdminPhysicalRoom(ROOM, { isActive: false });

      assert.deepEqual(result, { outcome: 'not-found' });
      assert.deepEqual(sequence(), ['RESOLVE', 'BEGIN', 'LOCK_TYPE', 'LOCK_ROOM', 'ROLLBACK']);
      assert.ok(!statementOfKind('UPDATE'), 'nothing may be written through a stale URL');
      assert.ok(!statementOfKind('COUNT'), 'the decision is abandoned before any rule is applied');
      assert.equal(released, 1);
    });

    it('compares the number exactly, so a case-only difference is still stale', async () => {
      resolveRows = [resolvedRow(ROOM, true)];
      parentLockRows = [{ id: '7' }];
      roomLockRows = [resolvedRow('d-101', true)];

      assert.deepEqual(await changeAdminPhysicalRoom(ROOM, { isActive: true }), { outcome: 'not-found' });
      assert.ok(!statementOfKind('UPDATE'));
    });
  });

  describe('parent invariant', () => {
    it('raises rather than writing when the locked room belongs to another room type', async () => {
      resolveRows = [resolvedRow(ROOM, true, '7')];
      parentLockRows = [{ id: '7' }];
      roomLockRows = [resolvedRow(ROOM, true, '8')];

      await assert.rejects(
        () => changeAdminPhysicalRoom(ROOM, { isActive: true }),
        /changed room type between resolution and lock/,
      );

      assert.ok(!statementOfKind('UPDATE'), 'a broken invariant must not be written through');
      assert.deepEqual(sequence(), ['RESOLVE', 'BEGIN', 'LOCK_TYPE', 'LOCK_ROOM', 'ROLLBACK']);
      assert.equal(released, 1);
    });
  });

  describe('deactivation', () => {
    it('refuses when the active room has an upcoming stay', async () => {
      givenActiveRoom();
      countRows = [{ upcoming: '2' }];

      const result = await changeAdminPhysicalRoom(ROOM, { isActive: false });

      assert.deepEqual(result, { outcome: 'has-future-reservations' });
      assert.deepEqual(sequence(), ['RESOLVE', 'BEGIN', 'LOCK_TYPE', 'LOCK_ROOM', 'COUNT', 'ROLLBACK']);
      assert.ok(!statementOfKind('UPDATE'));
      assert.equal(released, 1);
    });

    it('carries no guest or reservation data in the refusal', async () => {
      givenActiveRoom();
      countRows = [{ upcoming: '2' }];

      const result = await changeAdminPhysicalRoom(ROOM, { isActive: false });

      assert.deepEqual(Object.keys(result), ['outcome']);
    });

    it('counts by the locked room id, with the repository-owned definition', async () => {
      givenActiveRoom();
      countRows = [{ upcoming: '0' }];
      updateRows = [roomRow(ROOM, false)];

      await changeAdminPhysicalRoom(ROOM, { isActive: false });

      const count = statementOfKind('COUNT')!;
      assert.deepEqual(count.values, ['42']);
      assert.match(count.text, /status IN \('pending', 'confirmed'\)/);
      // A stay already checked in but not yet checked out still blocks.
      assert.match(count.text, /check_out > UTC_DATE()/);
      assert.doesNotMatch(count.text, /check_in >= UTC_DATE()/);
    });

    it('succeeds when nothing upcoming is allocated to the room', async () => {
      givenActiveRoom();
      countRows = [{ upcoming: '0' }];
      updateRows = [roomRow(ROOM, false)];

      const result = await changeAdminPhysicalRoom(ROOM, { isActive: false });

      assert.equal(result.outcome, 'updated');
      assert.equal(result.outcome === 'updated' && result.room.isActive, false);
      assert.deepEqual(sequence(), [
        'RESOLVE',
        'BEGIN',
        'LOCK_TYPE',
        'LOCK_ROOM',
        'COUNT',
        'UPDATE',
        'READBACK',
        'COMMIT',
      ]);
    });

    it('skips the count entirely for an already-inactive room', async () => {
      // Not a transition, so nothing can be stranded. Re-asking would refuse an
      // idempotent PATCH for no reason.
      resolveRows = [resolvedRow(ROOM, false)];
      parentLockRows = [{ id: '7' }];
      roomLockRows = [resolvedRow(ROOM, false)];
      updateRows = [roomRow(ROOM, false)];

      const result = await changeAdminPhysicalRoom(ROOM, { isActive: false });

      assert.equal(result.outcome, 'updated');
      assert.ok(!statementOfKind('COUNT'), 'a non-transition must not be gated on reservations');
    });
  });

  describe('activation', () => {
    it('always succeeds, without counting reservations', async () => {
      resolveRows = [resolvedRow(ROOM, false)];
      parentLockRows = [{ id: '7' }];
      roomLockRows = [resolvedRow(ROOM, false)];
      updateRows = [roomRow(ROOM, true)];

      const result = await changeAdminPhysicalRoom(ROOM, { isActive: true });

      assert.equal(result.outcome, 'updated');
      assert.equal(result.outcome === 'updated' && result.room.isActive, true);
      assert.ok(!statementOfKind('COUNT'));
    });

    it('is allowed on an already-active room, with no new conflict contract', async () => {
      givenActiveRoom();
      updateRows = [roomRow(ROOM, true)];

      const result = await changeAdminPhysicalRoom(ROOM, { isActive: true });

      assert.equal(result.outcome, 'updated');
      assert.ok(!statementOfKind('COUNT'));
    });
  });

  describe('rename', () => {
    it('succeeds and answers with the new number', async () => {
      givenActiveRoom();
      updateRows = [roomRow('D-201', true)];

      const result = await changeAdminPhysicalRoom(ROOM, { roomNumber: 'D-201' });

      assert.equal(result.outcome, 'updated');
      assert.equal(result.outcome === 'updated' && result.room.roomNumber, 'D-201');
    });

    it('never counts reservations for a rename alone', async () => {
      givenActiveRoom();
      updateRows = [roomRow('D-201', true)];

      await changeAdminPhysicalRoom(ROOM, { roomNumber: 'D-201' });

      assert.ok(!statementOfKind('COUNT'), 'renaming strands nobody');
      assert.deepEqual(sequence(), ['RESOLVE', 'BEGIN', 'LOCK_TYPE', 'LOCK_ROOM', 'UPDATE', 'READBACK', 'COMMIT']);
    });

    it('passes the new number through untouched, with no case transformation', async () => {
      givenActiveRoom();
      updateRows = [roomRow('Ph-Suite', true)];

      await changeAdminPhysicalRoom(ROOM, { roomNumber: 'Ph-Suite' });

      const update = statementOfKind('UPDATE')!;
      assert.deepEqual(update.values, ['42', 'Ph-Suite']);
      assert.doesNotMatch(update.text, /lower\(|upper\(/i);
    });

    it('addresses the update by internal id, not by the old number', async () => {
      givenActiveRoom();
      updateRows = [roomRow('D-201', true)];

      await changeAdminPhysicalRoom(ROOM, { roomNumber: 'D-201' });

      const update = statementOfKind('UPDATE')!;
      assert.match(update.text, /WHERE r\.id = \$1/);
      assert.ok(!update.values.includes(ROOM), 'the old number must not be used to find the row again');
    });

    it('maps the exact unique violation to a taken room number', async () => {
      givenActiveRoom();
      failOn = 'UPDATE';
      failWith = uniqueViolation('rooms_room_number_key');

      const result = await changeAdminPhysicalRoom(ROOM, { roomNumber: 'D-201' });

      assert.deepEqual(result, { outcome: 'room-number-taken' });
      assert.deepEqual(sequence(), ['RESOLVE', 'BEGIN', 'LOCK_TYPE', 'LOCK_ROOM', 'UPDATE', 'ROLLBACK']);
      assert.equal(released, 1);
    });

    it('maps a case-only collision, caught by the lower-case index', async () => {
      givenActiveRoom();
      failOn = 'UPDATE';
      failWith = uniqueViolation('rooms_room_number_lower_key');

      const result = await changeAdminPhysicalRoom(ROOM, { roomNumber: 'd-102' });

      assert.deepEqual(result, { outcome: 'room-number-taken' });
    });

    it('propagates a unique violation on some other constraint', async () => {
      givenActiveRoom();
      failOn = 'UPDATE';
      failWith = uniqueViolation('rooms_pkey');

      await assert.rejects(() => changeAdminPhysicalRoom(ROOM, { roomNumber: 'D-201' }), /duplicate key/);
      assert.equal(released, 1);
    });
  });

  describe('rename combined with a status change', () => {
    it('applies both in one statement and commits once', async () => {
      givenActiveRoom();
      countRows = [{ upcoming: '0' }];
      updateRows = [roomRow('D-201', false)];

      const result = await changeAdminPhysicalRoom(ROOM, { roomNumber: 'D-201', isActive: false });

      assert.equal(result.outcome, 'updated');
      assert.equal(result.outcome === 'updated' && result.room.roomNumber, 'D-201');
      assert.equal(result.outcome === 'updated' && result.room.isActive, false);
      assert.deepEqual(sequence(), [
        'RESOLVE',
        'BEGIN',
        'LOCK_TYPE',
        'LOCK_ROOM',
        'COUNT',
        'UPDATE',
        'READBACK',
        'COMMIT',
      ]);
      assert.deepEqual(statementOfKind('UPDATE')!.values, ['42', 'D-201', false]);
    });

    it('rolls the whole request back when the rename half conflicts', async () => {
      // The deactivation passed its check; the rename did not. Neither applies.
      givenActiveRoom();
      countRows = [{ upcoming: '0' }];
      failOn = 'UPDATE';
      failWith = uniqueViolation('rooms_room_number_lower_key');

      const result = await changeAdminPhysicalRoom(ROOM, { roomNumber: 'd-102', isActive: false });

      assert.deepEqual(result, { outcome: 'room-number-taken' });
      assert.equal(sequence().at(-1), 'ROLLBACK');
      assert.ok(!sequence().includes('COMMIT'), 'a refused combined request commits nothing');
      assert.equal(released, 1);
    });

    it('refuses before attempting the rename when the deactivation is blocked', async () => {
      givenActiveRoom();
      countRows = [{ upcoming: '1' }];

      const result = await changeAdminPhysicalRoom(ROOM, { roomNumber: 'D-201', isActive: false });

      assert.deepEqual(result, { outcome: 'has-future-reservations' });
      assert.ok(!statementOfKind('UPDATE'), 'the rename must not be applied either');
    });
  });

  describe('failure handling', () => {
    it('rolls back and releases when the room lock fails', async () => {
      resolveRows = [resolvedRow(ROOM, true)];
      parentLockRows = [{ id: '7' }];
      failOn = 'LOCK_ROOM';

      await assert.rejects(() => changeAdminPhysicalRoom(ROOM, { isActive: true }));

      assert.equal(sequence().at(-1), 'ROLLBACK');
      assert.equal(released, 1);
    });

    it('rolls back and releases when the count fails', async () => {
      givenActiveRoom();
      failOn = 'COUNT';

      await assert.rejects(() => changeAdminPhysicalRoom(ROOM, { isActive: false }));

      assert.equal(sequence().at(-1), 'ROLLBACK');
      assert.equal(released, 1);
    });

    it('propagates an unrelated database error from the update', async () => {
      givenActiveRoom();
      failOn = 'UPDATE';
      failWith = Object.assign(new Error('connection terminated'), { code: '08006' });

      await assert.rejects(() => changeAdminPhysicalRoom(ROOM, { isActive: true }), /connection terminated/);

      assert.equal(sequence().at(-1), 'ROLLBACK');
      assert.equal(released, 1);
    });

    it('releases even when BEGIN itself fails', async () => {
      resolveRows = [resolvedRow(ROOM, true)];
      failOn = 'BEGIN';

      await assert.rejects(() => changeAdminPhysicalRoom(ROOM, { isActive: true }));

      assert.equal(released, 1);
    });

    it('treats a vanished row under its own lock as a fault', async () => {
      givenActiveRoom();
      updateRows = [];

      await assert.rejects(() => changeAdminPhysicalRoom(ROOM, { isActive: true }), /vanished/);
      assert.equal(released, 1);
    });

    it('never writes reservations on any path', async () => {
      givenActiveRoom();
      countRows = [{ upcoming: '0' }];
      updateRows = [roomRow(ROOM, false)];

      await changeAdminPhysicalRoom(ROOM, { isActive: false });

      for (const call of calls) {
        assert.doesNotMatch(call.text, /UPDATE reservations|DELETE FROM reservations/i);
        assert.doesNotMatch(call.text, /SET room_type_id/i);
      }
    });
  });
});
