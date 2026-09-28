import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { runner } from 'node-pg-migrate';

// The one constraint this migration widens, proved against real PostgreSQL.
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

const MIGRATION_NAME = '1790700000000_allow-contact-inquiry-outbox-event';

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
     VALUES ($1, $2, 'hotel', NULL, 'contact_received_hotel.v1', '{}'::jsonb)`,
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

  await runner({
    databaseUrl: process.env.DATABASE_URL!,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    dir: path.resolve(__dirname, '../src/db/migrations'),
    log: () => undefined,
  });

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
      'SELECT count(*)::int AS total FROM notification_outbox WHERE booking_reference LIKE $1',
      [`${referencePrefix}-%`],
    );

    assert.equal(rows[0]?.total, 0, 'this run left rows behind');
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
      'CONTACT_INQUIRY_RECEIVED',
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
                 'contact_received_hotel.v1', '{}'::jsonb)`,
        [nextReference()],
      ),
    );

    assert.equal(failure.constraint, 'notification_outbox_recipient_pairing_check');
  });
});

describe('the migration reverses cleanly', () => {
  /**
   * Replays the migration's own `down()` against the live transaction.
   *
   * The migration is the only description of its rollback, so the test uses it
   * rather than a hand-written copy that could drift. The proxy accepts only
   * the two operations this `down` performs and throws on anything else, so a
   * future edit cannot be silently half-replayed.
   */
  function replayDown(): string[] {
    const migration = require(`../src/db/migrations/${MIGRATION_NAME}.cjs`) as {
      down?: (pgm: unknown) => void;
    };

    assert.equal(typeof migration.down, 'function', 'the migration has no down path');

    const statements: string[] = [];
    const builder = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'dropConstraint') {
            return (table: unknown, name: unknown) => {
              assert.match(String(table), /^[a-z_][a-z0-9_]*$/);
              assert.match(String(name), /^[a-z_][a-z0-9_]*$/);
              statements.push(`ALTER TABLE ${String(table)} DROP CONSTRAINT ${String(name)}`);
            };
          }
          if (property === 'addConstraint') {
            return (table: unknown, name: unknown, spec: unknown) => {
              assert.match(String(table), /^[a-z_][a-z0-9_]*$/);
              assert.match(String(name), /^[a-z_][a-z0-9_]*$/);
              const check = (spec as { check?: string }).check;
              assert.ok(check, 'the down path re-adds only CHECK constraints');
              statements.push(
                `ALTER TABLE ${String(table)} ADD CONSTRAINT ${String(name)} CHECK (${check})`,
              );
            };
          }

          throw new Error(
            `the migration's down uses pgm.${String(property)}, which this test cannot replay. ` +
              'Teach replayDown about it rather than hand-writing the rollback.',
          );
        },
      },
    );

    migration.down?.(builder);

    return statements;
  }

  it('narrows the constraint back to exactly the four reservation events', () => {
    const statements = replayDown();

    assert.equal(statements.length, 2, 'drop the constraint, re-add it narrowed');
    assert.match(statements[0] ?? '', /DROP CONSTRAINT notification_outbox_event_type_check/);

    for (const eventType of RESERVATION_EVENT_TYPES) {
      assert.ok(statements[1]?.includes(`'${eventType}'`), `${eventType} survives the rollback`);
    }
    assert.equal(
      statements[1]?.includes('contact_inquiry_received'),
      false,
      'and the contact event does not',
    );
  });

  it('runs against the live schema and refuses the contact event again', async () => {
    // Everything here happens inside this test's own transaction, which
    // `afterEach` rolls back — the real constraint is never left narrowed.
    //
    // The migration's `down` deliberately fails while any
    // `contact_inquiry_received` row exists, so this suite's own are cleared
    // first, exactly as an operator would settle them before rolling back.
    await client.query('DELETE FROM notification_outbox WHERE booking_reference LIKE $1', [
      `${referencePrefix}-%`,
    ]);

    for (const statement of replayDown()) {
      await client.query(statement);
    }

    const refused = await rejects(() => queue('contact_inquiry_received'));
    assert.equal(refused.constraint, 'notification_outbox_event_type_check');

    // And the four it always allowed are still allowed.
    await queue('room_reservation_created');
  });

  it('left the real constraint widened once that rolled back', async () => {
    await queue('contact_inquiry_received');
  });
});
