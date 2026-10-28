import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

// Covers the service's decisions and the shape of the transaction it runs,
// without a database: `dbPool.connect` and `dbPool.query` are swapped for
// stand-ins that record statements and return programmed rows, so the real
// service runs and the sequence it issues can be inspected.
//
// What this cannot test is the locks themselves. `FOR UPDATE` only means
// something against real PostgreSQL, so the serialization it buys is proven in
// reservations.room-type-lock.integration.test.ts and nowhere here.

type ServiceModule = typeof import('../src/modules/admin-room-types/admin-room-types.service.js');
type Pool = typeof import('../src/db/pool.js');

let createAdminRoomType: ServiceModule['createAdminRoomType'];
let changeAdminRoomTypeCapacity: ServiceModule['changeAdminRoomTypeCapacity'];
let dbPool: Pool['dbPool'];

type RecordedCall = { text: string; values: unknown[] };

let calls: RecordedCall[] = [];
let released = 0;
/** Rows the locking SELECT returns. */
let lockedRows: unknown[] = [];
/** Rows the conflict COUNT returns. */
let countRows: unknown[] = [];
/** Rows the capacity UPDATE returns. */
let updatedRows: unknown[] = [];
/** Rows the pool-level INSERT returns. */
let insertedRows: unknown[] = [];
/** Statement prefix that should reject, and the error it rejects with. */
let failOn: string | null = null;
let failWith: unknown = null;

const SLUG = 'garden-suite';
const CREATED_AT = new Date('2026-09-18T08:30:00.000Z');
const UPDATED_AT = new Date('2026-09-22T09:15:00.000Z');

/** A row shaped like the detail contract the repository mapper expects. */
const detailRow = (capacity: number) => ({
  slug: SLUG,
  name: 'Garden Suite',
  short_description: null,
  description: null,
  capacity,
  bed_type: null,
  bed_count: null,
  size_sqm: null,
  view: null,
  base_nightly_rate: '2400.00',
  is_active: false,
  sort_order: 0,
  room_count: 0,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
});

const lockedRow = (capacity: number) => ({
  id: '7',
  slug: SLUG,
  capacity,
  is_active: false,
});

const CREATE_INPUT = {
  slug: SLUG,
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
};

/** A pg unique violation, as the driver reports one. */
const uniqueViolation = (constraint: string) => Object.assign(new Error('duplicate key'), {
  code: '23505',
  constraint,
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

    // The non-locking SELECT is the read-back that replaces RETURNING.
    if (text.startsWith('SELECT')) {
      return text.includes('FOR UPDATE') ? 'SELECT' : 'READBACK';
    }

    return text.startsWith('INSERT') ? 'INSERT' : 'UPDATE';
  });

const statementMatching = (pattern: RegExp) => calls.find((call) => pattern.test(call.text));

/**
 * A statement by what it *is*, not what it contains. The detail statements
 * carry a `(SELECT COUNT(*) FROM rooms ...)` subquery in their RETURNING
 * clause, so matching "SELECT COUNT" anywhere would find the UPDATE too.
 */
const statementStartingWith = (prefix: string) =>
  calls.find((call) => call.text.trim().startsWith(prefix));

/** The conflict count, which is the only statement that *starts* with it. */
const conflictCount = () => statementStartingWith('SELECT COUNT');

const readBackRows = () => insertedRows;

function respond(text: string): Promise<{ rows: unknown[] }> {
  const trimmed = text.trim();

  if (trimmed.startsWith('SELECT COUNT')) {
    return Promise.resolve({ rows: countRows });
  }
  if (trimmed.startsWith('SELECT')) {
    // The locking read returns the locked row; the plain read-back that
    // replaces RETURNING returns the written row.
    return Promise.resolve({
      rows: trimmed.includes('FOR UPDATE') ? lockedRows : [...updatedRows, ...readBackRows()],
    });
  }
  if (trimmed.startsWith('UPDATE')) {
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  if (trimmed.startsWith('INSERT')) {
    return Promise.resolve({ rows: [], rowCount: 1, insertId: '42' });
  }

  return Promise.resolve({ rows: [] });
}

before(async () => {
  // The service's module graph reaches db/pool, which requires DATABASE_URL at
  // import time. Nothing here connects: the pool is replaced before any call,
  // and a placeholder is enough to load the module.
  process.env.DATABASE_URL ??= 'mysql://unused:unused@127.0.0.1:1/unused';
  ({ dbPool } = await import('../src/db/pool.js'));
  ({ createAdminRoomType, changeAdminRoomTypeCapacity } = await import(
    '../src/modules/admin-room-types/admin-room-types.service.js'
  ));

  // node:test runs each file in its own process, so this cannot reach another
  // suite. Nothing restores it because nothing else in this file needs a pool.
  const record = (text: string, values: unknown[] = []) => {
    calls.push({ text, values });

    if (failOn && text.trim().startsWith(failOn)) {
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
  lockedRows = [];
  countRows = [];
  updatedRows = [];
  insertedRows = [];
  failOn = null;
  failWith = null;
});

describe('createAdminRoomType', () => {
  it('inserts and returns the created draft', async () => {
    insertedRows = [detailRow(2)];

    const result = await createAdminRoomType(CREATE_INPUT);

    assert.equal(result.outcome, 'created');
    assert.equal(result.outcome === 'created' && result.roomType.slug, SLUG);
    assert.equal(result.outcome === 'created' && result.roomType.isActive, false);
    assert.equal(result.outcome === 'created' && result.roomType.roomCount, 0);
  });

  it('runs the INSERT and its read-back in one transaction', async () => {
    insertedRows = [detailRow(2)];

    await createAdminRoomType(CREATE_INPUT);

    // MySQL has no RETURNING: the new row is read back by its generated key.
    assert.deepEqual(sequence(), ['BEGIN', 'INSERT', 'READBACK', 'COMMIT']);
    assert.match(calls[1]!.text, /INSERT INTO room_types/);
    assert.deepEqual(calls[2]!.values, ['42']);
  });

  it('writes is_active as a literal false, never as a parameter', async () => {
    insertedRows = [detailRow(2)];

    await createAdminRoomType(CREATE_INPUT);

    const insert = statementMatching(/INSERT INTO room_types/)!;
    assert.match(insert.text, /false/);
    assert.ok(
      !insert.values.includes(true) && !insert.values.includes(false),
      'no boolean may be passed as a parameter',
    );
  });

  it('never pre-checks the slug', async () => {
    insertedRows = [detailRow(2)];

    await createAdminRoomType(CREATE_INPUT);

    const insertAt = calls.findIndex((call) => /^\s*INSERT/.test(call.text));
    assert.ok(
      !calls.slice(0, insertAt).some((call) => /^\s*SELECT/.test(call.text)),
      'the unique index is the authority, not a SELECT before the INSERT',
    );
  });

  it('maps a slug unique violation to the conflict', async () => {
    failOn = 'INSERT';
    failWith = uniqueViolation('room_types_slug_key');

    const result = await createAdminRoomType(CREATE_INPUT);

    assert.deepEqual(result, { outcome: 'slug-taken' });
  });

  it('propagates a unique violation on some other constraint', async () => {
    failOn = 'INSERT';
    failWith = uniqueViolation('some_other_key');

    await assert.rejects(() => createAdminRoomType(CREATE_INPUT), /duplicate key/);
  });

  it('propagates an unrelated database error', async () => {
    failOn = 'INSERT';
    failWith = Object.assign(new Error('connection terminated'), { code: '08006' });

    await assert.rejects(() => createAdminRoomType(CREATE_INPUT), /connection terminated/);
  });
});

describe('changeAdminRoomTypeCapacity', () => {
  describe('the transaction it runs', () => {
    it('locks, counts, updates and commits when lowering capacity', async () => {
      lockedRows = [lockedRow(4)];
      countRows = [{ conflicting: '0' }];
      updatedRows = [detailRow(2)];

      const result = await changeAdminRoomTypeCapacity(SLUG, 2);

      assert.equal(result.outcome, 'updated');
      assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'COUNT', 'UPDATE', 'READBACK', 'COMMIT']);
    });

    it('takes the row lock rather than reading it unlocked', async () => {
      lockedRows = [lockedRow(4)];
      countRows = [{ conflicting: '0' }];
      updatedRows = [detailRow(2)];

      await changeAdminRoomTypeCapacity(SLUG, 2);

      const select = statementMatching(/FROM room_types/)!;
      assert.match(select.text, /FOR UPDATE/);
      assert.match(select.text, /WHERE rt\.slug = \$1/);
      // A case-insensitive lookup would also defeat the unique index.
      assert.doesNotMatch(select.text, /lower\(|upper\(|ILIKE/i);
    });

    it('passes the slug and capacity as parameters, never as SQL text', async () => {
      lockedRows = [lockedRow(4)];
      countRows = [{ conflicting: '0' }];
      updatedRows = [detailRow(2)];

      await changeAdminRoomTypeCapacity(SLUG, 2);

      assert.deepEqual(statementMatching(/FOR UPDATE/)!.values, [SLUG]);
      assert.deepEqual(statementMatching(/^\s*UPDATE room_types/)!.values, ['7', 2]);
    });

    it('addresses the update by the locked internal id, not the slug', async () => {
      lockedRows = [lockedRow(4)];
      countRows = [{ conflicting: '0' }];
      updatedRows = [detailRow(2)];

      await changeAdminRoomTypeCapacity(SLUG, 2);

      const update = statementMatching(/^\s*UPDATE room_types/)!;
      assert.match(update.text, /WHERE rt\.id = \$1/);
      assert.ok(!update.values.includes(SLUG), 'the slug must not be re-resolved');
    });

    it('never writes reservations', async () => {
      lockedRows = [lockedRow(4)];
      countRows = [{ conflicting: '0' }];
      updatedRows = [detailRow(2)];

      await changeAdminRoomTypeCapacity(SLUG, 2);

      for (const call of calls) {
        assert.doesNotMatch(call.text, /UPDATE reservations|DELETE FROM reservations/i);
      }
    });

    it('releases the client', async () => {
      lockedRows = [lockedRow(4)];
      countRows = [{ conflicting: '0' }];
      updatedRows = [detailRow(2)];

      await changeAdminRoomTypeCapacity(SLUG, 2);

      assert.equal(released, 1);
    });
  });

  describe('a missing room type', () => {
    it('rolls back and reports not-found', async () => {
      lockedRows = [];

      const result = await changeAdminRoomTypeCapacity(SLUG, 2);

      assert.deepEqual(result, { outcome: 'not-found' });
      assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'ROLLBACK']);
      assert.equal(released, 1);
    });
  });

  describe('raising or keeping capacity', () => {
    it('skips the conflict count when raising', async () => {
      lockedRows = [lockedRow(2)];
      updatedRows = [detailRow(4)];

      const result = await changeAdminRoomTypeCapacity(SLUG, 4);

      assert.equal(result.outcome, 'updated');
      assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'UPDATE', 'READBACK', 'COMMIT']);
      assert.ok(!conflictCount(), 'no existing party can stop fitting in a larger room');
    });

    it('skips the conflict count when the value is unchanged, and still updates', async () => {
      lockedRows = [lockedRow(2)];
      updatedRows = [detailRow(2)];

      const result = await changeAdminRoomTypeCapacity(SLUG, 2);

      assert.equal(result.outcome, 'updated');
      assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'UPDATE', 'READBACK', 'COMMIT']);
      assert.ok(!conflictCount());
    });
  });

  describe('lowering capacity', () => {
    it('updates when nothing conflicts', async () => {
      lockedRows = [lockedRow(4)];
      countRows = [{ conflicting: '0' }];
      updatedRows = [detailRow(2)];

      const result = await changeAdminRoomTypeCapacity(SLUG, 2);

      assert.equal(result.outcome, 'updated');
      assert.equal(result.outcome === 'updated' && result.roomType.capacity, 2);
    });

    it('counts against the locked id and the proposed capacity', async () => {
      lockedRows = [lockedRow(4)];
      countRows = [{ conflicting: '0' }];
      updatedRows = [detailRow(2)];

      await changeAdminRoomTypeCapacity(SLUG, 2);

      const count = conflictCount()!;
      assert.deepEqual(count.values, ['7', 2]);
      assert.match(count.text, /status IN \('pending', 'confirmed'\)/);
      assert.match(count.text, /check_out > UTC_DATE\(\)/);
    });

    it('refuses and rolls back when an upcoming stay would no longer fit', async () => {
      lockedRows = [lockedRow(4)];
      countRows = [{ conflicting: '3' }];

      const result = await changeAdminRoomTypeCapacity(SLUG, 2);

      assert.deepEqual(result, { outcome: 'capacity-conflict' });
      assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'COUNT', 'ROLLBACK']);
      assert.ok(!statementMatching(/^\s*UPDATE/), 'nothing may be written when the change is refused');
      assert.equal(released, 1);
    });

    it('carries no guest or reservation data in the refusal', async () => {
      lockedRows = [lockedRow(4)];
      countRows = [{ conflicting: '3' }];

      const result = await changeAdminRoomTypeCapacity(SLUG, 2);

      assert.deepEqual(Object.keys(result), ['outcome']);
    });
  });

  describe('failure handling', () => {
    it('rolls back and releases when the count fails', async () => {
      lockedRows = [lockedRow(4)];
      failOn = 'SELECT COUNT';

      await assert.rejects(() => changeAdminRoomTypeCapacity(SLUG, 2));

      assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'COUNT', 'ROLLBACK']);
      assert.equal(released, 1);
    });

    it('rolls back and releases when the update fails', async () => {
      lockedRows = [lockedRow(4)];
      countRows = [{ conflicting: '0' }];
      failOn = 'UPDATE';

      await assert.rejects(() => changeAdminRoomTypeCapacity(SLUG, 2));

      assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'COUNT', 'UPDATE', 'ROLLBACK']);
      assert.equal(released, 1);
    });

    it('releases even when BEGIN itself fails', async () => {
      failOn = 'BEGIN';

      await assert.rejects(() => changeAdminRoomTypeCapacity(SLUG, 2));

      assert.equal(released, 1);
    });

    it('treats a vanished row under its own lock as a fault', async () => {
      lockedRows = [lockedRow(2)];
      updatedRows = [];

      await assert.rejects(() => changeAdminRoomTypeCapacity(SLUG, 2), /vanished/);
      assert.equal(released, 1);
    });
  });
});
