import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from '../src/db/pool';
import {
  claimNotificationEvents,
  markNotificationAbandoned,
  markNotificationAccepted,
  markNotificationAttemptFailed,
} from '../src/modules/notifications/notifications.repository';

// The dispatcher side of the outbox, against a recording client.
//
// No database and no pool: these functions import `PoolClient` as a type only.
// What is under test is the contract each statement has with the transaction it
// is handed — which columns it touches, which it must never touch, and the
// guards that keep a settled row settled.
//
// The behaviour only MySQL can settle — that SKIP LOCKED really divides a
// backlog between workers, that COALESCE really freezes an envelope after the
// first claim — belongs in an integration suite and is not claimed here.

type Recorded = { text: string; values: unknown[] };

function recordingClient(
  rows: unknown[] = [],
  options: { readonly matched?: number } = {},
): { client: PoolClient; statements: Recorded[] } {
  const statements: Recorded[] = [];

  const client = {
    async query(text: string, values: unknown[] = []): Promise<unknown> {
      statements.push({ text, values });
      // The claim is three statements on MySQL (no UPDATE ... RETURNING): the
      // locking SELECT, the lease UPDATE, and the read-back of the leased rows.
      if (text.includes('SKIP LOCKED')) {
        const picked = (rows as Array<Record<string, unknown>>).map((row) => ({
          id: row.id,
          next_attempt_at: row.claim_due_at,
        }));
        return { rows: picked, rowCount: picked.length };
      }
      if (text.includes('CAST(o.id AS CHAR)')) {
        const leased = (rows as Array<Record<string, unknown>>).map(({ claim_due_at: _due, ...rest }) => rest);
        return { rows: leased, rowCount: leased.length };
      }
      if (text.trimStart().startsWith('UPDATE notification_outbox') && text.includes('IN (')) {
        return { rows: [], rowCount: options.matched ?? rows.length };
      }
      // `matched` stands in for the row count an UPDATE reports, which is what
      // decides `applied`. Zero is how the database says "your guard did not
      // match", not an error.
      return { rows, rowCount: options.matched ?? rows.length };
    },
  } as unknown as PoolClient;

  return { client, statements };
}

const DUE = new Date('2026-09-20T10:00:00.000Z');

const claimedRow = (overrides: Record<string, unknown> = {}) => ({
  claim_due_at: DUE,
  id: '42',
  event_type: 'room_reservation_created',
  booking_reference: 'TPH-A2B3C4D5E6F7',
  recipient_kind: 'hotel',
  recipient_email: null,
  template_key: 'room_created_hotel.v1',
  payload: { bookingReference: 'TPH-A2B3C4D5E6F7', guestFirstName: 'Amina' },
  attempts: 1,
  resolved_from: 'hotel@example.test',
  resolved_to: 'desk@example.test',
  ...overrides,
});

const CLAIM_INPUT = {
  limit: 10,
  resolvedFrom: 'hotel@example.test',
  hotelRecipient: 'desk@example.test',
  leaseSeconds: 120,
};

/**
 * Just the SET clause.
 *
 * The guards live in the WHERE and legitimately name `attempts`, so a search
 * of the whole statement cannot answer "is this column written".
 */
const setClause = (text: string): string => {
  const clause = /SET([\s\S]*?)\s+WHERE/.exec(text)?.[1];

  assert.ok(clause, 'expected a SET clause');

  return clause;
};

/** The three statements of a claim, in order. */
const claim = (statements: Recorded[]): { select: Recorded; update: Recorded; read: Recorded } => {
  assert.equal(statements.length, 3, `expected three statements, got ${statements.length}`);

  return { select: statements[0] as Recorded, update: statements[1] as Recorded, read: statements[2] as Recorded };
};

const only = (statements: Recorded[]): Recorded => {
  assert.equal(statements.length, 1, `expected one statement, got ${statements.length}`);

  return statements[0] as Recorded;
};

describe('claimNotificationEvents', () => {
  it('leases on the client it was given, in three statements', async () => {
    const { client, statements } = recordingClient([claimedRow()]);
    const { client: untouched, statements: untouchedStatements } = recordingClient();

    await claimNotificationEvents(client, CLAIM_INPUT);

    assert.equal(statements.length, 3, 'select-and-lock, lease, read back');
    assert.equal(untouchedStatements.length, 0, 'no other client was used');
    assert.ok(untouched);
  });

  it('claims only rows that are due and not already settled', async () => {
    const { client, statements } = recordingClient();

    await claimNotificationEvents(client, CLAIM_INPUT);

    const { text } = only(statements);
    assert.match(text, /WHERE accepted_at IS NULL/);
    assert.match(text, /AND failed_at IS NULL/);
    assert.match(text, /AND next_attempt_at <= UTC_TIMESTAMP\(3\)/);
  });

  it('takes the lock that lets two dispatchers share a backlog', async () => {
    const { client, statements } = recordingClient();

    await claimNotificationEvents(client, CLAIM_INPUT);

    // Without SKIP LOCKED a second worker would block on the first row rather
    // than move past it, and the two would serialise instead of dividing.
    assert.match(only(statements).text, /FOR UPDATE SKIP LOCKED/);
  });

  it('orders by the claim index, due first then oldest', async () => {
    const { client, statements } = recordingClient();

    await claimNotificationEvents(client, CLAIM_INPUT);

    assert.match(only(statements).text, /ORDER BY next_attempt_at, id/);
    assert.match(only(statements).text, /LIMIT \$1/);
  });

  it('counts the attempt at claim time', async () => {
    // A process that dies mid-flight has still used an attempt. Counting only
    // completed sends would let a row that crashes the sender retry forever.
    const { client, statements } = recordingClient([claimedRow()]);

    await claimNotificationEvents(client, CLAIM_INPUT);

    const { text } = claim(statements).update;
    assert.match(text, /SET attempts = attempts \+ 1/);
    assert.match(text, /last_attempt_at = UTC_TIMESTAMP\(3\)/);
  });

  it('moves the row out of reach for the lease it was given', async () => {
    const { client, statements } = recordingClient([claimedRow()]);

    await claimNotificationEvents(client, CLAIM_INPUT);

    const { text, values } = claim(statements).update;
    assert.match(text, /next_attempt_at = UTC_TIMESTAMP\(3\) \+ INTERVAL \? SECOND/);
    assert.equal(values[0], 120, 'the caller decides how long a send may take');
  });

  it('resolves the envelope first-write-wins, never overwriting one', async () => {
    // Every retry goes under one idempotency key, so a settings change between
    // attempts must not be able to alter a queued message.
    const { client, statements } = recordingClient([claimedRow()]);

    await claimNotificationEvents(client, CLAIM_INPUT);

    const { text, values } = claim(statements).update;
    assert.match(text, /resolved_from = COALESCE\(resolved_from, \?\)/);
    // A guest row keeps its own address; only a hotel row falls through to the
    // configured recipient.
    assert.match(text, /resolved_to = COALESCE\(resolved_to, recipient_email, \?\)/);
    assert.equal(values[1], 'hotel@example.test');
    assert.equal(values[2], 'desk@example.test');
  });

  it('opens no transaction and acquires no connection', async () => {
    const { client, statements } = recordingClient();

    await claimNotificationEvents(client, CLAIM_INPUT);

    for (const { text } of statements) {
      assert.doesNotMatch(text, /\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/i);
    }
  });

  it('maps a claimed row onto exactly the sending contract', async () => {
    const { client } = recordingClient([claimedRow()]);

    const [claimed] = await claimNotificationEvents(client, CLAIM_INPUT);

    assert.deepEqual(claimed, {
      id: '42',
      eventType: 'room_reservation_created',
      bookingReference: 'TPH-A2B3C4D5E6F7',
      recipientKind: 'hotel',
      recipientEmail: null,
      templateKey: 'room_created_hotel.v1',
      payload: { bookingReference: 'TPH-A2B3C4D5E6F7', guestFirstName: 'Amina' },
      attempts: 1,
      resolvedFrom: 'hotel@example.test',
      resolvedTo: 'desk@example.test',
    });
  });

  it('keeps the id as text', async () => {
    // A bigint through a float may no longer identify the row it came from.
    const { client } = recordingClient([claimedRow({ id: '9007199254740993' })]);

    const [claimed] = await claimNotificationEvents(client, CLAIM_INPUT);

    assert.equal(claimed?.id, '9007199254740993');
    assert.equal(typeof claimed?.id, 'string');
  });

  it('returns rows in claim order whatever order the driver gives them', async () => {
    // The read-back promises nothing about ordering.
    const { client } = recordingClient([
      claimedRow({ id: '7' }),
      claimedRow({ id: '2' }),
      claimedRow({ id: '30' }),
    ]);

    const claimed = await claimNotificationEvents(client, CLAIM_INPUT);

    assert.deepEqual(
      claimed.map((event) => event.id),
      ['2', '7', '30'],
      'numeric order, not the string order a naive sort would give',
    );
  });

  it('returns an empty array when nothing is due', async () => {
    const { client } = recordingClient([]);

    assert.deepEqual(await claimNotificationEvents(client, CLAIM_INPUT), []);
  });

  it('raises on a row the schema says cannot exist', async () => {
    // A NOT NULL column arriving null is a data or migration fault, reported
    // loudly rather than sent as an email addressed to `undefined`.
    for (const broken of [{ template_key: null }, { booking_reference: '' }, { id: '0' }, { attempts: 0 }]) {
      const { client } = recordingClient([claimedRow(broken)]);

      await assert.rejects(
        () => claimNotificationEvents(client, CLAIM_INPUT),
        /Unexpected notification/,
        `${JSON.stringify(broken)} must be refused`,
      );
    }
  });

  it('hands the payload back exactly as stored, unvalidated', async () => {
    // Checking it against its template contract is the renderer's job; doing it
    // here too would be two things that could disagree.
    const payload = { anything: ['at', 'all'], nested: { deep: true } };
    const { client } = recordingClient([claimedRow({ payload })]);

    const [claimed] = await claimNotificationEvents(client, CLAIM_INPUT);

    assert.deepEqual(claimed?.payload, payload);
  });
});

describe('markNotificationAccepted', () => {
  it('records acceptance and the provider reference, in one statement', async () => {
    const { client, statements } = recordingClient();

    await markNotificationAccepted(client, { id: '42', expectedAttempt: 3, providerReference: 'msg_123' });

    const { text, values } = only(statements);
    assert.match(text, /SET accepted_at = UTC_TIMESTAMP\(3\)/);
    assert.match(text, /provider_reference = \$3/);
    assert.deepEqual(values, ['42', 3, 'msg_123']);
  });

  it('clears the verdict and the error, which no longer describe the row', async () => {
    const { client, statements } = recordingClient();

    await markNotificationAccepted(client, { id: '42', expectedAttempt: 3, providerReference: null });

    assert.match(only(statements).text, /last_attempt_acceptance = NULL/);
    assert.match(only(statements).text, /last_error = NULL/);
  });

  it('refuses to accept a row that has already settled, either way', async () => {
    // A duplicated completion must not move the timestamp or overwrite the
    // reference of the send that actually succeeded — and an ABANDONED row
    // must never be turned into an accepted one by a late arrival.
    const { client, statements } = recordingClient();

    await markNotificationAccepted(client, { id: '42', expectedAttempt: 3, providerReference: 'msg_123' });

    const { text } = only(statements);
    assert.match(text, /AND accepted_at IS NULL/);
    assert.match(text, /AND failed_at IS NULL/);
  });

  it('never touches the frozen columns', async () => {
    const { client, statements } = recordingClient();

    await markNotificationAccepted(client, { id: '42', expectedAttempt: 3, providerReference: 'msg_123' });

    const written = setClause(only(statements).text);
    for (const frozen of ['event_type =', 'booking_reference =', 'recipient_kind =', 'recipient_email =',
      'template_key =', 'payload =', 'resolved_from =', 'resolved_to =', 'attempts =']) {
      assert.ok(!written.includes(frozen), `acceptance must not write ${frozen}`);
    }
  });
});

describe('markNotificationAttemptFailed', () => {
  it('records the verdict, the reason and when to try again', async () => {
    const { client, statements } = recordingClient();

    await markNotificationAttemptFailed(client, {
      id: '42',
      expectedAttempt: 3,
      acceptance: 'unknown',
      error: 'timed out',
      retryAfterSeconds: 300,
    });

    const { text, values } = only(statements);
    assert.match(text, /next_attempt_at = UTC_TIMESTAMP\(3\) \+ INTERVAL \$5 SECOND/);
    assert.match(text, /last_attempt_acceptance = \$3/);
    assert.match(text, /last_error = \$4/);
    assert.deepEqual(values, ['42', 3, 'unknown', 'timed out', 300]);
  });

  it('does not count a second attempt', async () => {
    // The claim already counted this one.
    const { client, statements } = recordingClient();

    await markNotificationAttemptFailed(client, {
      id: '42',
      expectedAttempt: 3,
      acceptance: 'rejected',
      error: null,
      retryAfterSeconds: 60,
    });

    assert.ok(
      !setClause(only(statements).text).includes('attempts ='),
      'attempts moved at claim time',
    );
  });

  it('writes nothing terminal, so the row returns to the queue', async () => {
    const { client, statements } = recordingClient();

    await markNotificationAttemptFailed(client, {
      id: '42',
      expectedAttempt: 3,
      acceptance: 'rejected',
      error: null,
      retryAfterSeconds: 60,
    });

    const written = setClause(only(statements).text);
    assert.ok(!written.includes('failed_at = '), 'giving up is a separate decision');
    assert.ok(!written.includes('accepted_at = '));
  });

  it('refuses to reopen a row that has already settled', async () => {
    const { client, statements } = recordingClient();

    await markNotificationAttemptFailed(client, {
      id: '42',
      expectedAttempt: 3,
      acceptance: 'unknown',
      error: null,
      retryAfterSeconds: 60,
    });

    const { text } = only(statements);
    assert.match(text, /AND accepted_at IS NULL/);
    assert.match(text, /AND failed_at IS NULL/);
  });

  it('never moves the envelope', async () => {
    // The next attempt has to rebuild an identical request.
    const { client, statements } = recordingClient();

    await markNotificationAttemptFailed(client, {
      id: '42',
      expectedAttempt: 3,
      acceptance: 'unknown',
      error: null,
      retryAfterSeconds: 60,
    });

    const written = setClause(only(statements).text);
    assert.ok(!written.includes('resolved_from ='));
    assert.ok(!written.includes('resolved_to ='));
  });
});

describe('markNotificationAbandoned', () => {
  it('records the give-up and the verdict that goes with it', async () => {
    const { client, statements } = recordingClient();

    await markNotificationAbandoned(client, { id: '42', expectedAttempt: 3, acceptance: 'unknown', error: 'gave up' });

    const { text, values } = only(statements);
    assert.match(text, /SET failed_at = UTC_TIMESTAMP\(3\)/);
    assert.match(text, /last_attempt_acceptance = \$3/);
    assert.deepEqual(values, ['42', 3, 'unknown', 'gave up']);
  });

  it('does not pretend the message was accepted', async () => {
    const { client, statements } = recordingClient();

    await markNotificationAbandoned(client, { id: '42', expectedAttempt: 3, acceptance: 'rejected', error: null });

    assert.ok(!setClause(only(statements).text).includes('accepted_at = '));
  });

  it('refuses to abandon a row that has already settled', async () => {
    const { client, statements } = recordingClient();

    await markNotificationAbandoned(client, { id: '42', expectedAttempt: 3, acceptance: 'rejected', error: null });

    const { text } = only(statements);
    assert.match(text, /AND accepted_at IS NULL/);
    assert.match(text, /AND failed_at IS NULL/);
  });
});

describe('stale attempts cannot overwrite a newer one', () => {
  // The lease's receipt. A send that overran its lease has had its row
  // re-claimed and re-sent by another worker, and `attempts` has moved on.
  // Without the guard the slow attempt's answer would land on top of the fast
  // one's — marking a row failed that another worker had already got accepted.

  it('guards every completion on the attempt the claim returned', async () => {
    const accepted = recordingClient();
    await markNotificationAccepted(accepted.client, {
      id: '42',
      expectedAttempt: 3,
      providerReference: 'msg_123',
    });

    const failed = recordingClient();
    await markNotificationAttemptFailed(failed.client, {
      id: '42',
      expectedAttempt: 3,
      acceptance: 'unknown',
      error: null,
      retryAfterSeconds: 60,
    });

    const abandoned = recordingClient();
    await markNotificationAbandoned(abandoned.client, {
      id: '42',
      expectedAttempt: 3,
      acceptance: 'rejected',
      error: null,
    });

    for (const { statements } of [accepted, failed, abandoned]) {
      const { text, values } = only(statements);

      assert.match(text, /AND attempts = \$2/, 'every completion is guarded on the attempt');
      assert.equal(values[1], 3, 'and the expected attempt is bound, never interpolated');
    }
  });

  it('reports applied: false when the guard matched nothing', async () => {
    // Not an error, and not silence. The row has moved on and this attempt is
    // no longer the authoritative one, which the caller has to be able to see.
    const stale = { matched: 0 };

    assert.deepEqual(
      await markNotificationAccepted(recordingClient([], stale).client, {
        id: '42',
        expectedAttempt: 1,
        providerReference: 'msg_123',
      }),
      { applied: false },
    );

    assert.deepEqual(
      await markNotificationAttemptFailed(recordingClient([], stale).client, {
        id: '42',
        expectedAttempt: 1,
        acceptance: 'unknown',
        error: null,
        retryAfterSeconds: 60,
      }),
      { applied: false },
    );

    assert.deepEqual(
      await markNotificationAbandoned(recordingClient([], stale).client, {
        id: '42',
        expectedAttempt: 1,
        acceptance: 'rejected',
        error: null,
      }),
      { applied: false },
    );
  });

  it('reports applied: true when the row was still the claimed one', async () => {
    const matched = { matched: 1 };

    assert.deepEqual(
      await markNotificationAccepted(recordingClient([], matched).client, {
        id: '42',
        expectedAttempt: 3,
        providerReference: 'msg_123',
      }),
      { applied: true },
    );

    assert.deepEqual(
      await markNotificationAttemptFailed(recordingClient([], matched).client, {
        id: '42',
        expectedAttempt: 3,
        acceptance: 'rejected',
        error: 'refused',
        retryAfterSeconds: 60,
      }),
      { applied: true },
    );

    assert.deepEqual(
      await markNotificationAbandoned(recordingClient([], matched).client, {
        id: '42',
        expectedAttempt: 3,
        acceptance: 'unknown',
        error: null,
      }),
      { applied: true },
    );
  });

  it('never throws merely because a row was stale', async () => {
    // A stale completion is an ordinary race, not a fault. Throwing would make
    // dispatchers wrap every completion in a try/catch that swallowed real
    // faults alongside it.
    await assert.doesNotReject(() =>
      markNotificationAccepted(recordingClient([], { matched: 0 }).client, {
        id: '42',
        expectedAttempt: 1,
        providerReference: null,
      }),
    );
  });

  it('guards all three against a row that has already settled', async () => {
    // Both terminal columns, on all three writes. In particular an abandoned
    // row can never be turned into an accepted one by a late completion.
    const accepted = recordingClient();
    await markNotificationAccepted(accepted.client, {
      id: '42',
      expectedAttempt: 3,
      providerReference: null,
    });

    const failed = recordingClient();
    await markNotificationAttemptFailed(failed.client, {
      id: '42',
      expectedAttempt: 3,
      acceptance: 'unknown',
      error: null,
      retryAfterSeconds: 60,
    });

    const abandoned = recordingClient();
    await markNotificationAbandoned(abandoned.client, {
      id: '42',
      expectedAttempt: 3,
      acceptance: 'rejected',
      error: null,
    });

    for (const { statements } of [accepted, failed, abandoned]) {
      const { text } = only(statements);

      assert.match(text, /AND accepted_at IS NULL/);
      assert.match(text, /AND failed_at IS NULL/);
    }
  });

  it('leaves the frozen envelope alone on all three', async () => {
    const accepted = recordingClient();
    await markNotificationAccepted(accepted.client, {
      id: '42',
      expectedAttempt: 3,
      providerReference: null,
    });

    const failed = recordingClient();
    await markNotificationAttemptFailed(failed.client, {
      id: '42',
      expectedAttempt: 3,
      acceptance: 'unknown',
      error: null,
      retryAfterSeconds: 60,
    });

    const abandoned = recordingClient();
    await markNotificationAbandoned(abandoned.client, {
      id: '42',
      expectedAttempt: 3,
      acceptance: 'rejected',
      error: null,
    });

    for (const { statements } of [accepted, failed, abandoned]) {
      const written = setClause(only(statements).text);

      assert.ok(!written.includes('resolved_from'), 'the envelope is frozen at the first claim');
      assert.ok(!written.includes('resolved_to'));
    }
  });
});

describe('claim ordering', () => {
  it('orders by the due time the claim selected on, then by id', async () => {
    // Sorting by id alone would be a different order: an old row retried into
    // the future would jump ahead of a newer row that is due now.
    const early = new Date('2026-09-20T09:00:00.000Z');
    const late = new Date('2026-09-20T11:00:00.000Z');

    const { client } = recordingClient([
      claimedRow({ id: '2', claim_due_at: late }),
      claimedRow({ id: '30', claim_due_at: early }),
      claimedRow({ id: '7', claim_due_at: early }),
    ]);

    const claimed = await claimNotificationEvents(client, CLAIM_INPUT);

    assert.deepEqual(
      claimed.map((event) => event.id),
      ['7', '30', '2'],
      'due first, then oldest id — not id alone',
    );
  });

  it('reads the due time from before the lease moved it', async () => {
    // The claim pushes `next_attempt_at` forward, so every row in a batch
    // would share the post-update value and it would say nothing about order.
    const { client, statements } = recordingClient([claimedRow()]);

    await claimNotificationEvents(client, CLAIM_INPUT);

    const { select } = claim(statements);
    assert.match(select.text, /SELECT id, next_attempt_at/, 'the pre-claim due time is read before the lease');
  });

  it('does not expose the ordering column on the sending contract', async () => {
    const { client } = recordingClient([claimedRow()]);

    const [claimed] = await claimNotificationEvents(client, CLAIM_INPUT);

    assert.ok(claimed);
    assert.ok(!('claim_due_at' in claimed), 'an ordering artifact is not part of the contract');
    assert.ok(!('claimDueAt' in claimed));
  });

  it('returns the NEW attempt number, which the completions are guarded on', async () => {
    const { client } = recordingClient([claimedRow({ attempts: 4 })]);

    const [claimed] = await claimNotificationEvents(client, CLAIM_INPUT);

    assert.equal(claimed?.attempts, 4, 'the count including this claim');
  });
});

describe('the module as a whole', () => {
  it('takes every time from the database and none from JavaScript', async () => {
    // A drifting application clock could make a row due early, late or never.
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.repository.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

    for (const forbidden of ['new Date', 'Date.now', 'process.env', 'Math.random', 'dbPool', 'require(']) {
      assert.ok(!code.includes(forbidden), `the repository must not use ${forbidden}`);
    }
  });

  it('encodes no retry schedule, attempt ceiling or batch size', async () => {
    // Policy belongs with the dispatcher. Persistence that quietly decided when
    // to give up would be a second place that rule lived.
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.repository.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

    assert.doesNotMatch(code, /MAX_ATTEMPTS|BACKOFF|RETRY_SCHEDULE|BATCH_SIZE/);
    // Every interval and limit arrives as a bound parameter.
    assert.doesNotMatch(code, /interval '\d/, 'no hard-coded interval literal');
  });

  it('carries no ON CONFLICT on any statement', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.repository.ts', 'utf8');

    assert.doesNotMatch(code, /ON\s+CONFLICT\s+\(/i);
  });
});
