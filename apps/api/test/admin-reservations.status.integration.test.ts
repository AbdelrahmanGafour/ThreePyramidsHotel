import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { insertedId, toNumbers } from './support/core-sql';
import { generateBookingReference } from '../src/modules/reservations/booking-reference';

// Exercises the status transition against a real MySQL database, including
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
 * produces something MySQL rightly refuses.
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
             2, 0, $5, $6, $7, 'EGP', $8, $9, 'Late arrival')`,
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
    `SELECT status, room_id, check_in AS check_in, check_out AS check_out,
            total_amount AS total_amount, nightly_rate_snapshot AS nightly_rate_snapshot,
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

  const createdRoomType = await dbPool.query(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, 2, $3, true, 0)`,
    [fixture.slug, fixture.name, fixture.nightlyRate],
  );

  roomTypeId = insertedId(createdRoomType);

  await dbPool.query(
    `INSERT INTO rooms (room_type_id, room_number, is_active)
     VALUES ($1, $2, true), ($1, $3, true), ($1, $4, true), ($1, $5, true)`,
    [roomTypeId, ...fixture.roomNumbers],
  );

  const { rows: roomRows } = await dbPool.query<{ id: string }>(
    'SELECT id FROM rooms WHERE room_type_id = $1 ORDER BY id',
    [roomTypeId],
  );

  roomIds = roomRows.map((row) => row.id);
  assert.equal(roomIds.length, 4, 'expected exactly four fixture rooms');
});

after(async () => {
  try {
    // Confirming a reservation now also queues a guest notification. Those
    // rows hold no foreign key, so nothing would obstruct the deletes below
    // and nothing would ever clean them up either — they have to be collected
    // while the reservations that name them still exist.
    const { rows: booked } = await dbPool.query<{ booking_reference: string }>(
      'SELECT booking_reference FROM reservations WHERE room_type_id = $1',
      [roomTypeId],
    );
    const references = booked.map((row) => row.booking_reference);

    await dbPool.query('DELETE FROM notification_outbox WHERE booking_reference IN ($1)', [
      references,
    ]);
    await dbPool.query('DELETE FROM reservations WHERE room_type_id = $1', [roomTypeId]);
    await dbPool.query('DELETE FROM rooms WHERE room_type_id = $1', [roomTypeId]);
    await dbPool.query('DELETE FROM room_types WHERE id = $1', [roomTypeId]);

    const { rows } = await dbPool.query<{
      reservations: number;
      rooms: number;
      room_types: number;
      notifications: number;
    }>(
      `SELECT (SELECT COUNT(*) FROM reservations WHERE room_type_id = $1) AS reservations,
              (SELECT COUNT(*) FROM rooms WHERE room_type_id = $1) AS rooms,
              (SELECT COUNT(*) FROM room_types WHERE id = $1) AS room_types,
              (SELECT COUNT(*) FROM notification_outbox
                WHERE booking_reference IN ($2)) AS notifications`,
      [roomTypeId, references],
    );

    assert.deepEqual(
      rows[0] && toNumbers(rows[0]),
      { reservations: 0, rooms: 0, room_types: 0, notifications: 0 },
      'fixtures were not fully removed',
    );
  } finally {
    await closeDatabasePool();
  }
});

describe('changeAdminReservationStatus against MySQL', () => {
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

      // Which one takes the lock first is MySQL's to decide, so both
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

  // The three claims about the guest confirmation that only a real database
  // can settle. Ordering and the "confirm only" rule are proved against a
  // double in `admin-reservations.notification.test.ts` and not repeated here.
  describe('the guest confirmation notification', () => {
    it('commits the confirmed status and the event together', async () => {
      const reference = await insertReservation('pending');

      const result = await changeAdminReservationStatus(reference, 'confirmed');
      assert.equal(result.outcome, 'updated');

      // Read back after COMMIT, so both of these are durable facts.
      assert.equal((await readReservation(reference)).status, 'confirmed');

      const { rows } = await dbPool.query<{
        event_type: string;
        recipient_kind: string;
        recipient_email: string | null;
        template_key: string;
        attempts: number;
        payload: Record<string, unknown>;
      }>(
        `SELECT event_type, recipient_kind, recipient_email, template_key, attempts, payload
           FROM notification_outbox
          WHERE booking_reference = $1`,
        [reference],
      );

      assert.equal(rows.length, 1, 'exactly one event for the confirmed booking');

      const event = rows[0];
      assert.ok(event, 'the event row is readable after COMMIT');
      assert.equal(event.event_type, 'room_reservation_confirmed');
      assert.equal(event.recipient_kind, 'guest');
      assert.equal(event.recipient_email, `guest-${runId}@example.com`);
      assert.equal(event.template_key, 'room_confirmed_guest.v1');
      assert.equal(event.attempts, 0, 'queued, not attempted');

      // The payload agrees with the row that was locked, not with a re-read.
      assert.equal(event.payload.bookingReference, reference);
      assert.equal(event.payload.roomTypeName, fixture.name);
      assert.equal(event.payload.nightlyRate, fixture.nightlyRate);
      assert.equal(event.payload.totalAmount, fixture.totalAmount);
      assert.equal(event.payload.nights, 1, 'the stay is one night, counted by the database');
      assert.ok(!('guestEmail' in event.payload), 'the address is the envelope, not the content');
    });

    it('queues nothing for a cancellation', async () => {
      const reference = await insertReservation('pending');

      const result = await changeAdminReservationStatus(reference, 'cancelled');
      assert.equal(result.outcome, 'updated');
      assert.equal((await readReservation(reference)).status, 'cancelled');

      const { rows } = await dbPool.query<{ total: number }>(
        'SELECT COUNT(*) AS total FROM notification_outbox WHERE booking_reference = $1',
        [reference],
      );

      assert.equal(Number(rows[0]?.total), 0, 'a cancellation owes the guest no message from this slice');
    });

    it('leaves the reservation pending when the event cannot be written', async () => {
      // A real connection, real SQL and a real transaction — only the one
      // notification INSERT is made to fail, which is the one thing a healthy
      // MySQL will not do on request. A double cannot prove this: the
      // question is whether the ROLLBACK actually discarded an UPDATE the
      // database had already applied, and only the database can answer it.
      const reference = await insertReservation('pending');
      const failure = Object.assign(new Error('simulated outbox failure'), { code: '23505' });

      const originalConnect = dbPool.connect.bind(dbPool);
      let attempts = 0;
      // Held on an object rather than in a plain `let`: the assignment happens
      // inside the factory closure below, which TypeScript's control flow
      // cannot see, so a narrowed local would still read as `null` here.
      const patch: { client: { query?: unknown } | null } = { client: null };

      (dbPool as unknown as { connect: unknown }).connect = async () => {
        const client = await originalConnect();
        const realQuery = client.query.bind(client);

        patch.client = client as unknown as { query?: unknown };
        Object.assign(client, {
          query(text: unknown, ...rest: unknown[]) {
            if (typeof text === 'string' && text.includes('INSERT INTO notification_outbox')) {
              attempts += 1;
              // Undone as it fires, so this connection is clean before the
              // service releases it back into the pool. Leaving an own `query`
              // that rejects every outbox insert would sabotage whichever
              // later test was handed this connection.
              Object.assign(client, { query: realQuery });
              return Promise.reject(failure);
            }
            return (realQuery as (...args: unknown[]) => unknown)(text, ...rest);
          },
        });

        return client;
      };

      try {
        // Not released here: the service owns and releases the client it
        // acquires, and a second release would return it to the pool twice.
        const thrown = await changeAdminReservationStatus(reference, 'confirmed').then(
          () => null,
          (error: unknown) => error,
        );

        assert.equal(thrown, failure, 'the original error reached the caller');
        assert.equal(attempts, 1, 'no retry');
      } finally {
        (dbPool as unknown as { connect: unknown }).connect = originalConnect;
        if (patch.client) {
          delete patch.client.query;
        }
      }

      // Asked on an ordinary pooled connection, so it can only see committed
      // data: the UPDATE was rolled back with the event it could not queue.
      assert.equal((await readReservation(reference)).status, 'pending');

      const { rows } = await dbPool.query<{ total: number }>(
        'SELECT COUNT(*) AS total FROM notification_outbox WHERE booking_reference = $1',
        [reference],
      );

      assert.equal(Number(rows[0]?.total), 0, 'no event survived either');
    });
  });
});
