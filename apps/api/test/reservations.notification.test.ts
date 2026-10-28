import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { PoolClient } from '../src/db/pool';

// Room creation's outbox wiring, against a scripted client.
//
// The questions here are all about ORDER and ATOMICITY, and none of them can
// be answered from outside the service: whether the event is written on the
// same connection as the booking, whether it lands after the reference is
// final and before the COMMIT, and what happens to the reservation when that
// write fails. A double is the only way to see the statement sequence, and the
// only way to make a strict insert fail on demand.
//
// Scope is Event 1 only — `room_reservation_created`, to the hotel. Nothing
// here asserts anything about confirmations, journeys or a dispatcher.
//
// Imported lazily behind a placeholder DATABASE_URL, matching
// `package-reservations.transaction.test.ts`: importing the service reaches
// `db/pool`, which reads the environment at module load. The connection string
// is never used, because the client factory is replaced before every call.

type ServiceModule = typeof import('../src/modules/reservations/reservations.service.js');

let createReservation: ServiceModule['createReservation'];
let __setClientFactoryForTests: ServiceModule['__setClientFactoryForTests'];

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ createReservation, __setClientFactoryForTests } = await import(
    '../src/modules/reservations/reservations.service.js'
  ));
});

afterEach(() => {
  __setClientFactoryForTests(null);
});

const ROOM_TYPE = {
  id: '7',
  slug: 'nile-view-suite',
  name: 'Nile View Suite',
  capacity: 4,
  base_nightly_rate: '4200.00',
};

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    roomTypeSlug: ROOM_TYPE.slug,
    checkIn: '2099-04-10',
    checkOut: '2099-04-13',
    adults: 2,
    children: 1,
    guestFirstName: 'Amina',
    guestLastName: 'Khalil',
    guestEmail: 'amina@example.test',
    guestPhone: '+201000000000',
    guestCountry: 'Egypt',
    specialRequests: 'Late arrival, around 23:00.',
    ...overrides,
  };
}

type Recorded = { text: string; values: unknown[] };

type Script = {
  /**
   * How many reservation INSERTs return no row before one succeeds, standing
   * in for booking-reference collisions. The service retries on an empty
   * result, exactly as `ON CONFLICT (booking_reference) DO NOTHING` produces.
   */
  referenceCollisions?: number;
  /** Make the outbox insert throw this, standing in for a strict failure. */
  outboxError?: unknown;
};

type Recording = {
  statements: Recorded[];
  /** Every distinct client object the service issued a statement on. */
  clients: Set<unknown>;
  released: boolean;
};

/**
 * A client that answers the three reads room creation performs, records every
 * statement, and fails exactly where the script says.
 */
function scriptedClient(script: Script = {}): { client: PoolClient; log: Recording } {
  const log: Recording = { statements: [], clients: new Set(), released: false };
  let reservationInserts = 0;

  const client: PoolClient = {
    async query(text: string, values: unknown[] = []): Promise<unknown> {
      log.statements.push({ text, values });
      // `this` is the client the statement was issued on. Recording it is what
      // proves the outbox write shares the booking's connection rather than
      // merely being called with something that looks like one.
      log.clients.add(client);

      if (text.includes('FROM room_types')) {
        return { rows: [ROOM_TYPE] };
      }

      if (text.includes('FROM rooms')) {
        return { rows: [{ id: '31' }] };
      }

      if (text.includes('INSERT INTO reservations')) {
        reservationInserts += 1;
        // An empty result is the collision signal: the row was not inserted
        // and the transaction is still usable.
        if (reservationInserts <= (script.referenceCollisions ?? 0)) {
          return { rows: [] };
        }
        return { rows: [{ id: '101' }] };
      }

      if (text.includes('INSERT INTO notification_outbox')) {
        if (script.outboxError) {
          throw script.outboxError;
        }
        return { rows: [], rowCount: 1 };
      }

      return { rows: [] };
    },
    release(): void {
      log.released = true;
    },
  } as unknown as PoolClient;

  return { client, log };
}

/** Statement texts in issue order, trimmed to their first meaningful words. */
const sequence = (log: Recording): string[] =>
  log.statements.map(({ text }) => {
    const compact = text.trim().replace(/\s+/g, ' ');

    if (compact.startsWith('INSERT INTO notification_outbox')) return 'OUTBOX';
    if (compact.startsWith('INSERT INTO reservations')) return 'RESERVATION';
    if (compact.startsWith('SELECT rt.id')) return 'ROOM_TYPE';
    if (compact.startsWith('SELECT r.id')) return 'ROOM_LOCK';

    return compact.split(' ')[0] as string;
  });

const outboxStatements = (log: Recording): Recorded[] =>
  log.statements.filter(({ text }) => text.includes('INSERT INTO notification_outbox'));

describe('room reservation creation queues the hotel notification', () => {
  it('writes exactly one outbox event for a successful booking', async () => {
    const { client, log } = scriptedClient();
    __setClientFactoryForTests(async () => client);

    await createReservation(requestBody());

    assert.equal(outboxStatements(log).length, 1);
  });

  it('writes it on the same client as the reservation, acquiring none of its own', async () => {
    const { client, log } = scriptedClient();
    __setClientFactoryForTests(async () => client);

    await createReservation(requestBody());

    // One connection for the whole flow. A second would mean the event and the
    // booking were in different transactions, committing independently.
    assert.equal(log.clients.size, 1);
    assert.equal([...log.clients][0], client);
  });

  it('writes it after the reservation insert and before the COMMIT', async () => {
    // The whole point of the placement, asserted as a sequence rather than as
    // three separate index comparisons that could each pass on a wrong order.
    const { client, log } = scriptedClient();
    __setClientFactoryForTests(async () => client);

    await createReservation(requestBody());

    assert.deepEqual(sequence(log), [
      'BEGIN',
      'ROOM_TYPE',
      'ROOM_LOCK',
      'RESERVATION',
      'OUTBOX',
      'COMMIT',
    ]);
  });

  it('carries the room-created hotel identity', async () => {
    const { client, log } = scriptedClient();
    __setClientFactoryForTests(async () => client);

    const created = await createReservation(requestBody());
    const [eventType, bookingReference, recipientKind, recipientEmail, templateKey] =
      outboxStatements(log)[0]?.values ?? [];

    assert.equal(eventType, 'room_reservation_created');
    assert.equal(bookingReference, created.bookingReference);
    assert.equal(recipientKind, 'hotel');
    assert.equal(recipientEmail, null, 'the hotel address is the dispatcher to resolve');
    assert.equal(templateKey, 'room_created_hotel.v1');
  });

  it('carries the payload the flow already held, with no re-read', async () => {
    const { client, log } = scriptedClient();
    __setClientFactoryForTests(async () => client);

    const created = await createReservation(requestBody());
    const payload = JSON.parse(String(outboxStatements(log)[0]?.values[5]));

    assert.deepEqual(payload, {
      bookingReference: created.bookingReference,
      guestFirstName: 'Amina',
      guestLastName: 'Khalil',
      guestEmail: 'amina@example.test',
      guestPhone: '+201000000000',
      guestCountry: 'Egypt',
      roomTypeName: 'Nile View Suite',
      checkIn: '2099-04-10',
      checkOut: '2099-04-13',
      nights: 3,
      adults: 2,
      children: 1,
      nightlyRate: '4200.00',
      totalAmount: '12600.00',
      currency: 'EGP',
      specialRequests: 'Late arrival, around 23:00.',
    });
  });

  it('prices the payload from the same snapshot the guest was quoted', async () => {
    // Not recomputed and not re-read: the figures in the hotel's email are the
    // ones in the reservation row and the ones in the response.
    const { client, log } = scriptedClient();
    __setClientFactoryForTests(async () => client);

    const created = await createReservation(requestBody());
    const payload = JSON.parse(String(outboxStatements(log)[0]?.values[5]));

    assert.equal(payload.nightlyRate, created.nightlyRate);
    assert.equal(payload.totalAmount, created.totalAmount);
    assert.equal(payload.currency, created.currency);
  });

  it('adds no read of its own to the transaction', async () => {
    // Every field was already in scope. A post-insert SELECT would be a second
    // trip for data the flow was holding.
    const { client, log } = scriptedClient();
    __setClientFactoryForTests(async () => client);

    await createReservation(requestBody());

    assert.equal(sequence(log).filter((statement) => statement.startsWith('SELECT')).length, 0);
    assert.equal(log.statements.length, 6, 'BEGIN, two reads, the insert, the outbox, COMMIT');
  });
});

describe('booking-reference collisions and the outbox', () => {
  it('writes one event for the winning reference only', async () => {
    // Three reservation INSERTs, two of which inserted nothing. A rejected
    // candidate never became a row, so it must never become a notification —
    // otherwise the outbox would carry events for bookings that do not exist.
    const { client, log } = scriptedClient({ referenceCollisions: 2 });
    __setClientFactoryForTests(async () => client);

    const created = await createReservation(requestBody());
    const events = outboxStatements(log);

    assert.equal(sequence(log).filter((statement) => statement === 'RESERVATION').length, 3);
    assert.equal(events.length, 1, 'one event, not one per attempt');
    assert.equal(events[0]?.values[1], created.bookingReference);
  });

  it('places the single event after the last retry, still before the COMMIT', async () => {
    const { client, log } = scriptedClient({ referenceCollisions: 2 });
    __setClientFactoryForTests(async () => client);

    await createReservation(requestBody());

    assert.deepEqual(sequence(log), [
      'BEGIN',
      'ROOM_TYPE',
      'ROOM_LOCK',
      'RESERVATION',
      'RESERVATION',
      'RESERVATION',
      'OUTBOX',
      'COMMIT',
    ]);
  });

  it('writes no event at all when every reference attempt collides', async () => {
    // The service gives up and throws. There is no reservation, so there is
    // nothing to announce.
    const { client, log } = scriptedClient({ referenceCollisions: 99 });
    __setClientFactoryForTests(async () => client);

    await assert.rejects(createReservation(requestBody()));

    assert.equal(outboxStatements(log).length, 0);
    assert.ok(sequence(log).includes('ROLLBACK'));
    assert.ok(!sequence(log).includes('COMMIT'));
  });
});

describe('a failed outbox insert fails the booking', () => {
  /** As PostgreSQL raises a unique violation. */
  const uniqueViolation = () =>
    Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'notification_outbox_event_booking_key',
    });

  it('does not COMMIT, and rolls back instead', async () => {
    // The strict trade, end to end. A booking that committed without its
    // notification is the failure the outbox exists to prevent.
    const { client, log } = scriptedClient({ outboxError: uniqueViolation() });
    __setClientFactoryForTests(async () => client);

    await assert.rejects(createReservation(requestBody()));

    assert.deepEqual(sequence(log), [
      'BEGIN',
      'ROOM_TYPE',
      'ROOM_LOCK',
      'RESERVATION',
      'OUTBOX',
      'ROLLBACK',
    ]);
  });

  it('propagates the original database error, object identity included', async () => {
    // Not swallowed, not wrapped, not turned into a NoAvailabilityError. The
    // caller sees precisely what PostgreSQL said.
    const raised = uniqueViolation();
    const { client } = scriptedClient({ outboxError: raised });
    __setClientFactoryForTests(async () => client);

    const thrown = await createReservation(requestBody()).then(
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
    const { client, log } = scriptedClient({ outboxError: raised });
    __setClientFactoryForTests(async () => client);

    const thrown = await createReservation(requestBody()).then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(thrown, raised);
    assert.ok(!sequence(log).includes('COMMIT'));
  });

  it('does not retry the outbox insert', async () => {
    const { client, log } = scriptedClient({ outboxError: uniqueViolation() });
    __setClientFactoryForTests(async () => client);

    await assert.rejects(createReservation(requestBody()));

    assert.equal(outboxStatements(log).length, 1);
  });

  it('releases the connection', async () => {
    const { client, log } = scriptedClient({ outboxError: uniqueViolation() });
    __setClientFactoryForTests(async () => client);

    await assert.rejects(createReservation(requestBody()));

    assert.ok(log.released);
  });
});

describe('the public response is unchanged by the wiring', () => {
  it('returns exactly the fields it always did', async () => {
    const { client } = scriptedClient();
    __setClientFactoryForTests(async () => client);

    const created = await createReservation(requestBody());

    assert.deepEqual(Object.keys(created).sort(), [
      'adults',
      'bookingReference',
      'checkIn',
      'checkOut',
      'children',
      'currency',
      'nightlyRate',
      'nights',
      'roomType',
      'status',
      'totalAmount',
    ]);
    assert.deepEqual(Object.keys(created.roomType).sort(), ['name', 'slug']);
  });

  it('leaks no guest or contact data, and no internal id', async () => {
    // The payload carries the guest's email, phone and country because the
    // hotel needs them. None of that may follow the event into the response.
    const { client } = scriptedClient();
    __setClientFactoryForTests(async () => client);

    const created = await createReservation(requestBody());
    const serialised = JSON.stringify(created);

    for (const secret of [
      'amina@example.test',
      '+201000000000',
      'Amina',
      'Khalil',
      'Egypt',
      'Late arrival',
    ]) {
      assert.ok(!serialised.includes(secret), `the response must not carry ${secret}`);
    }

    // The room type's and room's internal ids, and the reservation's own.
    for (const id of ['"7"', '"31"', '"101"']) {
      assert.ok(!serialised.includes(id), `the response must not carry ${id}`);
    }
  });

  it('still reports a pending reservation with its reference', async () => {
    const { client } = scriptedClient();
    __setClientFactoryForTests(async () => client);

    const created = await createReservation(requestBody());

    assert.equal(created.status, 'pending');
    assert.match(created.bookingReference, /^TPH-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);
    assert.deepEqual(created.roomType, { slug: 'nile-view-suite', name: 'Nile View Suite' });
  });
});
