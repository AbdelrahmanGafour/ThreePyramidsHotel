import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { runner } from 'node-pg-migrate';

// The `notification_outbox` schema, proved against real PostgreSQL.
//
// Everything asserted here is a rule only the database can settle: that the
// four event types are a constraint rather than a convention, that a recipient
// kind and an address cannot disagree, that an envelope cannot be half
// written, that one booking gets one notification per event, and that the
// claim index exists with the predicate the dispatcher will depend on.
//
// It deliberately does NOT re-test PostgreSQL. There is no assertion that a
// unique index rejects duplicates in general, that a NOT NULL column rejects
// NULL, or that a default is applied — only that THIS table carries the rules
// this design depends on.
//
// Narrowly scoped: one table, and nothing about any other. No reservation,
// package or media row is created or read, because this table deliberately has
// no foreign key to any of them.
//
// Every row it writes carries an identifier unique to the run, and exactly
// those rows are removed afterwards.
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
const referencePrefix = `ITEST-OUTBOX-${runId}`;

let sequence = 0;
const nextReference = () => `${referencePrefix}-${(sequence += 1)}`;

const PAYLOAD = JSON.stringify({ bookingReference: 'fixture', guestFirstName: 'Synthetic' });

/** One row, as the four business writes will produce it. */
type Row = {
  event_type?: string;
  booking_reference?: string;
  recipient_kind?: string;
  recipient_email?: string | null;
  template_key?: string;
  payload?: string;
  attempts?: number;
  last_attempt_acceptance?: string | null;
  resolved_from?: string | null;
  resolved_to?: string | null;
};

function values(overrides: Row = {}): [string, unknown[]] {
  const row = {
    event_type: 'room_reservation_created',
    booking_reference: nextReference(),
    recipient_kind: 'hotel',
    recipient_email: null,
    template_key: 'room_created_hotel.v1',
    payload: PAYLOAD,
    attempts: 0,
    last_attempt_acceptance: null,
    resolved_from: null,
    resolved_to: null,
    ...overrides,
  };

  return [
    `INSERT INTO notification_outbox
       (event_type, booking_reference, recipient_kind, recipient_email,
        template_key, payload, attempts, last_attempt_acceptance,
        resolved_from, resolved_to)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
     RETURNING id`,
    [
      row.event_type,
      row.booking_reference,
      row.recipient_kind,
      row.recipient_email,
      row.template_key,
      row.payload,
      row.attempts,
      row.last_attempt_acceptance,
      row.resolved_from,
      row.resolved_to,
    ],
  ];
}

/** Inserts one row and returns its id. Fails the test if the database refuses. */
async function insert(overrides: Row = {}): Promise<string> {
  const [sql, params] = values(overrides);
  const { rows } = await client.query<{ id: string }>(sql, params);

  return rows[0]!.id;
}

/**
 * Asserts the database refuses this row, naming the constraint.
 *
 * The SAVEPOINT is what keeps the transaction usable afterwards: in PostgreSQL
 * any raised error aborts the whole transaction, so without it the first
 * expected rejection would poison every later assertion. The same idiom
 * `packages.schema.integration.test.ts` already uses.
 */
async function rejects(overrides: Row, constraint: string, code = '23514'): Promise<void> {
  const [sql, params] = values(overrides);

  await client.query('SAVEPOINT expected_rejection');

  try {
    await assert.rejects(client.query(sql, params), (error: unknown) => {
      const failure = error as { code?: string; constraint?: string };

      assert.equal(failure.code, code, `expected SQLSTATE ${code}, got ${failure.code}`);
      assert.equal(failure.constraint, constraint);
      return true;
    });
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_rejection');
    await client.query('RELEASE SAVEPOINT expected_rejection');
  }
}

before(async () => {
  await runner({
    databaseUrl: process.env.DATABASE_URL!,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    dir: path.resolve(__dirname, '../src/db/migrations'),
    log: () => undefined,
  });

  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));

  // One client for the suite: the rejection helper needs savepoints, which
  // only mean something inside one transaction on one connection.
  client = await dbPool.connect();
  await client.query('BEGIN');
});

after(async () => {
  try {
    // Everything this suite wrote is inside the open transaction, so rolling
    // back removes all of it. The delete below is belt and braces for a row
    // that somehow escaped, and it is scoped to this run's prefix alone.
    await client.query('ROLLBACK');
    client.release();

    await dbPool.query('DELETE FROM notification_outbox WHERE booking_reference LIKE $1', [
      `${referencePrefix}%`,
    ]);

    const { rows } = await dbPool.query<{ left: number }>(
      'SELECT COUNT(*)::int AS left FROM notification_outbox WHERE booking_reference LIKE $1',
      [`${referencePrefix}%`],
    );

    assert.equal(rows[0]?.left, 0, 'fixture rows were not fully removed');
  } finally {
    await closeDatabasePool();
  }
});

describe('notification_outbox: shape', () => {
  it('carries exactly the agreed columns', async () => {
    const { rows } = await client.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notification_outbox'
        ORDER BY column_name`,
    );

    assert.deepEqual(
      rows.map((row) => row.column_name),
      [
        'accepted_at',
        'attempts',
        'booking_reference',
        'created_at',
        'event_type',
        'failed_at',
        'id',
        'last_attempt_acceptance',
        'last_attempt_at',
        'last_error',
        'next_attempt_at',
        'payload',
        'provider_reference',
        'recipient_email',
        'recipient_kind',
        'resolved_from',
        'resolved_to',
        'template_key',
        'updated_at',
      ],
    );

    const typeOf = (name: string) => rows.find((row) => row.column_name === name)?.data_type;

    assert.equal(typeOf('payload'), 'jsonb');
    assert.equal(typeOf('attempts'), 'integer');
    assert.equal(typeOf('next_attempt_at'), 'timestamp with time zone');
  });

  it('holds no status column, and no column that could carry a body or an internal id', async () => {
    // State is derived from accepted_at/failed_at; a status column would be a
    // second truth. A rendered body and a reservation id are both things this
    // table decided not to store.
    const { rows } = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notification_outbox'`,
    );

    for (const name of rows.map((row) => row.column_name)) {
      assert.doesNotMatch(
        name,
        /^status$|html|body|subject|api_key|secret|token|reservation_id|package_id|room_id/,
        `${name} does not belong in this table`,
      );
    }
  });

  it('has no foreign key, so neither reservations table constrains it', async () => {
    const { rows } = await client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.notification_outbox'::regclass AND contype = 'f'`,
    );

    assert.deepEqual(rows, []);
  });
});

describe('notification_outbox: the rules the database enforces', () => {
  it('accepts a hotel event with no recipient address', async () => {
    assert.ok(await insert({ recipient_kind: 'hotel', recipient_email: null }));
  });

  it('accepts a guest event carrying its recipient', async () => {
    assert.ok(
      await insert({
        event_type: 'room_reservation_confirmed',
        recipient_kind: 'guest',
        recipient_email: 'guest@example.test',
        template_key: 'room_confirmed_guest.v1',
      }),
    );
  });

  it('accepts all four event types', async () => {
    for (const event_type of [
      'room_reservation_created',
      'room_reservation_confirmed',
      'package_reservation_created',
      'package_reservation_confirmed',
    ]) {
      assert.ok(await insert({ event_type }), event_type);
    }
  });

  it('rejects an event type outside the four', async () => {
    for (const event_type of [
      'room_reservation_cancelled',
      'reservation_created',
      'ROOM_RESERVATION_CREATED',
      '',
    ]) {
      await rejects({ event_type }, 'notification_outbox_event_type_check');
    }
  });

  it('rejects a recipient kind outside the two', async () => {
    await rejects(
      { recipient_kind: 'admin', recipient_email: null },
      'notification_outbox_recipient_kind_check',
    );
  });

  it('rejects a guest event with no address', async () => {
    await rejects(
      { recipient_kind: 'guest', recipient_email: null },
      'notification_outbox_recipient_pairing_check',
    );
  });

  it('rejects a hotel event carrying an address', async () => {
    // The hotel's address is configuration resolved at claim time, so a
    // snapshotted one here would be a second, stale source for it.
    await rejects(
      { recipient_kind: 'hotel', recipient_email: 'hotel@example.test' },
      'notification_outbox_recipient_pairing_check',
    );
  });

  it('rejects negative attempts', async () => {
    await rejects({ attempts: -1 }, 'notification_outbox_attempts_check');
  });

  it('accepts an unresolved envelope, and a fully resolved one', async () => {
    assert.ok(await insert({ resolved_from: null, resolved_to: null }));
    assert.ok(
      await insert({ resolved_from: 'hotel@example.test', resolved_to: 'ops@example.test' }),
    );
  });

  it('rejects a half-resolved envelope, in either direction', async () => {
    await rejects(
      { resolved_from: 'hotel@example.test', resolved_to: null },
      'notification_outbox_resolved_envelope_check',
    );
    await rejects(
      { resolved_from: null, resolved_to: 'ops@example.test' },
      'notification_outbox_resolved_envelope_check',
    );
  });

  it('accepts both acceptance verdicts, and none recorded', async () => {
    for (const last_attempt_acceptance of ['rejected', 'unknown', null]) {
      assert.ok(await insert({ last_attempt_acceptance }), String(last_attempt_acceptance));
    }
  });

  it('rejects an acceptance verdict outside the two', async () => {
    // `accepted` is deliberately not a verdict: accepted_at records that, and
    // a second place to say it is a second place to be wrong.
    for (const last_attempt_acceptance of ['accepted', 'transient', 'blocked', 'permanent', '']) {
      await rejects(
        { last_attempt_acceptance },
        'notification_outbox_last_attempt_acceptance_check',
      );
    }
  });
});

describe('notification_outbox: one notification per event per booking', () => {
  it('refuses a second row for the same event and reference', async () => {
    const booking_reference = nextReference();

    await insert({ event_type: 'room_reservation_created', booking_reference });

    await rejects(
      { event_type: 'room_reservation_created', booking_reference },
      'notification_outbox_event_booking_key',
      '23505',
    );
  });

  it('allows the same reference under a different event type', async () => {
    // A booking legitimately produces two notifications: the hotel is told it
    // arrived, and the guest is told it was confirmed.
    const booking_reference = nextReference();

    assert.ok(
      await insert({
        event_type: 'room_reservation_created',
        booking_reference,
        recipient_kind: 'hotel',
        recipient_email: null,
      }),
    );
    assert.ok(
      await insert({
        event_type: 'room_reservation_confirmed',
        booking_reference,
        recipient_kind: 'guest',
        recipient_email: 'guest@example.test',
        template_key: 'room_confirmed_guest.v1',
      }),
    );
  });

  it('allows the same reference across the room and package event families', async () => {
    // References are unique per reservations table, not across both, so the
    // same string can legitimately name a room booking and a journey booking.
    const booking_reference = nextReference();

    assert.ok(await insert({ event_type: 'room_reservation_created', booking_reference }));
    assert.ok(await insert({ event_type: 'package_reservation_created', booking_reference }));
  });
});

describe('notification_outbox: the claim index', () => {
  it('exists over (next_attempt_at, id), restricted to rows still to send', async () => {
    const { rows } = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'notification_outbox'
          AND indexname = 'notification_outbox_claim_idx'`,
    );

    const indexdef = rows[0]?.indexdef;
    assert.ok(indexdef, 'the claim index should exist');

    // Column order is load-bearing: the claim orders by due time then id, and
    // an index in the other order would sort the queue instead of stopping at
    // the batch limit.
    assert.match(indexdef, /\(next_attempt_at, id\)/);
    // Partial, so the index stays the size of the backlog rather than the
    // history. Without the predicate every sent row would still be in it.
    //
    // Asserted in parts rather than as one literal: how PostgreSQL
    // parenthesises a deparsed predicate is a formatting detail of the
    // server version, and pinning it would fail on an upgrade that changed
    // nothing about the index.
    assert.match(indexdef, /WHERE /);
    assert.match(indexdef, /accepted_at IS NULL/);
    assert.match(indexdef, /failed_at IS NULL/);
    assert.match(indexdef, / AND /);
  });

  it('adds no index beyond the claim index and the ones its constraints require', async () => {
    const { rows } = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'notification_outbox'
        ORDER BY indexname`,
    );

    assert.deepEqual(
      rows.map((row) => row.indexname),
      [
        'notification_outbox_claim_idx',
        'notification_outbox_event_booking_key',
        'notification_outbox_pkey',
      ],
    );
  });
});

describe('notification_outbox: the down migration', () => {
  // The migration's own down path is not run against this shared database —
  // that would take the table away from everything else. What is proven is the
  // claim it makes: that dropping this one table removes it and needs nothing
  // else named, which is what having no foreign key buys. Done inside a
  // savepoint and rolled straight back.
  it('removes only this table, with nothing else to name', async () => {
    await client.query('SAVEPOINT down_migration');

    try {
      await client.query('DROP TABLE notification_outbox');

      const { rows } = await client.query<{ present: number }>(
        `SELECT COUNT(*)::int AS present FROM pg_tables
          WHERE schemaname = 'public' AND tablename = 'notification_outbox'`,
      );

      assert.equal(rows[0]?.present, 0);

      // The two tables a notification is about are untouched, because nothing
      // ties them to it.
      const { rows: survivors } = await client.query<{ present: number }>(
        `SELECT COUNT(*)::int AS present FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename IN ('reservations', 'package_reservations')`,
      );

      assert.equal(survivors[0]?.present, 2);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT down_migration');
      await client.query('RELEASE SAVEPOINT down_migration');
    }
  });
});
