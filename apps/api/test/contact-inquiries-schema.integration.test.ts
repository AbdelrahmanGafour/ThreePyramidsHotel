import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { runner } from 'node-pg-migrate';

// The `contact_inquiries` schema, and the one outbox constraint this migration
// widens, proved against real PostgreSQL.
//
// Everything asserted here is a rule only the database can settle: that the
// four inquiry types are a constraint rather than a convention, that a blank
// name cannot masquerade as a name, that an optional phone can be absent but
// not empty, and that the outbox now recognises one more event type without
// having forgotten any of the four it already knew.
//
// It deliberately does NOT re-test PostgreSQL. There is no assertion that a
// unique index rejects duplicates in general or that NOT NULL rejects NULL —
// only that THIS table carries the rules the contact feature depends on.
//
// Every row it writes carries an identifier unique to the run, and exactly
// those rows are removed afterwards. The outbox cleanup is scoped to this
// suite's own references: a sweep of that table would destroy rows other
// suites are asserting on.
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
const referencePrefix = `ITEST-CONTACT-${runId}`;

let sequence = 0;
const nextReference = () => `${referencePrefix}-${(sequence += 1)}`;

const MIGRATION_NAME = '1790600000000_create-contact-inquiries';

const INQUIRY_TYPES = [
  'Room reservation',
  'Curated journey',
  'Airport transfer',
  'General inquiry',
];

const RESERVATION_EVENT_TYPES = [
  'room_reservation_created',
  'room_reservation_confirmed',
  'package_reservation_created',
  'package_reservation_confirmed',
];

type InquiryRow = {
  reference?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string | null;
  inquiry_type?: string;
  message?: string;
};

/** A complete, legal inquiry. Each case below spoils exactly one field. */
const inquiry = (overrides: InquiryRow = {}) => ({
  reference: nextReference(),
  first_name: 'Amina',
  last_name: 'Khalil',
  email: 'amina@example.test',
  phone: '+20 100 000 0000',
  inquiry_type: 'General inquiry',
  message: 'Do you have a room with a view of the plateau in April?',
  ...overrides,
});

async function insertInquiry(values: ReturnType<typeof inquiry>): Promise<void> {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

  await client.query(
    `INSERT INTO contact_inquiries (${columns.join(', ')}) VALUES (${placeholders})`,
    Object.values(values),
  );
}

/**
 * Runs a statement expected to be refused and returns its SQLSTATE.
 *
 * Wrapped in a savepoint because a failed statement aborts the surrounding
 * transaction, and every test here shares one.
 */
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

  // Brings the schema up to date, including this migration, if it is not.
  await runner({
    databaseUrl: process.env.DATABASE_URL!,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    dir: path.resolve(__dirname, '../src/db/migrations'),
    log: () => undefined,
  });

  client = await dbPool.connect();
  await client.query('BEGIN');
});

after(async () => {
  try {
    // Everything this suite wrote is inside the transaction below, so the
    // rollback removes it. The scoped deletes are belt and braces for anything
    // a failed savepoint left outside it — and are scoped by this run's own
    // prefix, never a sweep of either table.
    await client.query('ROLLBACK');
    await dbPool.query('DELETE FROM notification_outbox WHERE booking_reference LIKE $1', [
      `${referencePrefix}-%`,
    ]);
    await dbPool.query('DELETE FROM contact_inquiries WHERE reference LIKE $1', [
      `${referencePrefix}-%`,
    ]);

    const { rows } = await dbPool.query<{ inquiries: number; notifications: number }>(
      `SELECT (SELECT COUNT(*) FROM contact_inquiries WHERE reference LIKE $1)::int AS inquiries,
              (SELECT COUNT(*) FROM notification_outbox WHERE booking_reference LIKE $1)::int AS notifications`,
      [`${referencePrefix}-%`],
    );

    assert.deepEqual(rows[0], { inquiries: 0, notifications: 0 }, 'this run left rows behind');
  } finally {
    client.release();
    await closeDatabasePool();
  }
});

describe('contact_inquiries accepts a real inquiry', () => {
  it('stores one, defaulting its created_at', async () => {
    const values = inquiry();

    await insertInquiry(values);

    const { rows } = await client.query(
      `SELECT reference, first_name, last_name, email, phone, inquiry_type, message, created_at
         FROM contact_inquiries WHERE reference = $1`,
      [values.reference],
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].first_name, 'Amina');
    assert.equal(rows[0].email, 'amina@example.test');
    assert.equal(rows[0].inquiry_type, 'General inquiry');
    assert.equal(rows[0].message, values.message);
    assert.ok(rows[0].created_at instanceof Date, 'created_at defaults to now()');
  });

  it('accepts every inquiry type the form offers, and only those', async () => {
    for (const inquiryType of INQUIRY_TYPES) {
      await insertInquiry(inquiry({ inquiry_type: inquiryType }));
    }

    const { rows } = await client.query<{ total: number }>(
      `SELECT COUNT(DISTINCT inquiry_type)::int AS total
         FROM contact_inquiries WHERE reference LIKE $1`,
      [`${referencePrefix}-%`],
    );

    assert.ok((rows[0]?.total ?? 0) >= INQUIRY_TYPES.length, 'all four were stored');
  });

  it('accepts a missing phone, because the form does not require one', async () => {
    const values = inquiry({ phone: null });

    await insertInquiry(values);

    const { rows } = await client.query('SELECT phone FROM contact_inquiries WHERE reference = $1', [
      values.reference,
    ]);

    assert.equal(rows[0].phone, null);
  });

  it('accepts text at exactly the cap on every field', async () => {
    // The boundary belongs to the legal side: a message of exactly 2000
    // characters is a long inquiry, not an attack.
    await insertInquiry(
      inquiry({
        first_name: 'a'.repeat(100),
        last_name: 'b'.repeat(100),
        email: `${'c'.repeat(241)}@example.test`,
        phone: '1'.repeat(50),
        message: 'd'.repeat(2000),
      }),
    );
  });
});

describe('contact_inquiries refuses what the form would never send', () => {
  it('rejects an inquiry type outside the four', async () => {
    for (const inquiryType of ['Wedding', 'general inquiry', 'ROOM RESERVATION', '']) {
      const failure = await rejects(() => insertInquiry(inquiry({ inquiry_type: inquiryType })));

      assert.equal(failure.code, '23514', `${JSON.stringify(inquiryType)} must be refused`);
      assert.equal(failure.constraint, 'contact_inquiries_inquiry_type_check');
    }
  });

  it('rejects a blank or whitespace-only required field', async () => {
    const cases: ReadonlyArray<[InquiryRow, string]> = [
      [{ reference: '' }, 'contact_inquiries_reference_not_blank_check'],
      [{ reference: '   ' }, 'contact_inquiries_reference_not_blank_check'],
      [{ first_name: '' }, 'contact_inquiries_name_not_blank_check'],
      [{ first_name: '\t\n ' }, 'contact_inquiries_name_not_blank_check'],
      [{ last_name: '  ' }, 'contact_inquiries_name_not_blank_check'],
      [{ email: '' }, 'contact_inquiries_email_not_blank_check'],
      [{ message: '' }, 'contact_inquiries_message_not_blank_check'],
      [{ message: '     ' }, 'contact_inquiries_message_not_blank_check'],
    ];

    for (const [spoiled, constraint] of cases) {
      const failure = await rejects(() => insertInquiry(inquiry(spoiled)));

      assert.equal(failure.code, '23514', `${JSON.stringify(spoiled)} must be refused`);
      assert.equal(failure.constraint, constraint);
    }
  });

  it('rejects a present but blank phone, while still allowing NULL', async () => {
    // NULL and '' would otherwise be two ways to say "no phone".
    for (const phone of ['', '   ']) {
      const failure = await rejects(() => insertInquiry(inquiry({ phone })));

      assert.equal(failure.code, '23514');
      assert.equal(failure.constraint, 'contact_inquiries_phone_not_blank_check');
    }
  });

  it('rejects text one character past each cap', async () => {
    const cases: ReadonlyArray<[InquiryRow, string]> = [
      [{ reference: 'r'.repeat(65) }, 'contact_inquiries_reference_not_blank_check'],
      [{ first_name: 'a'.repeat(101) }, 'contact_inquiries_name_not_blank_check'],
      [{ last_name: 'b'.repeat(101) }, 'contact_inquiries_name_not_blank_check'],
      [{ email: 'c'.repeat(255) }, 'contact_inquiries_email_not_blank_check'],
      [{ phone: '1'.repeat(51) }, 'contact_inquiries_phone_not_blank_check'],
      [{ message: 'd'.repeat(2001) }, 'contact_inquiries_message_not_blank_check'],
    ];

    for (const [spoiled, constraint] of cases) {
      const failure = await rejects(() => insertInquiry(inquiry(spoiled)));

      assert.equal(failure.code, '23514', `${Object.keys(spoiled)[0]} over its cap must be refused`);
      assert.equal(failure.constraint, constraint);
    }
  });

  it('rejects a reference another inquiry already holds', async () => {
    const values = inquiry();

    await insertInquiry(values);

    const failure = await rejects(() =>
      insertInquiry(inquiry({ reference: values.reference, email: 'someone.else@example.test' })),
    );

    assert.equal(failure.code, '23505');
    assert.equal(failure.constraint, 'contact_inquiries_reference_key');
  });
});

describe('the outbox learned one event type and forgot none', () => {
  const queue = (eventType: string) =>
    client.query(
      `INSERT INTO notification_outbox
         (event_type, booking_reference, recipient_kind, recipient_email, template_key, payload)
       VALUES ($1, $2, 'hotel', NULL, 'contact_received_hotel.v1', '{}'::jsonb)`,
      [eventType, nextReference()],
    );

  it('accepts contact_inquiry_received', async () => {
    await queue('contact_inquiry_received');
  });

  it('still accepts all four reservation events', async () => {
    for (const eventType of RESERVATION_EVENT_TYPES) {
      await queue(eventType);
    }
  });

  it('still rejects an event type nobody defined', async () => {
    for (const eventType of ['contact_inquiry', 'contact_inquiry_received ', 'nonsense', '']) {
      const failure = await rejects(() => queue(eventType));

      assert.equal(failure.code, '23514', `${JSON.stringify(eventType)} must be refused`);
      assert.equal(failure.constraint, 'notification_outbox_event_type_check');
    }
  });

  it('keeps a contact event addressed to the hotel, with no recipient', async () => {
    // A contact inquiry is hotel-only: there is no autoresponder, so the
    // pairing constraint's `guest => address` rule must still hold.
    const failure = await rejects(() =>
      client.query(
        `INSERT INTO notification_outbox
           (event_type, booking_reference, recipient_kind, recipient_email, template_key, payload)
         VALUES ('contact_inquiry_received', $1, 'hotel', 'someone@example.test',
                 'contact_received_hotel.v1', '{}'::jsonb)`,
        [nextReference()],
      ),
    );

    assert.equal(failure.code, '23514');
    assert.equal(failure.constraint, 'notification_outbox_recipient_pairing_check');
  });
});

describe('the migration reverses cleanly', () => {
  /**
   * Replays this migration's own `down()` against the live transaction.
   *
   * The migration is the only description of its rollback, so the test uses it
   * rather than a hand-written copy that could drift. The proxy accepts only
   * the three operations this `down` performs and throws on anything else, so
   * a future edit cannot be silently half-replayed.
   *
   * Everything happens inside a savepoint that is rolled back, so the real
   * schema is never left altered.
   */
  async function replayDown(): Promise<string[]> {
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
          if (property === 'dropTable') {
            return (table: unknown) => {
              assert.match(String(table), /^[a-z_][a-z0-9_]*$/);
              statements.push(`DROP TABLE ${String(table)}`);
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

  it('narrows the outbox constraint and drops its own table, in that order', async () => {
    const statements = await replayDown();

    assert.equal(statements.length, 3, 'drop the constraint, re-add it narrowed, drop the table');
    assert.match(statements[0] ?? '', /DROP CONSTRAINT notification_outbox_event_type_check/);
    assert.match(statements[1] ?? '', /ADD CONSTRAINT notification_outbox_event_type_check/);
    assert.equal(statements[2], 'DROP TABLE contact_inquiries');

    // The narrowed constraint restores exactly the four it started with, and
    // says nothing about contact.
    for (const eventType of RESERVATION_EVENT_TYPES) {
      assert.ok(statements[1]?.includes(`'${eventType}'`), `${eventType} survives the rollback`);
    }
    assert.equal(statements[1]?.includes('contact_inquiry_received'), false);
  });

  it('runs against the live schema and puts the constraints back', async () => {
    await client.query('SAVEPOINT down_migration');

    try {
      // The migration's `down` narrows the outbox CHECK back to the four
      // reservation events, and PostgreSQL validates that against existing
      // rows — so it refuses while any `contact_inquiry_received` row is
      // present. That refusal is correct and deliberate: rolling back with
      // queued contact notifications would otherwise have to destroy them
      // silently. Earlier tests in this suite queued several, so they are
      // cleared first, exactly as an operator would settle or remove them
      // before rolling back for real.
      //
      // Scoped to this run's own prefix, never a sweep of the table: other
      // suites have rows here that they are asserting on. Inside the
      // savepoint, so the rollback below puts them back.
      await client.query('DELETE FROM notification_outbox WHERE booking_reference LIKE $1', [
        `${referencePrefix}-%`,
      ]);

      for (const statement of await replayDown()) {
        await client.query(statement);
      }

      // The table is gone.
      const { rows: tables } = await client.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM pg_tables
          WHERE schemaname = 'public' AND tablename = 'contact_inquiries'`,
      );
      assert.equal(tables[0]?.total, 0, 'contact_inquiries was dropped');

      // And the narrowed outbox constraint refuses the contact event again
      // while still accepting the four it always allowed.
      const refused = await rejects(() =>
        client.query(
          `INSERT INTO notification_outbox
             (event_type, booking_reference, recipient_kind, recipient_email, template_key, payload)
           VALUES ('contact_inquiry_received', $1, 'hotel', NULL, 'contact_received_hotel.v1', '{}'::jsonb)`,
          [nextReference()],
        ),
      );
      assert.equal(refused.constraint, 'notification_outbox_event_type_check');

      await client.query(
        `INSERT INTO notification_outbox
           (event_type, booking_reference, recipient_kind, recipient_email, template_key, payload)
         VALUES ('room_reservation_created', $1, 'hotel', NULL, 'room_created_hotel.v1', '{}'::jsonb)`,
        [nextReference()],
      );
    } finally {
      // The schema this suite runs against is the shared one. Nothing it did
      // here survives this line.
      await client.query('ROLLBACK TO SAVEPOINT down_migration');
    }
  });

  it('left the real schema untouched by that rollback', async () => {
    const { rows } = await client.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'contact_inquiries'`,
    );

    assert.equal(rows[0]?.total, 1, 'contact_inquiries is back');

    // And the widened constraint is in force again.
    await client.query(
      `INSERT INTO notification_outbox
         (event_type, booking_reference, recipient_kind, recipient_email, template_key, payload)
       VALUES ('contact_inquiry_received', $1, 'hotel', NULL, 'contact_received_hotel.v1', '{}'::jsonb)`,
      [nextReference()],
    );
  });
});
