import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

// Covers the transaction's shape and its three outcomes without a database:
// `dbPool.connect` is swapped for a client that records statements and returns
// programmed rows, so the real service runs and the sequence it issues can be
// inspected.
//
// What this cannot test is the lock itself. `FOR UPDATE` only means something
// against real PostgreSQL, so the serialization it buys is proven in
// admin-reservations.status.integration.test.ts and nowhere here.
type ServiceModule = typeof import('../src/modules/admin-reservations/admin-reservations.service.js');
type Pool = typeof import('../src/db/pool.js');

let changeAdminReservationStatus: ServiceModule['changeAdminReservationStatus'];
let dbPool: Pool['dbPool'];

type RecordedCall = { text: string; values: unknown[] };

let calls: RecordedCall[] = [];
let released = 0;
/** Rows the next SELECT ... FOR UPDATE and UPDATE return, in that order. */
let lockedRows: unknown[] = [];
let updatedRows: unknown[] = [];
let failOn: string | null = null;

const REFERENCE = 'TPH-A2B3C4D5E6F7';
const UPDATED_AT = new Date('2026-09-20T18:45:22.411Z');

const updatedRow = (status: string) => ({
  booking_reference: REFERENCE,
  status,
  updated_at: UPDATED_AT,
});

/** The statements issued, reduced to their first keyword for readability. */
const sequence = () =>
  calls.map((call) => {
    const text = call.text.trim();

    if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
      return text;
    }

    return text.startsWith('SELECT') ? 'SELECT' : 'UPDATE';
  });

const statementStartingWith = (keyword: string) => calls.find((call) => call.text.trim().startsWith(keyword));

before(async () => {
  // The service's module graph reaches db/pool, which requires DATABASE_URL at
  // import time. Nothing here connects: the pool's connect is replaced before
  // any call, and a placeholder is enough to load the module.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ dbPool } = await import('../src/db/pool.js'));
  ({ changeAdminReservationStatus } = await import(
    '../src/modules/admin-reservations/admin-reservations.service.js'
  ));

  // node:test runs each file in its own process, so this cannot reach another
  // suite. Nothing restores it because nothing else in this file needs a pool.
  (dbPool as unknown as { connect: unknown }).connect = () =>
    Promise.resolve({
      query: (text: string, values: unknown[] = []) => {
        calls.push({ text, values });

        const trimmed = text.trim();

        if (failOn && trimmed.startsWith(failOn)) {
          return Promise.reject(new Error(`database failure during ${failOn}`));
        }
        if (trimmed.startsWith('SELECT')) {
          return Promise.resolve({ rows: lockedRows });
        }
        if (trimmed.startsWith('UPDATE')) {
          return Promise.resolve({ rows: updatedRows });
        }

        return Promise.resolve({ rows: [] });
      },
      release: () => {
        released += 1;
      },
    });
});

after(() => {
  assert.ok(released > 0, 'the suite should have exercised the client lifecycle');
});

beforeEach(() => {
  calls = [];
  released = 0;
  lockedRows = [];
  updatedRows = [];
  failOn = null;
});

describe('changeAdminReservationStatus', () => {
  describe('the transaction it runs', () => {
    it('locks the row, updates it and commits, in that order', async () => {
      lockedRows = [{ status: 'pending' }];
      updatedRows = [updatedRow('confirmed')];

      await changeAdminReservationStatus(REFERENCE, 'confirmed');

      assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
    });

    it('takes the row lock rather than reading it unlocked', async () => {
      lockedRows = [{ status: 'pending' }];
      updatedRows = [updatedRow('cancelled')];

      await changeAdminReservationStatus(REFERENCE, 'cancelled');

      const select = statementStartingWith('SELECT');
      assert.ok(select, 'expected a SELECT');
      assert.match(select.text, /FOR UPDATE/);
      assert.match(select.text, /WHERE booking_reference = \$1/);
      // A case-insensitive lookup would also defeat the unique index.
      assert.doesNotMatch(select.text, /lower\(|upper\(|ILIKE/i);
    });

    it('passes the reference and status as parameters, never as SQL text', async () => {
      lockedRows = [{ status: 'pending' }];
      updatedRows = [updatedRow('confirmed')];

      await changeAdminReservationStatus(REFERENCE, 'confirmed');

      const select = statementStartingWith('SELECT')!;
      const update = statementStartingWith('UPDATE')!;

      assert.deepEqual(select.values, [REFERENCE]);
      assert.deepEqual(update.values, [REFERENCE, 'confirmed']);
      assert.ok(!select.text.includes(REFERENCE));
      assert.ok(!update.text.includes(REFERENCE));
      assert.ok(!update.text.includes('confirmed'), 'the status must not be interpolated');
    });

    it('writes the status and updated_at, and nothing else', async () => {
      lockedRows = [{ status: 'pending' }];
      updatedRows = [updatedRow('cancelled')];

      await changeAdminReservationStatus(REFERENCE, 'cancelled');

      const update = statementStartingWith('UPDATE')!;
      assert.match(update.text, /SET status = \$2/);
      // No trigger maintains it, so the statement must.
      assert.match(update.text, /updated_at = now\(\)/);
      assert.match(update.text, /WHERE booking_reference = \$1/);

      for (const untouched of ['room_id', 'room_type_id', 'check_in', 'check_out', 'total_amount', 'nightly_rate']) {
        assert.ok(!update.text.includes(untouched), `${untouched} must not be written`);
      }
    });

    it('encodes no transition rule in SQL', async () => {
      lockedRows = [{ status: 'pending' }];
      updatedRows = [updatedRow('confirmed')];

      await changeAdminReservationStatus(REFERENCE, 'confirmed');

      // The policy module is the only place the matrix lives; a WHERE clause
      // naming statuses would be a second, divergent copy of it.
      const update = statementStartingWith('UPDATE')!;
      assert.ok(!update.text.includes("'pending'"), 'no status literal belongs in the UPDATE');
      assert.ok(!update.text.includes('status IN'), 'no status guard belongs in the UPDATE');
    });

    it('releases the client', async () => {
      lockedRows = [{ status: 'pending' }];
      updatedRows = [updatedRow('confirmed')];

      await changeAdminReservationStatus(REFERENCE, 'confirmed');

      assert.equal(released, 1);
    });
  });

  describe('permitted transitions', () => {
    const permitted: [string, 'confirmed' | 'cancelled'][] = [
      ['pending', 'confirmed'],
      ['pending', 'cancelled'],
      ['confirmed', 'cancelled'],
    ];

    for (const [from, to] of permitted) {
      it(`${from} -> ${to} updates and returns the change`, async () => {
        lockedRows = [{ status: from }];
        updatedRows = [updatedRow(to)];

        const result = await changeAdminReservationStatus(REFERENCE, to);

        assert.equal(result.outcome, 'updated');
        assert.ok(result.outcome === 'updated');
        assert.deepEqual(result.reservation, {
          bookingReference: REFERENCE,
          status: to,
          updatedAt: UPDATED_AT.toISOString(),
        });
        assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
      });
    }

    it('returns only the reference, status and updatedAt', async () => {
      lockedRows = [{ status: 'pending' }];
      updatedRows = [{ ...updatedRow('confirmed'), id: '42', room_id: '7', guest_email: 'a@b.c' }];

      const result = await changeAdminReservationStatus(REFERENCE, 'confirmed');
      assert.ok(result.outcome === 'updated');

      assert.deepEqual(Object.keys(result.reservation).sort(), ['bookingReference', 'status', 'updatedAt']);
      for (const leaked of ['id', 'roomId', 'room_id', 'guestEmail', 'previousStatus']) {
        assert.ok(!(leaked in result.reservation), `${leaked} must not be returned`);
      }
    });

    it('returns updatedAt as an ISO instant', async () => {
      lockedRows = [{ status: 'confirmed' }];
      updatedRows = [updatedRow('cancelled')];

      const result = await changeAdminReservationStatus(REFERENCE, 'cancelled');
      assert.ok(result.outcome === 'updated');

      assert.match(result.reservation.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('refused transitions', () => {
    const forbidden: [string, 'confirmed' | 'cancelled'][] = [
      ['confirmed', 'confirmed'],
      ['cancelled', 'cancelled'],
      ['cancelled', 'confirmed'],
    ];

    for (const [from, to] of forbidden) {
      it(`${from} -> ${to} is refused without writing`, async () => {
        lockedRows = [{ status: from }];

        const result = await changeAdminReservationStatus(REFERENCE, to);

        assert.deepEqual(result, { outcome: 'invalid-transition' });
        assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'ROLLBACK'], 'no UPDATE may be issued');
      });
    }

    it('does not treat a same-state request as a quiet success', async () => {
      lockedRows = [{ status: 'confirmed' }];

      const result = await changeAdminReservationStatus(REFERENCE, 'confirmed');

      assert.notEqual(result.outcome, 'updated');
    });
  });

  describe('a reservation that does not exist', () => {
    it('is reported as not-found, distinctly from a refused transition', async () => {
      lockedRows = [];

      const result = await changeAdminReservationStatus(REFERENCE, 'confirmed');

      assert.deepEqual(result, { outcome: 'not-found' });
      assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'ROLLBACK']);
    });
  });

  describe('a fault', () => {
    it('raises rather than becoming not-found or invalid-transition', async () => {
      lockedRows = [{ status: 'pending' }];
      failOn = 'UPDATE';

      await assert.rejects(() => changeAdminReservationStatus(REFERENCE, 'confirmed'), /database failure/);
      assert.ok(sequence().includes('ROLLBACK'), 'the transaction must be rolled back');
      assert.equal(released, 1, 'the client must still be released');
    });

    it('raises when the stored status is not one the schema allows', async () => {
      // A row the CHECK constraint says cannot exist. Reported loudly, never
      // softened into "this transition is not allowed".
      lockedRows = [{ status: 'checked-in' }];

      await assert.rejects(() => changeAdminReservationStatus(REFERENCE, 'cancelled'), /status/);
      assert.ok(sequence().includes('ROLLBACK'));
      assert.equal(released, 1);
    });

    it('raises when the stored status is missing entirely', async () => {
      lockedRows = [{ status: null }];

      await assert.rejects(() => changeAdminReservationStatus(REFERENCE, 'cancelled'), /status/);
      assert.equal(released, 1);
    });
  });
});
