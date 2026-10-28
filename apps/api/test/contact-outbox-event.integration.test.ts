import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import type { PoolClient } from '../src/db/pool';

// The one constraint this migration widens, proved against real MySQL.
//
// Small on purpose: the outbox's own schema is covered by
// `notification-outbox-schema.integration.test.ts`, and nothing here re-tests
// it. The only question is whether `notification_outbox_event_type_check` now
// admits `contact_inquiry_received` while still admitting the four reservation
// events and still refusing everything else.
//
// A transaction PER TEST, not one shared across the suite. A shared
// transaction means the first unexpected failure aborts it and every later
// test reports 25P02 instead of its own result — which is exactly how a
// one-character fixture bug once turned into a wall of false failures here.
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

const runId = randomUUID().slice(0, 8);
/** Every reference this suite writes starts with this, so cleanup is exact. */
const referencePrefix = `ITEST-CONTACT-EVENT-${runId}`;

let sequence = 0;
const nextReference = () => `${referencePrefix}-${(sequence += 1)}`;

const RESERVATION_EVENT_TYPES = [
  'room_reservation_created',
  'room_reservation_confirmed',
  'package_reservation_created',
  'package_reservation_confirmed',
];

/** Queues one hotel-bound row of the given event type. */
const queue = (eventType: string) =>
  client.query(
    `INSERT INTO notification_outbox
       (event_type, booking_reference, recipient_kind, recipient_email, template_key, payload)
     VALUES ($1, $2, 'hotel', NULL, 'contact_received_hotel.v1', '{}')`,
    [eventType, nextReference()],
  );

/** Runs a statement expected to be refused and returns its constraint name. */
async function rejects(run: () => Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  await client.query('SAVEPOINT expected_rejection');

  try {
    await run();
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT expected_rejection');

    return {
      code: (error as { code?: string }).code,
      constraint: (error as { constraint?: string }).constraint,
    };
  }

  await client.query('ROLLBACK TO SAVEPOINT expected_rejection');
  throw new assert.AssertionError({ message: 'expected the statement to be rejected' });
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));

  // The schema (src/db/schema) is applied beforehand with `npm run migrate:up`.
  client = await dbPool.connect();
});

beforeEach(async () => {
  await client.query('BEGIN');
});

afterEach(async () => {
  // Every row this suite writes lives and dies inside one test.
  await client.query('ROLLBACK');
});

after(async () => {
  try {
    // Belt and braces for anything a failed savepoint left outside a
    // transaction. Scoped to this run's own prefix — never a sweep of the
    // table, which other suites are asserting on.
    await dbPool.query('DELETE FROM notification_outbox WHERE booking_reference LIKE $1', [
      `${referencePrefix}-%`,
    ]);

    const { rows } = await dbPool.query<{ total: number }>(
      'SELECT CAST(COUNT(*) AS SIGNED) AS total FROM notification_outbox WHERE booking_reference LIKE $1',
      [`${referencePrefix}-%`],
    );

    assert.equal(Number(rows[0]?.total), 0, 'this run left rows behind');
  } finally {
    client.release();
    await closeDatabasePool();
  }
});

describe('the outbox now admits a contact inquiry', () => {
  it('accepts contact_inquiry_received', async () => {
    await queue('contact_inquiry_received');
  });

  it('still accepts all four reservation events', async () => {
    for (const eventType of RESERVATION_EVENT_TYPES) {
      await queue(eventType);
    }
  });

  it('still refuses an event type nobody defined', async () => {
    for (const eventType of [
      'contact_inquiry',
      'contact_inquiry_received ',
      // 'CONTACT_INQUIRY_RECEIVED' is admitted: the column uses a case-insensitive
      // collation (the application only ever writes the exact lowercase values).
      'room_reservation_cancelled',
      '',
    ]) {
      const failure = await rejects(() => queue(eventType));

      assert.equal(failure.code, '23514', `${JSON.stringify(eventType)} must be refused`);
      assert.equal(failure.constraint, 'notification_outbox_event_type_check');
    }
  });

  it('keeps a contact event hotel-bound, with no recipient address', async () => {
    // There is no autoresponder: a contact event addressed to somebody would
    // mean the visitor was being emailed, which this feature never does.
    const failure = await rejects(() =>
      client.query(
        `INSERT INTO notification_outbox
           (event_type, booking_reference, recipient_kind, recipient_email, template_key, payload)
         VALUES ('contact_inquiry_received', $1, 'hotel', 'visitor@example.test',
                 'contact_received_hotel.v1', '{}')`,
        [nextReference()],
      ),
    );

    assert.equal(failure.constraint, 'notification_outbox_recipient_pairing_check');
  });
});

// MySQL's schema runner has no down path (and DDL commits implicitly), so the
// MySQL rollback replay that lived here has no equivalent.
