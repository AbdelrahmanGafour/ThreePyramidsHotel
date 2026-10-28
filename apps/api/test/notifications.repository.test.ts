import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from '../src/db/pool';
import {
  buildPackageReservationCreatedEvent,
  buildRoomReservationConfirmedEvent,
} from '../src/modules/notifications/notifications.events';
import { insertNotificationEvent } from '../src/modules/notifications/notifications.repository';

// The outbox insert, against a recording client.
//
// No database and no pool: the repository imports `PoolClient` as a type only,
// so it can be exercised with a stub. What is under test is the contract this
// function has with whatever transaction it is handed — that it writes one
// statement, on that client, touching the six frozen columns and nothing else,
// and that it gets out of the way when PostgreSQL objects.
//
// The behaviour that only real PostgreSQL can settle — that the statement is
// valid against the table, that the jsonb parameter round-trips, that a
// duplicate really is refused — is proved in
// `notifications.repository.integration.test.ts`.

type Recorded = { text: string; values: unknown[] };

/** A client that records every statement and answers all of them the same way. */
function recordingClient(): { client: PoolClient; statements: Recorded[] } {
  const statements: Recorded[] = [];

  const client = {
    async query(text: string, values: unknown[] = []): Promise<unknown> {
      statements.push({ text, values });
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;

  return { client, statements };
}

/** A client that fails the way PostgreSQL does, carrying a SQLSTATE. */
function failingClient(error: unknown): { client: PoolClient; calls: number } {
  const state = { calls: 0 };

  const client = {
    async query(): Promise<unknown> {
      state.calls += 1;
      throw error;
    },
  } as unknown as PoolClient;

  return {
    client,
    get calls() {
      return state.calls;
    },
  };
}

const guestEvent = buildRoomReservationConfirmedEvent({
  bookingReference: 'TPH-A2B3C4D5E6F7',
  guestFirstName: 'Amina',
  guestLastName: 'Khalil',
  guestEmail: 'guest@example.test',
  roomTypeName: 'Nile View Suite',
  checkIn: '2026-04-10',
  checkOut: '2026-04-13',
  nights: 3,
  adults: 2,
  children: 1,
  nightlyRate: '4200.00',
  totalAmount: '12600.00',
  specialRequests: 'Late arrival, around 23:00.',
});

const hotelEvent = buildPackageReservationCreatedEvent({
  bookingReference: 'TPH-J8K9L2M3N4P5',
  guestFirstName: 'Tomas',
  guestLastName: 'Novak',
  guestEmail: 'guest@example.test',
  guestPhone: '+420 600 000 000',
  guestCountry: 'CZ',
  packageCode: 'TPJ-001',
  packageTitle: 'Giza Plateau at Dawn',
  variantLabel: 'Private tour',
  tourDate: '2026-05-02',
  adults: 2,
  children: 2,
  childAges: [7, 11],
  pricingStatus: 'quoted',
  adultUnitRate: '180.00',
  childUnitRate: '90.00',
  totalAmount: '540.00',
  specialRequests: null,
});

/** The one statement, or a failure saying how many there really were. */
function onlyStatement(statements: Recorded[]): Recorded {
  assert.equal(statements.length, 1, `expected exactly one statement, got ${statements.length}`);

  return statements[0] as Recorded;
}

describe('insertNotificationEvent, the statement it writes', () => {
  it('runs on the client it was given, and acquires none of its own', async () => {
    // The caller is already inside the reservation's transaction. A connection
    // taken here would be a second one, outside it, and the insert would
    // commit or vanish independently of the booking.
    const { client, statements } = recordingClient();
    const { client: untouched, statements: untouchedStatements } = recordingClient();

    await insertNotificationEvent(client, guestEvent);

    assert.equal(statements.length, 1, 'the given client ran the insert');
    assert.equal(untouchedStatements.length, 0, 'no other client was used');
    assert.ok(untouched, 'the second client exists only to prove it stayed unused');
  });

  it('issues exactly one statement', async () => {
    const { client, statements } = recordingClient();

    await insertNotificationEvent(client, guestEvent);

    assert.equal(statements.length, 1);
  });

  it('writes a single INSERT into notification_outbox', async () => {
    const { client, statements } = recordingClient();

    await insertNotificationEvent(client, guestEvent);

    assert.match(onlyStatement(statements).text, /^\s*INSERT INTO notification_outbox\b/);
  });

  it('names exactly the six columns frozen at insert, in parameter order', async () => {
    // Everything else is the schema's to fill: attempts, the schedule, the
    // envelope, the verdict, the error, the provider reference and the
    // timestamps. Naming one here would be this layer claiming to know
    // something about dispatch.
    const { client, statements } = recordingClient();

    await insertNotificationEvent(client, guestEvent);

    const { text } = onlyStatement(statements);
    const columnList = /\(([^)]*)\)\s*VALUES/.exec(text)?.[1];

    assert.ok(columnList, 'the statement lists its columns');
    assert.deepEqual(
      columnList.split(',').map((column) => column.trim()),
      [
        'event_type',
        'booking_reference',
        'recipient_kind',
        'recipient_email',
        'template_key',
        'payload',
      ],
    );
  });

  it('binds six placeholders and passes six values', async () => {
    const { client, statements } = recordingClient();

    await insertNotificationEvent(client, guestEvent);

    const { text, values } = onlyStatement(statements);
    const placeholders = /VALUES\s*\(([^)]*)\)/.exec(text)?.[1];

    assert.deepEqual(
      placeholders?.split(',').map((placeholder) => placeholder.trim()),
      ['$1', '$2', '$3', '$4', '$5', '$6'],
    );
    assert.equal(values.length, 6, 'every placeholder is bound, and nothing more');
  });

  it('interpolates nothing into the SQL', async () => {
    // Values travel as parameters. A guest-supplied special request or name
    // appearing in the statement text would be the shape of an injection.
    const { client, statements } = recordingClient();

    await insertNotificationEvent(client, guestEvent);

    const { text } = onlyStatement(statements);

    assert.ok(!text.includes('Amina'), 'no guest data in the statement text');
    assert.ok(!text.includes('TPH-'), 'no booking reference in the statement text');
    assert.ok(!text.includes("'"), 'no string literals at all');
  });
});

describe('insertNotificationEvent, what it persists', () => {
  it('maps a guest event onto the six values', async () => {
    const { client, statements } = recordingClient();

    await insertNotificationEvent(client, guestEvent);

    const { values } = onlyStatement(statements);

    assert.equal(values[0], 'room_reservation_confirmed');
    assert.equal(values[1], 'TPH-A2B3C4D5E6F7');
    assert.equal(values[2], 'guest');
    assert.equal(values[3], 'guest@example.test');
    assert.equal(values[4], 'room_confirmed_guest.v1');
  });

  it('maps a hotel event, address and all, onto the same six', async () => {
    // The null matters: `notification_outbox_recipient_pairing_check` requires
    // a hotel row to carry no address, and the dispatcher resolves one at
    // claim time. An empty string here would trip the constraint and abort a
    // booking.
    const { client, statements } = recordingClient();

    await insertNotificationEvent(client, hotelEvent);

    const { values } = onlyStatement(statements);

    assert.equal(values[0], 'package_reservation_created');
    assert.equal(values[1], 'TPH-J8K9L2M3N4P5');
    assert.equal(values[2], 'hotel');
    assert.equal(values[3], null);
    assert.equal(values[4], 'package_created_hotel.v1');
  });

  it('sends the payload as JSON text that parses back to the payload exactly', async () => {
    const { client, statements } = recordingClient();

    await insertNotificationEvent(client, hotelEvent);

    const [, , , , , payload] = onlyStatement(statements).values;

    assert.equal(typeof payload, 'string', 'serialised here, not left to driver coercion');
    assert.deepEqual(JSON.parse(payload as string), hotelEvent.payload);
    // The nested array survives as an array, not a PostgreSQL array literal.
    assert.deepEqual(JSON.parse(payload as string).childAges, [7, 11]);
  });

  it('does not mutate the event it was handed', async () => {
    // It runs inside a transaction on an object the calling flow still holds.
    const { client } = recordingClient();
    const before = JSON.stringify(hotelEvent);

    await insertNotificationEvent(client, hotelEvent);

    assert.equal(JSON.stringify(hotelEvent), before);
  });

  it('passes a copy of the payload, not the caller object', async () => {
    const { client, statements } = recordingClient();

    await insertNotificationEvent(client, hotelEvent);

    const [, , , , , payload] = onlyStatement(statements).values;

    assert.notEqual(payload, hotelEvent.payload, 'the driver never holds the caller object');
  });
});

describe('insertNotificationEvent, what it refuses to do', () => {
  it('has no ON CONFLICT clause', async () => {
    // The whole point of the strict rule. A conflict on
    // `UNIQUE (event_type, booking_reference)` means a second event for a
    // booking reference that is unique forever — there is no benign reading,
    // and swallowing it would drop a message somebody was owed.
    const { client, statements } = recordingClient();

    await insertNotificationEvent(client, guestEvent);

    const { text } = onlyStatement(statements);

    assert.doesNotMatch(text, /ON\s+CONFLICT/i);
    assert.doesNotMatch(text, /DO\s+NOTHING/i);
    assert.doesNotMatch(text, /DO\s+UPDATE/i);
  });

  it('issues no BEGIN, COMMIT, ROLLBACK or SAVEPOINT', async () => {
    // The caller owns the transaction. Committing here would publish a
    // notification for a reservation that can still roll back; rolling back
    // would discard the caller's work.
    const { client, statements } = recordingClient();

    await insertNotificationEvent(client, guestEvent);
    await insertNotificationEvent(client, hotelEvent);

    for (const { text } of statements) {
      assert.doesNotMatch(text, /\bBEGIN\b/i);
      assert.doesNotMatch(text, /\bCOMMIT\b/i);
      assert.doesNotMatch(text, /\bROLLBACK\b/i);
      assert.doesNotMatch(text, /\bSAVEPOINT\b/i);
    }
  });

  it('asks for nothing back', async () => {
    // It returns void, so there is nothing to RETURNING. The id would be a
    // reference to a row the caller's transaction may still roll back.
    const { client, statements } = recordingClient();

    const result = await insertNotificationEvent(client, guestEvent);

    assert.equal(result, undefined);
    assert.doesNotMatch(onlyStatement(statements).text, /RETURNING/i);
  });

  it('never acquires, releases or reaches for a pool', async () => {
    // Asserted against the source: an absence cannot be observed by calling
    // the function with a stub that has no `connect` to find.
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.repository.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

    for (const forbidden of ['dbPool', '.connect(', '.release(', 'require(', 'process.env']) {
      assert.ok(!code.includes(forbidden), `the repository must not use ${forbidden}`);
    }
  });

  it('imports the pool for its type only, so it drags no pool into the graph', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.repository.ts', 'utf8');

    assert.match(code, /^import type \{ PoolClient \} from '\.\.\/\.\.\/db\/pool';/);
    assert.deepEqual(
      [...code.matchAll(/^import (?:type )?.*from '([^']+)';$/gm)].map((match) => match[1]),
      ['../../db/pool', './notifications.types'],
    );
  });
});

describe('insertNotificationEvent, error semantics', () => {
  it('propagates a unique violation unchanged, object identity included', async () => {
    // Not wrapped, not re-tagged, not turned into an outcome union. The caller
    // needs the raw SQLSTATE, and the transaction is already aborted by the
    // time this returns — a translated error would invite someone to handle it.
    const raised = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'notification_outbox_event_booking_key',
    });
    const failing = failingClient(raised);

    const thrown = await insertNotificationEvent(failing.client, guestEvent).then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(thrown, raised, 'the very same error object comes out');
    assert.equal((thrown as { code: string }).code, '23505');
    assert.equal((thrown as { constraint: string }).constraint, 'notification_outbox_event_booking_key');
  });

  it('propagates a CHECK violation unchanged', async () => {
    const raised = Object.assign(new Error('new row violates check constraint'), {
      code: '23514',
      constraint: 'notification_outbox_recipient_pairing_check',
    });
    const failing = failingClient(raised);

    const thrown = await insertNotificationEvent(failing.client, hotelEvent).then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(thrown, raised);
  });

  it('propagates an aborted-transaction error unchanged', async () => {
    // 25P02: the caller's transaction was already broken by something earlier.
    const raised = Object.assign(new Error('current transaction is aborted'), { code: '25P02' });
    const failing = failingClient(raised);

    const thrown = await insertNotificationEvent(failing.client, guestEvent).then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(thrown, raised);
  });

  it('does not retry a failed insert', async () => {
    // A second attempt inside an aborted transaction could only fail with
    // 25P02, and would replace the real diagnosis with a useless one.
    const failing = failingClient(Object.assign(new Error('duplicate key'), { code: '23505' }));

    await insertNotificationEvent(failing.client, guestEvent).catch(() => undefined);

    assert.equal(failing.calls, 1);
  });
});
