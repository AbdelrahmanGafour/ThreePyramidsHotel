import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

// The guest confirmation's outbox wiring, against a scripted client.
//
// Everything here is about WHEN an event is written and when it is not: only
// on a confirmation, only after the UPDATE, only before the COMMIT, and never
// at all for a cancellation, a refused transition or a reservation that does
// not exist. None of that is visible from outside the service, and a strict
// insert cannot be made to fail against a healthy PostgreSQL, so the client is
// a double.
//
// Scope is Event 2 only — `room_reservation_confirmed`, to the guest. The
// transaction's own shape and its three outcomes are covered in
// `admin-reservations.status-change.test.ts`; this file does not repeat them.
//
// `dbPool.connect` is swapped rather than a service seam, matching the
// harness that file already established for this module.

type ServiceModule = typeof import('../src/modules/admin-reservations/admin-reservations.service.js');
type Pool = typeof import('../src/db/pool.js');

let changeAdminReservationStatus: ServiceModule['changeAdminReservationStatus'];
let dbPool: Pool['dbPool'];

type RecordedCall = { text: string; values: unknown[] };

let calls: RecordedCall[] = [];
/** Every distinct client object a statement was issued on. */
let clients: Set<unknown> = new Set();
let lockedRows: unknown[] = [];
let updatedRows: unknown[] = [];
let outboxError: unknown = null;

const REFERENCE = 'TPH-A2B3C4D5E6F7';
const GUEST_EMAIL = 'amina@example.test';
const UPDATED_AT = new Date('2026-09-20T18:45:22.411Z');

const updatedRow = (status: string) => ({
  booking_reference: REFERENCE,
  status,
  updated_at: UPDATED_AT,
});

/** A locked reservation row, as the widened `FOR UPDATE` read returns it. */
const lockedRow = (status: string) => ({
  status,
  guest_first_name: 'Amina',
  guest_last_name: 'Khalil',
  guest_email: GUEST_EMAIL,
  room_type_name: 'Nile View Suite',
  check_in: '2030-04-10',
  check_out: '2030-04-13',
  nights: 3,
  adults: 2,
  children: 1,
  nightly_rate: '4200.00',
  total_amount: '12600.00',
  special_requests: 'Late arrival, around 23:00.',
});

const sequence = () =>
  calls.map((call) => {
    const text = call.text.trim();

    if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
      return text;
    }
    if (text.startsWith('INSERT INTO notification_outbox')) {
      return 'OUTBOX';
    }

    return text.startsWith('SELECT') ? 'SELECT' : 'UPDATE';
  });

const outboxCalls = () => calls.filter((call) => call.text.includes('INSERT INTO notification_outbox'));

before(async () => {
  // The module graph reaches db/pool, which reads the environment at import
  // time. Nothing connects: connect is replaced before any call.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ dbPool } = await import('../src/db/pool.js'));
  ({ changeAdminReservationStatus } = await import(
    '../src/modules/admin-reservations/admin-reservations.service.js'
  ));

  (dbPool as unknown as { connect: unknown }).connect = () => {
    const client = {
      query: (text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        clients.add(client);

        const trimmed = text.trim();

        if (trimmed.startsWith('INSERT INTO notification_outbox')) {
          return outboxError ? Promise.reject(outboxError) : Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (trimmed.startsWith('SELECT')) {
          return Promise.resolve({ rows: lockedRows });
        }
        if (trimmed.startsWith('UPDATE')) {
          return Promise.resolve({ rows: updatedRows });
        }

        return Promise.resolve({ rows: [] });
      },
      release: () => undefined,
    };

    return Promise.resolve(client);
  };
});

beforeEach(() => {
  calls = [];
  clients = new Set();
  lockedRows = [];
  updatedRows = [];
  outboxError = null;
});

describe('confirming a reservation queues the guest notification', () => {
  it('writes exactly one event', async () => {
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];

    await changeAdminReservationStatus(REFERENCE, 'confirmed');

    assert.equal(outboxCalls().length, 1);
  });

  it('writes it on the same client as the status change', async () => {
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];

    await changeAdminReservationStatus(REFERENCE, 'confirmed');

    // One connection for the whole flow. A second would put the event in a
    // different transaction, able to commit while the status change did not.
    assert.equal(clients.size, 1);
  });

  it('places it after the UPDATE and before the COMMIT', async () => {
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];

    await changeAdminReservationStatus(REFERENCE, 'confirmed');

    assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'UPDATE', 'OUTBOX', 'COMMIT']);
  });

  it('carries the room-confirmed guest identity', async () => {
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];

    await changeAdminReservationStatus(REFERENCE, 'confirmed');

    const [eventType, bookingReference, recipientKind, recipientEmail, templateKey] =
      outboxCalls()[0]?.values ?? [];

    assert.equal(eventType, 'room_reservation_confirmed');
    assert.equal(bookingReference, REFERENCE);
    assert.equal(recipientKind, 'guest');
    assert.equal(templateKey, 'room_confirmed_guest.v1');
  });

  it('addresses it to the guest email from the locked row', async () => {
    // Snapshotted from the row this transaction is holding, which is the one
    // moment the address is provably consistent with the status being set.
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];

    await changeAdminReservationStatus(REFERENCE, 'confirmed');

    assert.equal(outboxCalls()[0]?.values[3], GUEST_EMAIL);
  });

  it('carries the payload the locked row already held', async () => {
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];

    await changeAdminReservationStatus(REFERENCE, 'confirmed');

    assert.deepEqual(JSON.parse(String(outboxCalls()[0]?.values[5])), {
      bookingReference: REFERENCE,
      guestFirstName: 'Amina',
      guestLastName: 'Khalil',
      roomTypeName: 'Nile View Suite',
      checkIn: '2030-04-10',
      checkOut: '2030-04-13',
      nights: 3,
      adults: 2,
      children: 1,
      nightlyRate: '4200.00',
      totalAmount: '12600.00',
      currency: 'EGP',
      specialRequests: 'Late arrival, around 23:00.',
    });
  });

  it('keeps the guest address out of the payload', async () => {
    // It is the destination, not content. A confirmation does not read a
    // person their own address back, and one address in one place cannot
    // disagree with itself.
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];

    await changeAdminReservationStatus(REFERENCE, 'confirmed');

    const payload = String(outboxCalls()[0]?.values[5]);

    assert.ok(!payload.includes(GUEST_EMAIL));
    assert.ok(!payload.includes('guestEmail'));
  });

  it('adds no second read to the transaction', async () => {
    // Everything came from the lock read. A re-read would be a second trip
    // that could see a different row.
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];

    await changeAdminReservationStatus(REFERENCE, 'confirmed');

    assert.equal(sequence().filter((statement) => statement === 'SELECT').length, 1);
  });
});

describe('everything else queues nothing', () => {
  it('writes no event for a cancellation', async () => {
    // A cancellation is a different conversation and a different event. This
    // slice owes the guest nothing when a booking is called off.
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('cancelled')];

    const result = await changeAdminReservationStatus(REFERENCE, 'cancelled');

    assert.equal(result.outcome, 'updated');
    assert.equal(outboxCalls().length, 0);
    assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
  });

  it('writes no event when confirming an already-confirmed reservation', async () => {
    // A refused transition never reaches the UPDATE, so there is no new fact
    // to announce and no second message to the guest.
    lockedRows = [lockedRow('confirmed')];

    const result = await changeAdminReservationStatus(REFERENCE, 'confirmed');

    assert.equal(result.outcome, 'invalid-transition');
    assert.equal(outboxCalls().length, 0);
    assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'ROLLBACK']);
  });

  it('writes no event when confirming a cancelled reservation', async () => {
    lockedRows = [lockedRow('cancelled')];

    const result = await changeAdminReservationStatus(REFERENCE, 'confirmed');

    assert.equal(result.outcome, 'invalid-transition');
    assert.equal(outboxCalls().length, 0);
  });

  it('writes no event when the reservation does not exist', async () => {
    lockedRows = [];

    const result = await changeAdminReservationStatus(REFERENCE, 'confirmed');

    assert.deepEqual(result, { outcome: 'not-found' });
    assert.equal(outboxCalls().length, 0);
    assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'ROLLBACK']);
  });
});

describe('a failed outbox insert fails the confirmation', () => {
  const uniqueViolation = () =>
    Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'notification_outbox_event_booking_key',
    });

  it('does not COMMIT, and rolls back instead', async () => {
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];
    outboxError = uniqueViolation();

    await assert.rejects(() => changeAdminReservationStatus(REFERENCE, 'confirmed'));

    assert.deepEqual(sequence(), ['BEGIN', 'SELECT', 'UPDATE', 'OUTBOX', 'ROLLBACK']);
  });

  it('propagates the original database error, object identity included', async () => {
    // Not swallowed, not wrapped, and not softened into an outcome. An
    // administrator who sees an error and retries costs less than a guest who
    // is never told their stay was confirmed.
    const raised = uniqueViolation();
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];
    outboxError = raised;

    const thrown = await changeAdminReservationStatus(REFERENCE, 'confirmed').then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(thrown, raised, 'the very same error object');
    assert.equal((thrown as { code: string }).code, '23505');
  });

  it('propagates a CHECK violation the same way', async () => {
    const raised = Object.assign(new Error('new row violates check constraint'), {
      code: '23514',
      constraint: 'notification_outbox_recipient_pairing_check',
    });
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];
    outboxError = raised;

    const thrown = await changeAdminReservationStatus(REFERENCE, 'confirmed').then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(thrown, raised);
    assert.ok(!sequence().includes('COMMIT'));
  });

  it('does not retry the insert', async () => {
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];
    outboxError = uniqueViolation();

    await assert.rejects(() => changeAdminReservationStatus(REFERENCE, 'confirmed'));

    assert.equal(outboxCalls().length, 1);
  });
});

describe('the status change response is unchanged by the wiring', () => {
  it('still returns only the reference, status and updatedAt', async () => {
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];

    const result = await changeAdminReservationStatus(REFERENCE, 'confirmed');

    assert.ok(result.outcome === 'updated');
    assert.deepEqual(Object.keys(result.reservation).sort(), [
      'bookingReference',
      'status',
      'updatedAt',
    ]);
  });

  it('leaks no guest or contact data, and no stay or pricing detail', async () => {
    // The lock read now carries all of it, and the notification carries some
    // of it. None of that may follow into what an administrator's PATCH
    // returns.
    lockedRows = [lockedRow('pending')];
    updatedRows = [updatedRow('confirmed')];

    const result = await changeAdminReservationStatus(REFERENCE, 'confirmed');
    const serialised = JSON.stringify(result);

    for (const withheld of [
      GUEST_EMAIL,
      'Amina',
      'Khalil',
      'Nile View Suite',
      '2030-04-10',
      '4200.00',
      '12600.00',
      'Late arrival',
    ]) {
      assert.ok(!serialised.includes(withheld), `the response must not carry ${withheld}`);
    }
  });
});
