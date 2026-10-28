import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { PoolClient } from '../src/db/pool';
import {
  claimNotificationEvents,
  markNotificationAbandoned,
  markNotificationAccepted,
  markNotificationAttemptFailed,
} from '../src/modules/notifications/notifications.repository';

// The claim, against real PostgreSQL.
//
// Everything here is a rule only the database can settle, and every one of
// them is load-bearing:
//
//   * SKIP LOCKED really divides a backlog — two dispatchers must never both
//     hold the same row, and must not serialise on its head either;
//   * the claim really orders by `(next_attempt_at, id)`;
//   * accepted, abandoned and not-yet-due rows are really invisible to it;
//   * COALESCE really freezes the envelope, so a settings change between
//     attempts cannot alter a queued message and turn a legitimate retry into
//     a rejected conflicting replay;
//   * `attempts = $expectedAttempt` really stops a slow attempt from writing
//     its answer over a newer one.
//
// A stub can be told any of that. Only the database can be asked.
//
// Every row this suite writes carries a booking reference unique to the run,
// and exactly those rows are removed afterwards.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];

const runId = randomUUID().slice(0, 8);
const referencePrefix = `ITEST-CLAIM-${runId}`;

let sequence = 0;
const nextReference = () => `${referencePrefix}-${(sequence += 1)}`;

const FROM = 'hotel@example.test';
const HOTEL_RECIPIENT = 'desk@example.test';
const GUEST_EMAIL = 'guest@example.test';

const claimInput = (overrides: Partial<Parameters<typeof claimNotificationEvents>[1]> = {}) => ({
  limit: 10,
  resolvedFrom: FROM,
  hotelRecipient: HOTEL_RECIPIENT,
  leaseSeconds: 300,
  ...overrides,
});

/**
 * Inserts one queued row.
 *
 * `dueInSeconds` is relative to the database's clock, never this process's, so
 * a machine whose clock has drifted cannot make a row look due when it is not.
 */
async function insertQueued(options: {
  reference?: string;
  recipientKind?: 'hotel' | 'guest';
  dueInSeconds?: number;
} = {}): Promise<string> {
  const reference = options.reference ?? nextReference();
  const kind = options.recipientKind ?? 'hotel';

  await dbPool.query(
    `INSERT INTO notification_outbox
       (event_type, booking_reference, recipient_kind, recipient_email, template_key, payload,
        next_attempt_at)
     VALUES ('room_reservation_created', $1, $2, $3, 'room_created_hotel.v1',
             '{"bookingReference":"fixture"}',
             UTC_TIMESTAMP(3) + INTERVAL $4 SECOND)`,
    [reference, kind, kind === 'guest' ? GUEST_EMAIL : null, options.dueInSeconds ?? -1],
  );

  return reference;
}

const readRow = async (reference: string) =>
  (await dbPool.query(
    `SELECT CAST(id AS CHAR) AS id, attempts, accepted_at, failed_at, next_attempt_at,
            resolved_from, resolved_to, provider_reference, last_error, last_attempt_acceptance
       FROM notification_outbox WHERE booking_reference = $1`,
    [reference],
  )).rows[0];

/** Runs one claim inside its own short transaction, as a dispatcher would. */
async function claimInTransaction(
  input: Parameters<typeof claimNotificationEvents>[1] = claimInput(),
): Promise<Awaited<ReturnType<typeof claimNotificationEvents>>> {
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');
    const claimed = await claimNotificationEvents(client, input);
    await client.query('COMMIT');

    return claimed;
  } finally {
    client.release();
  }
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
});

after(async () => {
  try {
    const { rowCount } = await dbPool.query(
      'DELETE FROM notification_outbox WHERE booking_reference LIKE $1',
      [`${referencePrefix}-%`],
    );
    assert.ok((rowCount ?? 0) >= 0);

    const { rows } = await dbPool.query<{ total: number }>(
      'SELECT CAST(COUNT(*) AS SIGNED) AS total FROM notification_outbox WHERE booking_reference LIKE $1',
      [`${referencePrefix}-%`],
    );
    assert.equal(Number(rows[0]?.total), 0, 'this run left rows behind');
  } finally {
    await closeDatabasePool();
  }
});

beforeEach(async () => {
  // Each test starts from a clean slate of its own rows, so a claim with a
  // generous limit cannot pick up a previous test's leftovers.
  await dbPool.query('DELETE FROM notification_outbox WHERE booking_reference LIKE $1', [
    `${referencePrefix}-%`,
  ]);
});

describe('claiming against PostgreSQL', () => {
  it('claims a due row, counts the attempt and returns the new number', async () => {
    const reference = await insertQueued();

    const claimed = await claimInTransaction();

    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]?.bookingReference, reference);
    assert.equal(claimed[0]?.attempts, 1, 'the count including this claim');
    assert.equal((await readRow(reference)).attempts, 1);
  });

  it('increments attempts once per claim, not once per row read', async () => {
    const reference = await insertQueued();

    await claimInTransaction(claimInput({ leaseSeconds: -1 }));
    await claimInTransaction(claimInput({ leaseSeconds: -1 }));
    const third = await claimInTransaction(claimInput({ leaseSeconds: -1 }));

    assert.equal(third[0]?.attempts, 3);
    assert.equal((await readRow(reference)).attempts, 3);
  });

  it('moves the row out of reach for the lease it was given', async () => {
    await insertQueued();

    const first = await claimInTransaction(claimInput({ leaseSeconds: 300 }));
    assert.equal(first.length, 1);

    // Still leased, so a second dispatcher polling now sees nothing.
    assert.deepEqual(await claimInTransaction(), []);
  });

  it('excludes accepted, abandoned and not-yet-due rows', async () => {
    const accepted = await insertQueued();
    const abandoned = await insertQueued();
    const future = await insertQueued({ dueInSeconds: 3600 });
    const due = await insertQueued();

    const acceptedRow = await readRow(accepted);
    const abandonedRow = await readRow(abandoned);

    // Claim them first so the guards have the attempt they expect.
    await claimInTransaction(claimInput({ leaseSeconds: -1 }));

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      await markNotificationAccepted(client, {
        id: acceptedRow.id,
        expectedAttempt: 1,
        providerReference: 'msg_accepted',
      });
      await markNotificationAbandoned(client, {
        id: abandonedRow.id,
        expectedAttempt: 1,
        acceptance: 'rejected',
        error: 'refused',
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const claimed = await claimInTransaction(claimInput({ leaseSeconds: -1 }));
    const references = claimed.map((event) => event.bookingReference);

    assert.ok(references.includes(due), 'the due row is claimable');
    assert.ok(!references.includes(accepted), 'an accepted row is invisible');
    assert.ok(!references.includes(abandoned), 'an abandoned row is invisible');
    assert.ok(!references.includes(future), 'a row that is not due yet is invisible');
  });

  it('claims in next_attempt_at order, then id', async () => {
    // Inserted newest-due first, so insertion order cannot be what produces
    // the expected result.
    const later = await insertQueued({ dueInSeconds: -1 });
    const earlier = await insertQueued({ dueInSeconds: -600 });
    const earlierToo = await insertQueued({ dueInSeconds: -600 });

    const claimed = await claimInTransaction();

    assert.deepEqual(
      claimed.map((event) => event.bookingReference),
      [earlier, earlierToo, later],
      'due first; ties broken by id, which is insertion order here',
    );
  });
});

describe('two dispatchers claiming at once', () => {
  it('never gives the same row to both', async () => {
    await insertQueued();

    const first = await dbPool.connect();
    const second = await dbPool.connect();

    try {
      await first.query('BEGIN');
      await second.query('BEGIN');

      // The first holds the only row. The second must skip it rather than
      // block, which is the whole point of SKIP LOCKED.
      const firstClaim = await claimNotificationEvents(first, claimInput());
      const secondClaim = await claimNotificationEvents(second, claimInput());

      assert.equal(firstClaim.length, 1, 'the first dispatcher took it');
      assert.equal(secondClaim.length, 0, 'the second was not handed the same row');

      await first.query('COMMIT');
      await second.query('COMMIT');
    } finally {
      first.release();
      second.release();
    }
  });

  it('divides eligible rows between them without overlap', async () => {
    const references = [];
    for (let index = 0; index < 6; index += 1) {
      references.push(await insertQueued());
    }

    const first = await dbPool.connect();
    const second = await dbPool.connect();

    try {
      await first.query('BEGIN');
      await second.query('BEGIN');

      const firstClaim = await claimNotificationEvents(first, claimInput({ limit: 3 }));
      const secondClaim = await claimNotificationEvents(second, claimInput({ limit: 3 }));

      await first.query('COMMIT');
      await second.query('COMMIT');

      const firstIds = firstClaim.map((event) => event.bookingReference);
      const secondIds = secondClaim.map((event) => event.bookingReference);

      assert.equal(firstIds.length, 3);
      assert.equal(secondIds.length, 3, 'the second worker was not blocked into claiming nothing');
      assert.equal(new Set([...firstIds, ...secondIds]).size, 6, 'no row was handed to both');
      assert.deepEqual([...firstIds, ...secondIds].sort(), [...references].sort());
    } finally {
      first.release();
      second.release();
    }
  });
});

describe('the envelope freezes at the first claim', () => {
  it('resolves a hotel row to the configured recipient', async () => {
    const reference = await insertQueued({ recipientKind: 'hotel' });

    const [claimed] = await claimInTransaction();

    assert.equal(claimed?.resolvedFrom, FROM);
    assert.equal(claimed?.resolvedTo, HOTEL_RECIPIENT);

    const row = await readRow(reference);
    assert.equal(row.resolved_to, HOTEL_RECIPIENT, 'and it was persisted');
  });

  it('resolves a guest row to its own recipient_email', async () => {
    await insertQueued({ recipientKind: 'guest' });

    const [claimed] = await claimInTransaction();

    assert.equal(claimed?.resolvedTo, GUEST_EMAIL, 'never the configured hotel address');
  });

  it('keeps the first envelope when a later claim supplies different addresses', async () => {
    // The reason the freeze exists: every retry goes under one idempotency
    // key, so a settings change between attempts must not alter the message.
    const reference = await insertQueued({ recipientKind: 'hotel' });

    await claimInTransaction(claimInput({ leaseSeconds: -1 }));

    const [reclaimed] = await claimInTransaction(
      claimInput({
        leaseSeconds: -1,
        resolvedFrom: 'changed-sender@example.test',
        hotelRecipient: 'changed-desk@example.test',
      }),
    );

    assert.equal(reclaimed?.resolvedFrom, FROM, 'the original sender survived');
    assert.equal(reclaimed?.resolvedTo, HOTEL_RECIPIENT, 'and the original recipient');

    const row = await readRow(reference);
    assert.equal(row.resolved_from, FROM);
    assert.equal(row.resolved_to, HOTEL_RECIPIENT);
  });
});

describe('stale completions', () => {
  /** Claims the row and returns its id plus the attempt that claim produced. */
  async function claimOnce(reference: string): Promise<{ id: string; attempt: number }> {
    const [claimed] = await claimInTransaction(claimInput({ leaseSeconds: -1 }));

    assert.ok(claimed, `expected to claim ${reference}`);

    return { id: claimed.id, attempt: claimed.attempts };
  }

  const inTransaction = async <T>(run: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await dbPool.connect();

    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');

      return result;
    } finally {
      client.release();
    }
  };

  it('refuses a completion carrying an attempt the row has moved past', async () => {
    const reference = await insertQueued();
    const stale = await claimOnce(reference);
    // Somebody else re-claimed it: attempts is now 2, the slow sender still
    // believes it is 1.
    await claimOnce(reference);

    const result = await inTransaction((client) =>
      markNotificationAccepted(client, {
        id: stale.id,
        expectedAttempt: stale.attempt,
        providerReference: 'msg_stale',
      }),
    );

    assert.deepEqual(result, { applied: false });

    const row = await readRow(reference);
    assert.equal(row.accepted_at, null, 'the stale send did not settle the row');
    assert.equal(row.provider_reference, null, 'nor wrote its reference');
    assert.equal(row.attempts, 2, 'and the newer attempt still stands');
  });

  it('refuses a stale failure and a stale abandonment too', async () => {
    const reference = await insertQueued();
    const stale = await claimOnce(reference);
    await claimOnce(reference);

    const failed = await inTransaction((client) =>
      markNotificationAttemptFailed(client, {
        id: stale.id,
        expectedAttempt: stale.attempt,
        acceptance: 'unknown',
        error: 'stale timeout',
        retryAfterSeconds: 60,
      }),
    );
    const abandoned = await inTransaction((client) =>
      markNotificationAbandoned(client, {
        id: stale.id,
        expectedAttempt: stale.attempt,
        acceptance: 'rejected',
        error: 'stale give-up',
      }),
    );

    assert.deepEqual(failed, { applied: false });
    assert.deepEqual(abandoned, { applied: false });

    const row = await readRow(reference);
    assert.equal(row.failed_at, null, 'a stale worker cannot abandon a live row');
    assert.equal(row.last_error, null, 'nor leave its reason on one');
  });

  it('applies a completion that still matches the claim', async () => {
    const reference = await insertQueued();
    const current = await claimOnce(reference);

    const result = await inTransaction((client) =>
      markNotificationAccepted(client, {
        id: current.id,
        expectedAttempt: current.attempt,
        providerReference: 'msg_live',
      }),
    );

    assert.deepEqual(result, { applied: true });

    const row = await readRow(reference);
    assert.ok(row.accepted_at instanceof Date);
    assert.equal(row.provider_reference, 'msg_live');
  });
});

describe('a settled row stays settled', () => {
  const inTransaction = async <T>(run: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await dbPool.connect();

    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');

      return result;
    } finally {
      client.release();
    }
  };

  it('cannot mutate an accepted row afterwards', async () => {
    const reference = await insertQueued();
    const [claimed] = await claimInTransaction(claimInput({ leaseSeconds: -1 }));
    assert.ok(claimed);

    await inTransaction((client) =>
      markNotificationAccepted(client, {
        id: claimed.id,
        expectedAttempt: claimed.attempts,
        providerReference: 'msg_first',
      }),
    );
    const settled = await readRow(reference);

    const failed = await inTransaction((client) =>
      markNotificationAttemptFailed(client, {
        id: claimed.id,
        expectedAttempt: claimed.attempts,
        acceptance: 'unknown',
        error: 'too late',
        retryAfterSeconds: 60,
      }),
    );
    const abandoned = await inTransaction((client) =>
      markNotificationAbandoned(client, {
        id: claimed.id,
        expectedAttempt: claimed.attempts,
        acceptance: 'rejected',
        error: 'too late',
      }),
    );
    const acceptedAgain = await inTransaction((client) =>
      markNotificationAccepted(client, {
        id: claimed.id,
        expectedAttempt: claimed.attempts,
        providerReference: 'msg_second',
      }),
    );

    assert.deepEqual(failed, { applied: false });
    assert.deepEqual(abandoned, { applied: false });
    assert.deepEqual(acceptedAgain, { applied: false }, 'the first acceptance is authoritative');

    const after = await readRow(reference);
    assert.deepEqual(after.accepted_at, settled.accepted_at, 'the timestamp did not move');
    assert.equal(after.provider_reference, 'msg_first', 'nor the reference');
    assert.equal(after.failed_at, null);
  });

  it('cannot mutate an abandoned row afterwards, least of all into an accepted one', async () => {
    const reference = await insertQueued();
    const [claimed] = await claimInTransaction(claimInput({ leaseSeconds: -1 }));
    assert.ok(claimed);

    await inTransaction((client) =>
      markNotificationAbandoned(client, {
        id: claimed.id,
        expectedAttempt: claimed.attempts,
        acceptance: 'unknown',
        error: 'gave up',
      }),
    );
    const settled = await readRow(reference);

    const acceptedLate = await inTransaction((client) =>
      markNotificationAccepted(client, {
        id: claimed.id,
        expectedAttempt: claimed.attempts,
        providerReference: 'msg_late',
      }),
    );
    const retried = await inTransaction((client) =>
      markNotificationAttemptFailed(client, {
        id: claimed.id,
        expectedAttempt: claimed.attempts,
        acceptance: 'rejected',
        error: 'later still',
        retryAfterSeconds: 60,
      }),
    );

    assert.deepEqual(acceptedLate, { applied: false }, 'a failed row never becomes accepted');
    assert.deepEqual(retried, { applied: false });

    const after = await readRow(reference);
    assert.equal(after.accepted_at, null, 'the give-up stands');
    assert.deepEqual(after.failed_at, settled.failed_at);
    assert.equal(after.last_error, 'gave up');
  });

  it('leaves an abandoned row out of every later claim', async () => {
    const reference = await insertQueued();
    const [claimed] = await claimInTransaction(claimInput({ leaseSeconds: -1 }));
    assert.ok(claimed);

    await inTransaction((client) =>
      markNotificationAbandoned(client, {
        id: claimed.id,
        expectedAttempt: claimed.attempts,
        acceptance: 'unknown',
        error: 'gave up',
      }),
    );

    const later = await claimInTransaction();

    assert.ok(
      !later.some((event) => event.bookingReference === reference),
      'a row nobody was told about is not silently retried forever',
    );
  });
});
