import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { generateBookingReference } from '../src/modules/reservations/booking-reference';

// Exercises the status transition against a real PostgreSQL database, including
// its row locking: the concurrency cases below start two transactions at once
// on separate pool clients, which is the only way `FOR UPDATE` can be shown to
// do anything.
//
// It creates its own room type, rooms and reservations with identifiers unique
// to this run and removes exactly those afterwards.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');
type ServiceModule = typeof import('../src/modules/admin-reservations/admin-reservations.service.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let changeAdminReservationStatus: ServiceModule['changeAdminReservationStatus'];

const runId = randomUUID().slice(0, 8);

const fixture = {
  slug: `itest-status-${runId}`,
  name: `Status Room ${runId}`,
  nightlyRate: '1234.50',
  totalAmount: '2469.00',
  roomNumbers: [`IT-ST-${runId}-1`, `IT-ST-${runId}-2`, `IT-ST-${runId}-3`, `IT-ST-${runId}-4`],
};

let roomTypeId: string;
let roomIds: string[] = [];

const DAY_MS = 86_400_000;
/** 2099-03-01, far beyond anything real and fixed so runs are identical. */
const STAY_BASE_UTC = Date.UTC(2099, 2, 1);
let stayOffset = 0;

const toCalendarDay = (instant: number) => new Date(instant).toISOString().slice(0, 10);

/**
 * The next unused one-night stay.
 *
 * Dates are computed from a UTC base rather than by incrementing a day number:
 * arithmetic on the instant rolls over month and year ends correctly, where
 * counting days within a hard-coded month silently walks off the end of it and
 * produces something PostgreSQL rightly refuses.
 *
 * Each fixture takes the next pair of days, so no two stays overlap however
 * many a test creates, and `toISOString` makes the formatting independent of
 * the machine's timezone.
 */
function nextStay(): { checkIn: string; checkOut: string } {
  const checkIn = STAY_BASE_UTC + stayOffset * DAY_MS;
  const checkOut = checkIn + DAY_MS;

  stayOffset += 2;

  return { checkIn: toCalendarDay(checkIn), checkOut: toCalendarDay(checkOut) };
}

type ReservationRow = {
  status: string;
  room_id: string;
  check_in: string;
  check_out: string;
  total_amount: string;
  nightly_rate_snapshot: string;
  created_at: Date;
  updated_at: Date;
};

async function insertReservation(status: 'pending' | 'confirmed' | 'cancelled', roomIndex = 0): Promise<string> {
  const bookingReference = generateBookingReference();
  const { checkIn, checkOut } = nextStay();

  await dbPool.query(
    `INSERT INTO reservations (
       booking_reference, room_type_id, room_id,
       guest_first_name, guest_last_name, guest_email, guest_phone, guest_country,
       adults, children, check_in, check_out,
       status, currency, nightly_rate_snapshot, total_amount, special_requests
     )
     VALUES ($1, $2, $3, 'Amelia', 'Hartwell', $4, '+201000000000', 'Egypt',
             2, 0, $5::date, $6::date, $7, 'EGP', $8, $9, 'Late arrival')`,
    [
      bookingReference,
      roomTypeId,
      roomIds[roomIndex],
      `guest-${runId}@example.com`,
      checkIn,
      checkOut,
      status,
      fixture.nightlyRate,
      fixture.totalAmount,
    ],
  );

  return bookingReference;
}

async function readReservation(bookingReference: string): Promise<ReservationRow> {
  const { rows } = await dbPool.query<ReservationRow>(
    `SELECT status, room_id, check_in::text AS check_in, check_out::text AS check_out,
            total_amount::text AS total_amount, nightly_rate_snapshot::text AS nightly_rate_snapshot,
            created_at, updated_at
       FROM reservations
      WHERE booking_reference = $1`,
    [bookingReference],
  );

  const row = rows[0];
  assert.ok(row, `fixture reservation ${bookingReference} is missing`);

  return row;
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  ({ changeAdminReservationStatus } = await import(
    '../src/modules/admin-reservations/admin-reservations.service.js'
  ));

  const { rows: roomTypeRows } = await dbPool.query<{ id: string }>(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, 2, $3, true, 0)
     RETURNING id`,
    [fixture.slug, fixture.name, fixture.nightlyRate],
  );

  const createdRoomType = roomTypeRows[0];
  assert.ok(createdRoomType, 'failed to create the fixture room type');
  roomTypeId = createdRoomType.id;

  const { rows: roomRows } = await dbPool.query<{ id: string }>(
    `INSERT INTO rooms (room_type_id, room_number, is_active)
     VALUES ($1, $2, true), ($1, $3, true), ($1, $4, true), ($1, $5, true)
     RETURNING id`,
    [roomTypeId, ...fixture.roomNumbers],
  );

  roomIds = roomRows.map((row) => row.id);
  assert.equal(roomIds.length, 4, 'expected exactly four fixture rooms');
});

after(async () => {
  try {
    await dbPool.query('DELETE FROM reservations WHERE room_type_id = $1', [roomTypeId]);
    await dbPool.query('DELETE FROM rooms WHERE room_type_id = $1', [roomTypeId]);
    await dbPool.query('DELETE FROM room_types WHERE id = $1', [roomTypeId]);

    const { rows } = await dbPool.query<{ reservations: number; rooms: number; room_types: number }>(
      `SELECT (SELECT COUNT(*) FROM reservations WHERE room_type_id = $1)::int AS reservations,
              (SELECT COUNT(*) FROM rooms WHERE room_type_id = $1)::int AS rooms,
              (SELECT COUNT(*) FROM room_types WHERE id = $1)::int AS room_types`,
      [roomTypeId],
    );

    assert.deepEqual(rows[0], { reservations: 0, rooms: 0, room_types: 0 }, 'fixtures were not fully removed');
  } finally {
    await closeDatabasePool();
  }
});

describe('changeAdminReservationStatus against PostgreSQL', () => {
  describe('persists a permitted transition', () => {
    const permitted: ['pending' | 'confirmed', 'confirmed' | 'cancelled'][] = [
      ['pending', 'confirmed'],
      ['pending', 'cancelled'],
      ['confirmed', 'cancelled'],
    ];

    for (const [from, to] of permitted) {
      it(`${from} -> ${to}`, async () => {
        const reference = await insertReservation(from);

        const result = await changeAdminReservationStatus(reference, to);

        assert.equal(result.outcome, 'updated');
        assert.ok(result.outcome === 'updated');
        assert.equal(result.reservation.bookingReference, reference);
        assert.equal(result.reservation.status, to);
        assert.equal((await readReservation(reference)).status, to, 'the change must be committed');
      });
    }

    it('returns a valid instant that matches the stored updated_at', async () => {
      const reference = await insertReservation('pending');
      const before = await readReservation(reference);

      const result = await changeAdminReservationStatus(reference, 'confirmed');
      assert.ok(result.outcome === 'updated');

      assert.match(result.reservation.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      const after = await readReservation(reference);
      assert.equal(result.reservation.updatedAt, after.updated_at.toISOString());
      assert.ok(after.updated_at.getTime() >= before.updated_at.getTime(), 'updated_at must move forward');
      assert.equal(after.created_at.getTime(), before.created_at.getTime(), 'created_at must not move');
    });

    it('changes nothing but the status and updated_at', async () => {
      const reference = await insertReservation('pending');
      const before = await readReservation(reference);

      await changeAdminReservationStatus(reference, 'cancelled');

      const after = await readReservation(reference);
      assert.equal(after.room_id, before.room_id, 'the allocated room must not move');
      assert.equal(after.check_in, before.check_in);
      assert.equal(after.check_out, before.check_out);
      assert.equal(after.total_amount, before.total_amount);
      assert.equal(after.nightly_rate_snapshot, before.nightly_rate_snapshot);
    });
  });

  describe('refuses a forbidden transition', () => {
    const forbidden: ['confirmed' | 'cancelled', 'confirmed' | 'cancelled'][] = [
      ['confirmed', 'confirmed'],
      ['cancelled', 'cancelled'],
      ['cancelled', 'confirmed'],
    ];

    for (const [from, to] of forbidden) {
      it(`${from} -> ${to} leaves the row untouched`, async () => {
        const reference = await insertReservation(from);
        const before = await readReservation(reference);

        const result = await changeAdminReservationStatus(reference, to);

        assert.deepEqual(result, { outcome: 'invalid-transition' });

        const after = await readReservation(reference);
        assert.equal(after.status, from, 'the status must not change');
        assert.equal(
          after.updated_at.getTime(),
          before.updated_at.getTime(),
          'a refused transition must not touch updated_at',
        );
      });
    }
  });

  describe('distinguishes a missing reservation', () => {
    it('reports not-found for a canonical reference nobody booked', async () => {
      const result = await changeAdminReservationStatus(generateBookingReference(), 'confirmed');

      assert.deepEqual(result, { outcome: 'not-found' });
    });

    it('keeps not-found and invalid-transition apart', async () => {
      const cancelled = await insertReservation('cancelled');

      const missing = await changeAdminReservationStatus(generateBookingReference(), 'cancelled');
      const forbidden = await changeAdminReservationStatus(cancelled, 'cancelled');

      assert.equal(missing.outcome, 'not-found');
      assert.equal(forbidden.outcome, 'invalid-transition');
    });
  });

  // These are the only tests that can show the lock working. Both calls are
  // started before either is awaited, so they contend for the same row on two
  // separate pool clients; sequencing them would prove nothing.
  describe('serializes concurrent changes on one reservation', () => {
    it('lets exactly one of two simultaneous confirms win', async () => {
      const reference = await insertReservation('pending');

      const [first, second] = await Promise.all([
        changeAdminReservationStatus(reference, 'confirmed'),
        changeAdminReservationStatus(reference, 'confirmed'),
      ]);

      const outcomes = [first.outcome, second.outcome].sort();
      assert.deepEqual(outcomes, ['invalid-transition', 'updated'], 'exactly one confirm may succeed');
      assert.equal((await readReservation(reference)).status, 'confirmed');
    });

    it('lets exactly one of two simultaneous cancels win', async () => {
      const reference = await insertReservation('pending');

      const [first, second] = await Promise.all([
        changeAdminReservationStatus(reference, 'cancelled'),
        changeAdminReservationStatus(reference, 'cancelled'),
      ]);

      const outcomes = [first.outcome, second.outcome].sort();
      assert.deepEqual(outcomes, ['invalid-transition', 'updated'], 'exactly one cancel may succeed');
      assert.equal((await readReservation(reference)).status, 'cancelled');
    });

    it('serializes a simultaneous confirm and cancel into a legal history', async () => {
      const reference = await insertReservation('pending');

      const [confirm, cancel] = await Promise.all([
        changeAdminReservationStatus(reference, 'confirmed'),
        changeAdminReservationStatus(reference, 'cancelled'),
      ]);

      const finalStatus = (await readReservation(reference)).status;

      // Which one takes the lock first is PostgreSQL's to decide, so both
      // histories are correct and neither is forced:
      //
      //   confirm first: pending -> confirmed, then confirmed -> cancelled.
      //                  Both succeed and the stay ends cancelled.
      //   cancel first:  pending -> cancelled, then cancelled -> confirmed is
      //                  forbidden, so the confirm is refused.
      if (confirm.outcome === 'updated' && cancel.outcome === 'updated') {
        assert.equal(finalStatus, 'cancelled', 'confirm won the lock, then the cancel applied');
        return;
      }

      assert.equal(cancel.outcome, 'updated', 'the cancel took the lock first');
      assert.equal(confirm.outcome, 'invalid-transition', 'cancelled is terminal, so the confirm must be refused');
      assert.equal(finalStatus, 'cancelled');
    });

    it('never loses an update when many attempts race', async () => {
      const reference = await insertReservation('pending');

      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => changeAdminReservationStatus(reference, 'cancelled')),
      );

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      assert.equal(fulfilled.length, results.length, 'no attempt may fail outright');

      const updated = fulfilled.filter(
        (result) => (result as PromiseFulfilledResult<{ outcome: string }>).value.outcome === 'updated',
      );

      assert.equal(updated.length, 1, 'exactly one attempt may change the row');
      assert.equal((await readReservation(reference)).status, 'cancelled');
    });
  });
});
