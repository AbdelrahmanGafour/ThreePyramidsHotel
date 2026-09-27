import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { buildPackageReservationCreatedEvent } from '../src/modules/notifications/notifications.events';
import { insertNotificationEvent } from '../src/modules/notifications/notifications.repository';

// `insertNotificationEvent` against real PostgreSQL.
//
// Deliberately small, and deliberately not the schema suite. That suite proves
// the table carries the rules the design depends on; this one proves the
// repository's own statement actually works against it — three things a stub
// client can never settle, because a stub accepts whatever it is handed:
//
//   1. the statement is valid SQL for this table, with columns that exist and
//      defaults that fill in the twelve it does not name;
//   2. the payload parameter really does land as jsonb and read back as the
//      object that went in, rather than as a string or a PostgreSQL array;
//   3. the strict rule bites — a second event for the same booking raises
//      23505 out of THIS function, unswallowed, and leaves the transaction
//      aborted exactly as a caller's reservation would need it to be.
//
// Everything runs inside one transaction that is rolled back, so the table is
// left exactly as it was found and no cleanup depends on it.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let client: PoolClient;

/** Unique to this run, so nothing can collide with a real or leftover row. */
const runId = randomUUID().slice(0, 8);

const eventFor = (reference: string) =>
  buildPackageReservationCreatedEvent({
    bookingReference: reference,
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

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  client = await dbPool.connect();
  await client.query('BEGIN');
});

after(async () => {
  // Nothing this suite wrote survives, so there is no cleanup to get wrong.
  await client.query('ROLLBACK');
  client.release();
  await closeDatabasePool();
});

describe('insertNotificationEvent against PostgreSQL', () => {
  it('writes the six columns and lets the schema fill the rest', async () => {
    const reference = `ITEST-REPO-${runId}-1`;

    await insertNotificationEvent(client, eventFor(reference));

    const { rows } = await client.query(
      `SELECT event_type, booking_reference, recipient_kind, recipient_email, template_key,
              payload, attempts, next_attempt_at, created_at, updated_at,
              last_attempt_at, accepted_at, failed_at,
              last_attempt_acceptance, last_error, provider_reference,
              resolved_from, resolved_to
         FROM notification_outbox
        WHERE booking_reference = $1`,
      [reference],
    );

    assert.equal(rows.length, 1, 'exactly one row');

    const row = rows[0];

    assert.equal(row.event_type, 'package_reservation_created');
    assert.equal(row.booking_reference, reference);
    assert.equal(row.recipient_kind, 'hotel');
    assert.equal(row.recipient_email, null, 'a hotel row carries no address');
    assert.equal(row.template_key, 'package_created_hotel.v1');

    // The twelve the repository never names.
    assert.equal(row.attempts, 0);
    assert.ok(row.next_attempt_at instanceof Date, 'claimable immediately');
    assert.ok(row.created_at instanceof Date);
    assert.ok(row.updated_at instanceof Date);

    for (const column of [
      'last_attempt_at',
      'accepted_at',
      'failed_at',
      'last_attempt_acceptance',
      'last_error',
      'provider_reference',
      'resolved_from',
      'resolved_to',
    ]) {
      assert.equal(row[column], null, `${column} starts unset`);
    }
  });

  it('stores the payload as jsonb that reads back as the object sent', async () => {
    // A stub cannot prove this: it would accept the JSON string and never
    // discover whether PostgreSQL parsed it, stored it as text, or turned the
    // nested ages into an array literal.
    const reference = `ITEST-REPO-${runId}-2`;
    const event = eventFor(reference);

    await insertNotificationEvent(client, event);

    const { rows } = await client.query(
      `SELECT payload, jsonb_typeof(payload) AS kind, jsonb_typeof(payload -> 'childAges') AS ages_kind
         FROM notification_outbox WHERE booking_reference = $1`,
      [reference],
    );

    assert.equal(rows[0].kind, 'object');
    assert.equal(rows[0].ages_kind, 'array', 'the nested ages survive as JSON, not a PG array');
    assert.deepEqual(rows[0].payload, event.payload);
  });

  it('refuses a second event for the same booking, unswallowed', async () => {
    // The strict rule, end to end. `UNIQUE (event_type, booking_reference)`
    // fires inside the function, the error comes out untranslated, and the
    // transaction is aborted — which is precisely how a duplicate would roll a
    // reservation back.
    const reference = `ITEST-REPO-${runId}-3`;
    const event = eventFor(reference);

    await client.query('SAVEPOINT duplicate_attempt');
    await insertNotificationEvent(client, event);

    const thrown = await insertNotificationEvent(client, event).then(
      () => null,
      (error: unknown) => error,
    );

    assert.ok(thrown, 'the duplicate was not swallowed');
    assert.equal((thrown as { code?: string }).code, '23505');
    assert.equal(
      (thrown as { constraint?: string }).constraint,
      'notification_outbox_event_booking_key',
    );

    // The transaction really is aborted: anything else raises 25P02 until it
    // is unwound. That is the property the callers rely on.
    const afterFailure = await client.query('SELECT 1').then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal((afterFailure as { code?: string }).code, '25P02');

    await client.query('ROLLBACK TO SAVEPOINT duplicate_attempt');
  });

  it('accepts the same event type for a different booking', async () => {
    // The constraint is on the pair, not on the event type. Two bookings each
    // getting their own creation notice is the normal case.
    await insertNotificationEvent(client, eventFor(`ITEST-REPO-${runId}-4`));
    await insertNotificationEvent(client, eventFor(`ITEST-REPO-${runId}-5`));

    const { rows } = await client.query(
      `SELECT count(*)::int AS total FROM notification_outbox
        WHERE booking_reference LIKE $1`,
      [`ITEST-REPO-${runId}-%`],
    );

    assert.ok(rows[0].total >= 2);
  });
});
