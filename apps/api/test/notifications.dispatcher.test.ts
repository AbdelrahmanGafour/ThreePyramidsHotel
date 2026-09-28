import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import type {
  DispatcherSettings,
  DispatchDependencies,
} from '../src/modules/notifications/notifications.dispatcher';
import type { ClaimedNotificationEvent } from '../src/modules/notifications/notifications.repository';
import type { ProviderResult } from '../src/modules/notifications/notifications.resend';

type DispatcherModule = typeof import('../src/modules/notifications/notifications.dispatcher.js');

let dispatchNotificationBatch: DispatcherModule['dispatchNotificationBatch'];

before(async () => {
  // The dispatcher's default client factory reaches `db/pool`, which reads the
  // environment at module load. Nothing here connects — every collaborator is
  // injected — so a placeholder is enough to import the module.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ dispatchNotificationBatch } = await import(
    '../src/modules/notifications/notifications.dispatcher.js'
  ));
});

// One dispatch pass, with every collaborator injected.
//
// No database and no network. What is under test is the ORDER of operations and
// the decisions between them, because that is where this layer can do real
// damage: a connection held across a send, a second provider request for one
// claimed row, or an acceptance the dispatcher invented rather than reported.
//
// The strongest assertion in the file is the one on `events` — a single ordered
// log of every acquire, release, claim, render, send and write. Checking the
// sequence is the only way to prove "the claim client was released before the
// first fetch", which no per-call assertion can show.

const SETTINGS: DispatcherSettings = {
  apiKey: 're_test_key',
  fromAddress: 'Three Pyramids <stay@example.test>',
  hotelRecipient: 'desk@example.test',
  requestTimeoutMs: 8000,
  batchSize: 10,
  maxAttempts: 5,
  // 10 rows x 8s = an 80s worst-case batch window, so the lease must exceed it.
  claimLeaseSeconds: 120,
  retryDelaySecondsFor: (attempts) => attempts * 30,
};

const claimedRow = (overrides: Partial<ClaimedNotificationEvent> = {}): ClaimedNotificationEvent => ({
  id: '1',
  eventType: 'room_reservation_confirmed',
  bookingReference: 'TPH-A2B3C4D5E6F7',
  recipientKind: 'guest',
  recipientEmail: 'guest@example.test',
  templateKey: 'room_confirmed_guest.v1',
  payload: { bookingReference: 'TPH-A2B3C4D5E6F7' },
  attempts: 1,
  resolvedFrom: 'frozen-sender@example.test',
  resolvedTo: 'frozen-guest@example.test',
  ...overrides,
});

const RENDERED = {
  subject: 'Your reservation is confirmed',
  html: '<!DOCTYPE html><html><body><p>Confirmed</p></body></html>',
  text: 'Your reservation is confirmed\n',
};

type SendCall = { input: Record<string, unknown> };
type WriteCall = { kind: string; input: Record<string, unknown> };

type Harness = {
  readonly deps: DispatchDependencies;
  /** Every operation, in the order it happened. */
  readonly events: string[];
  readonly sends: SendCall[];
  readonly writes: WriteCall[];
  readonly claimStatements: string[];
};

type HarnessOptions = {
  readonly rows?: ClaimedNotificationEvent[];
  readonly results?: ProviderResult[];
  readonly applied?: boolean;
  readonly renderThrows?: boolean;
  readonly renderReturns?: { subject: string; html: string; text: string };
  readonly writeThrows?: boolean;
  readonly sendThrows?: boolean;
  readonly claimThrows?: boolean;
};

function harness(options: HarnessOptions = {}): Harness {
  const events: string[] = [];
  const sends: SendCall[] = [];
  const writes: WriteCall[] = [];
  const claimStatements: string[] = [];
  const rows = options.rows ?? [claimedRow()];
  const results = options.results ?? [{ outcome: 'accepted', providerReference: 'msg_1' }];
  let clientSequence = 0;
  let sendIndex = 0;

  const acquireClient = async (): Promise<PoolClient> => {
    const name = `client${(clientSequence += 1)}`;
    events.push(`acquire:${name}`);

    return {
      async query(text: string): Promise<unknown> {
        claimStatements.push(text);
        events.push(`query:${name}:${text.trim().split(/\s+/)[0]}`);
        return { rows: [], rowCount: 0 };
      },
      release(): void {
        events.push(`release:${name}`);
      },
    } as unknown as PoolClient;
  };

  const write = async (kind: string, input: Record<string, unknown>) => {
    events.push(`write:${kind}`);
    writes.push({ kind, input });

    if (options.writeThrows) {
      throw new Error('simulated completion failure');
    }

    return { applied: options.applied ?? true };
  };

  return {
    events,
    sends,
    writes,
    claimStatements,
    deps: {
      acquireClient,
      claim: async () => {
        events.push('claim');

        if (options.claimThrows) {
          throw new Error('simulated claim failure');
        }

        return rows;
      },
      render: (() => {
        events.push('render');

        if (options.renderThrows) {
          throw new Error('simulated render failure');
        }

        return options.renderReturns ?? RENDERED;
      }) as unknown as NonNullable<DispatchDependencies['render']>,
      send: (async (input: Record<string, unknown>) => {
        events.push('send');
        sends.push({ input });

        if (options.sendThrows) {
          throw new Error('simulated adapter fault');
        }

        const result = results[Math.min(sendIndex, results.length - 1)];
        sendIndex += 1;

        return result;
      }) as unknown as NonNullable<DispatchDependencies['send']>,
      markAccepted: ((_client: PoolClient, input: Record<string, unknown>) =>
        write('accepted', input)) as unknown as NonNullable<DispatchDependencies['markAccepted']>,
      markAttemptFailed: ((_client: PoolClient, input: Record<string, unknown>) =>
        write('attemptFailed', input)) as unknown as NonNullable<
        DispatchDependencies['markAttemptFailed']
      >,
      markAbandoned: ((_client: PoolClient, input: Record<string, unknown>) =>
        write('abandoned', input)) as unknown as NonNullable<DispatchDependencies['markAbandoned']>,
    },
  };
}

describe('settings are checked before anything is claimed', () => {
  const invalid: ReadonlyArray<{ readonly label: string; readonly patch: Partial<DispatcherSettings> }> = [
    { label: 'a missing api key', patch: { apiKey: '' } },
    { label: 'a blank api key', patch: { apiKey: '   ' } },
    { label: 'a missing sender', patch: { fromAddress: '' } },
    { label: 'a missing hotel recipient', patch: { hotelRecipient: '' } },
    { label: 'a zero timeout', patch: { requestTimeoutMs: 0 } },
    { label: 'a negative timeout', patch: { requestTimeoutMs: -1 } },
    { label: 'a zero batch size', patch: { batchSize: 0 } },
    { label: 'a fractional batch size', patch: { batchSize: 2.5 } },
    { label: 'a zero attempt ceiling', patch: { maxAttempts: 0 } },
    { label: 'a zero lease', patch: { claimLeaseSeconds: 0 } },
    // The lease is what protects a row while its send is in flight.
    { label: 'a lease shorter than the timeout', patch: { claimLeaseSeconds: 5, requestTimeoutMs: 8000 } },
    // Every row is leased at one instant and sent in turn, so the last row's
    // send can start almost a whole batch window after the claim.
    {
      label: 'a lease that covers one request but not the batch',
      patch: { batchSize: 10, requestTimeoutMs: 5000, claimLeaseSeconds: 5 },
    },
    {
      label: 'a lease one second short of the batch window',
      patch: { batchSize: 3, requestTimeoutMs: 5000, claimLeaseSeconds: 14 },
    },
    // Overflow past exact representation must never read as "large enough".
    {
      label: 'a batch window too large to represent exactly',
      patch: { batchSize: Number.MAX_SAFE_INTEGER, requestTimeoutMs: 1000, claimLeaseSeconds: 1e12 },
    },
    {
      label: 'a lease so large it is no longer finite in milliseconds',
      patch: { claimLeaseSeconds: Number.MAX_VALUE },
    },
    { label: 'a retry policy returning zero', patch: { retryDelaySecondsFor: () => 0 } },
    { label: 'a retry policy returning NaN', patch: { retryDelaySecondsFor: () => Number.NaN } },
  ];

  for (const { label, patch } of invalid) {
    it(`claims nothing given ${label}`, async () => {
      const bench = harness();

      const summary = await dispatchNotificationBatch({ ...SETTINGS, ...patch }, bench.deps);

      assert.equal(bench.events.length, 0, 'no client was acquired and nothing was claimed');
      assert.equal(summary.claimed, 0);
      assert.ok(summary.configError, 'the reason is reported');
    });
  }

  it('never quotes a setting value in the reason it reports', async () => {
    const bench = harness();

    const summary = await dispatchNotificationBatch(
      { ...SETTINGS, apiKey: '', fromAddress: 'secret-sender@example.test' },
      bench.deps,
    );

    assert.ok(!String(summary.configError).includes('secret-sender@example.test'));
    assert.ok(!String(summary.configError).includes(SETTINGS.apiKey));
  });

  it('still accepts a lease exactly equal to the timeout when the batch is one row', async () => {
    // With `batchSize` 1 the batch window IS one request, so the original
    // boundary is unchanged.
    const bench = harness();

    const summary = await dispatchNotificationBatch(
      { ...SETTINGS, batchSize: 1, requestTimeoutMs: 8000, claimLeaseSeconds: 8 },
      bench.deps,
    );

    assert.equal(summary.configError, undefined);
    assert.equal(summary.claimed, 1);
  });

  it('refuses a lease under the timeout even for a single-row batch', async () => {
    const bench = harness();

    const summary = await dispatchNotificationBatch(
      { ...SETTINGS, batchSize: 1, requestTimeoutMs: 8000, claimLeaseSeconds: 7.999 },
      bench.deps,
    );

    assert.equal(bench.events.length, 0);
    assert.ok(summary.configError);
  });
});

describe('the lease must cover the whole batch window', () => {
  // Every row in a batch is leased at the same instant and the batch is sent
  // in order, so the Nth row's send begins after N-1 timeouts have elapsed.
  // A lease sized for one request expires long before the tail of the batch,
  // and another worker can re-claim and re-send a row whose first request is
  // still in flight.
  const window = { batchSize: 3, requestTimeoutMs: 5000 };

  it('refuses a lease sized for a single request', async () => {
    const bench = harness();

    const summary = await dispatchNotificationBatch(
      { ...SETTINGS, ...window, claimLeaseSeconds: 5 },
      bench.deps,
    );

    assert.equal(bench.events.length, 0, 'nothing was claimed');
    assert.match(String(summary.configError), /batch/, 'and the reason names the batch window');
  });

  it('refuses a lease one second short of the window', async () => {
    const bench = harness();

    const summary = await dispatchNotificationBatch(
      { ...SETTINGS, ...window, claimLeaseSeconds: 14 },
      bench.deps,
    );

    assert.equal(bench.events.length, 0);
    assert.ok(summary.configError);
  });

  it('accepts a lease exactly equal to the window', async () => {
    // 3 rows x 5s = 15s.
    const bench = harness();

    const summary = await dispatchNotificationBatch(
      { ...SETTINGS, ...window, claimLeaseSeconds: 15 },
      bench.deps,
    );

    assert.equal(summary.configError, undefined);
    assert.equal(summary.claimed, 1);
    assert.ok(bench.events.includes('claim'));
  });

  it('scales the requirement with the batch size', async () => {
    // The same lease that is ample for two rows is short for four.
    const ample = harness();
    assert.equal(
      (await dispatchNotificationBatch(
        { ...SETTINGS, batchSize: 2, requestTimeoutMs: 5000, claimLeaseSeconds: 10 },
        ample.deps,
      )).configError,
      undefined,
    );

    const short = harness();
    assert.ok(
      (await dispatchNotificationBatch(
        { ...SETTINGS, batchSize: 4, requestTimeoutMs: 5000, claimLeaseSeconds: 10 },
        short.deps,
      )).configError,
    );
    assert.equal(short.events.length, 0);
  });

  it('never silently raises a lease it found too short', async () => {
    const bench = harness();

    await dispatchNotificationBatch({ ...SETTINGS, ...window, claimLeaseSeconds: 5 }, bench.deps);

    // A pass that enlarged the lease itself would hide the misconfiguration
    // and change how long a stuck row blocks retrying.
    assert.equal(bench.events.length, 0, 'it refused rather than adjusted');
  });
});

describe('the claim finishes before any provider work begins', () => {
  it('releases the claim client before the first send', async () => {
    const bench = harness();

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    const firstRelease = bench.events.indexOf('release:client1');
    const firstSend = bench.events.indexOf('send');
    const firstRender = bench.events.indexOf('render');

    assert.ok(firstRelease >= 0 && firstSend >= 0, 'both happened');
    assert.ok(firstRelease < firstRender, 'and before anything was even rendered');
    assert.ok(firstRelease < firstSend, 'the connection was not held across the send');
  });

  it('commits the claim transaction and opens no other', async () => {
    const bench = harness();

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.deepEqual(
      bench.claimStatements.map((text) => text.trim()),
      ['BEGIN', 'COMMIT'],
      'one transaction, for the claim alone',
    );
  });

  it('takes a separate short-lived client for the completion', async () => {
    const bench = harness();

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.deepEqual(bench.events, [
      'acquire:client1',
      'query:client1:BEGIN',
      'claim',
      'query:client1:COMMIT',
      'release:client1',
      'render',
      'send',
      'acquire:client2',
      'write:accepted',
      'release:client2',
    ]);
  });

  it('rolls back and releases when the claim itself fails', async () => {
    const bench = harness({ claimThrows: true });

    await assert.rejects(() => dispatchNotificationBatch(SETTINGS, bench.deps), /simulated claim failure/);

    assert.ok(bench.events.includes('query:client1:ROLLBACK'));
    assert.ok(bench.events.includes('release:client1'), 'the client is never leaked');
    assert.equal(bench.sends.length, 0);
  });
});

describe('what it sends', () => {
  it('uses the row frozen envelope, not the configured addresses', async () => {
    const bench = harness();

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    const sent = bench.sends[0]?.input;
    assert.equal(sent?.resolvedFrom, 'frozen-sender@example.test');
    assert.equal(sent?.resolvedTo, 'frozen-guest@example.test');
    assert.notEqual(sent?.resolvedFrom, SETTINGS.fromAddress, 'the settings only seed a first claim');
    assert.notEqual(sent?.resolvedTo, SETTINGS.hotelRecipient);
  });

  it('passes the renderer output through unchanged', async () => {
    const bench = harness();

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    const sent = bench.sends[0]?.input;
    assert.equal(sent?.subject, RENDERED.subject);
    assert.equal(sent?.html, RENDERED.html);
    assert.equal(sent?.text, RENDERED.text);
  });

  it('passes the event type, reference and timeout the key and abort need', async () => {
    const bench = harness();

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    const sent = bench.sends[0]?.input;
    assert.equal(sent?.eventType, 'room_reservation_confirmed');
    assert.equal(sent?.bookingReference, 'TPH-A2B3C4D5E6F7');
    assert.equal(sent?.timeoutMs, 8000);
    assert.equal(sent?.apiKey, SETTINGS.apiKey);
  });

  it('sends at most once per claimed row in a pass', async () => {
    const bench = harness({
      rows: [claimedRow({ id: '1' }), claimedRow({ id: '2' })],
      results: [
        { outcome: 'transient', acceptance: 'unknown', reason: 'timeout' },
        { outcome: 'transient', acceptance: 'unknown', reason: 'timeout' },
      ],
    });

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(bench.sends.length, 2, 'two rows, two requests, no inner retry');
    assert.equal(bench.events.filter((event) => event === 'send').length, 2);
  });

  it('processes rows in exactly the order the claim returned', async () => {
    const bench = harness({
      rows: [claimedRow({ id: '9' }), claimedRow({ id: '3' }), claimedRow({ id: '7' })],
    });

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.deepEqual(
      bench.writes.map((call) => call.input.id),
      ['9', '3', '7'],
      'claim order is preserved, not re-sorted',
    );
  });
});

describe('recording a provider result', () => {
  it('marks an acceptance with the attempt the claim returned', async () => {
    const bench = harness({
      rows: [claimedRow({ attempts: 4 })],
      results: [{ outcome: 'accepted', providerReference: 'msg_live' }],
    });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.deepEqual(bench.writes, [
      { kind: 'accepted', input: { id: '1', expectedAttempt: 4, providerReference: 'msg_live' } },
    ]);
    assert.equal(summary.accepted, 1);
  });

  it('schedules a retry for a transient failure below the ceiling', async () => {
    const bench = harness({
      rows: [claimedRow({ attempts: 2 })],
      results: [{ outcome: 'transient', acceptance: 'unknown', reason: 'timed out' }],
    });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(bench.writes[0]?.kind, 'attemptFailed');
    assert.deepEqual(bench.writes[0]?.input, {
      id: '1',
      expectedAttempt: 2,
      acceptance: 'unknown',
      error: 'timed out',
      // The caller's policy, asked for this attempt number.
      retryAfterSeconds: 60,
    });
    assert.equal(summary.retryScheduled, 1);
  });

  it('schedules a retry for a blocked failure below the ceiling', async () => {
    const bench = harness({
      rows: [claimedRow({ attempts: 1 })],
      results: [{ outcome: 'blocked', acceptance: 'rejected', reason: 'no api key' }],
    });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(bench.writes[0]?.kind, 'attemptFailed');
    assert.equal(bench.writes[0]?.input.acceptance, 'rejected');
    assert.equal(summary.retryScheduled, 1);
  });

  it('abandons a permanent failure immediately, whatever the attempt count', async () => {
    const bench = harness({
      rows: [claimedRow({ attempts: 1 })],
      results: [{ outcome: 'permanent', acceptance: 'rejected', reason: 'validation' }],
    });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(bench.writes[0]?.kind, 'abandoned', 'no point spending four more identical attempts');
    assert.equal(summary.abandoned, 1);
    assert.equal(summary.retryScheduled, 0);
  });

  it('abandons once the attempt ceiling is reached', async () => {
    const bench = harness({
      rows: [claimedRow({ attempts: 5 })],
      results: [{ outcome: 'transient', acceptance: 'unknown', reason: 'timed out' }],
    });

    const summary = await dispatchNotificationBatch({ ...SETTINGS, maxAttempts: 5 }, bench.deps);

    assert.equal(bench.writes[0]?.kind, 'abandoned');
    assert.equal(summary.abandoned, 1);
  });

  it('preserves acceptance exactly, both ways, and never invents it', async () => {
    for (const acceptance of ['unknown', 'rejected'] as const) {
      const retried = harness({
        rows: [claimedRow({ attempts: 1 })],
        results: [{ outcome: 'transient', acceptance, reason: 'whatever' }],
      });
      await dispatchNotificationBatch(SETTINGS, retried.deps);
      assert.equal(retried.writes[0]?.input.acceptance, acceptance, `retry kept ${acceptance}`);

      const abandoned = harness({
        rows: [claimedRow({ attempts: 9 })],
        results: [{ outcome: 'transient', acceptance, reason: 'whatever' }],
      });
      await dispatchNotificationBatch(SETTINGS, abandoned.deps);
      assert.equal(abandoned.writes[0]?.input.acceptance, acceptance, `abandon kept ${acceptance}`);
    }
  });
});

describe('a row that cannot be rendered', () => {
  it('is abandoned without any provider request', async () => {
    const bench = harness({ renderThrows: true });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(bench.sends.length, 0, 'nothing was sent');
    assert.equal(bench.writes[0]?.kind, 'abandoned');
    assert.equal(summary.abandoned, 1);
  });

  it('is recorded as definitively rejected, because nothing was sent', async () => {
    const bench = harness({ renderThrows: true });

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(bench.writes[0]?.input.acceptance, 'rejected');
  });

  it('stores a generic reason, never renderer or payload detail', async () => {
    const bench = harness({ renderThrows: true });

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    const error = String(bench.writes[0]?.input.error);
    assert.equal(error, 'The stored notification could not be rendered');
    assert.ok(!error.includes('simulated render failure'), 'the thrown message is not persisted');
  });

  it('treats a blank rendered field as unrenderable', async () => {
    // A payload missing fields renders blanks rather than raising.
    for (const renderReturns of [
      { subject: '', html: RENDERED.html, text: RENDERED.text },
      { subject: RENDERED.subject, html: '  ', text: RENDERED.text },
      { subject: RENDERED.subject, html: RENDERED.html, text: '' },
    ]) {
      const bench = harness({ renderReturns });

      await dispatchNotificationBatch(SETTINGS, bench.deps);

      assert.equal(bench.sends.length, 0);
      assert.equal(bench.writes[0]?.kind, 'abandoned');
    }
  });

  it('treats a non-object payload as unrenderable', async () => {
    for (const payload of [null, 'text', 42]) {
      const bench = harness({ rows: [claimedRow({ payload })] });

      await dispatchNotificationBatch(SETTINGS, bench.deps);

      assert.equal(bench.sends.length, 0, `${JSON.stringify(payload)} is not renderable`);
      assert.equal(bench.writes[0]?.kind, 'abandoned');
    }
  });

  it('does not stop the rows behind it', async () => {
    const bench = harness({
      rows: [claimedRow({ id: '1', payload: null }), claimedRow({ id: '2' })],
    });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(summary.abandoned, 1);
    assert.equal(summary.accepted, 1, 'the second row was still processed');
    assert.equal(bench.sends.length, 1);
  });
});

describe('a stale row', () => {
  it('is counted as stale and transitioned no further', async () => {
    const bench = harness({ applied: false });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(summary.stale, 1);
    assert.equal(summary.accepted, 0);
    assert.equal(bench.writes.length, 1, 'no second state transition was attempted');
  });

  it('is not sent to again', async () => {
    const bench = harness({ applied: false });

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(bench.sends.length, 1, 'the row belongs to a newer attempt now');
  });

  it('is recognised on a retry and an abandon too', async () => {
    const retried = harness({
      applied: false,
      rows: [claimedRow({ attempts: 1 })],
      results: [{ outcome: 'transient', acceptance: 'unknown', reason: 'x' }],
    });
    assert.equal((await dispatchNotificationBatch(SETTINGS, retried.deps)).stale, 1);

    const abandoned = harness({
      applied: false,
      results: [{ outcome: 'permanent', acceptance: 'rejected', reason: 'x' }],
    });
    assert.equal((await dispatchNotificationBatch(SETTINGS, abandoned.deps)).stale, 1);
  });

  it('does not stop the rest of the batch', async () => {
    const bench = harness({
      applied: false,
      rows: [claimedRow({ id: '1' }), claimedRow({ id: '2' })],
    });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(summary.stale, 2);
    assert.equal(bench.sends.length, 2);
  });
});

describe('a completion that cannot be written', () => {
  it('issues no second provider request and no second transition', async () => {
    const bench = harness({ writeThrows: true });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(bench.sends.length, 1, 'the message was sent once and stays sent once');
    assert.equal(bench.writes.length, 1, 'the write is not retried, nor converted to another state');
    assert.equal(summary.stateErrors, 1);
    assert.equal(summary.accepted, 0);
    assert.equal(summary.abandoned, 0);
  });

  it('releases the completion client even so', async () => {
    const bench = harness({ writeThrows: true });

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(
      bench.events.filter((event) => event.startsWith('acquire:')).length,
      bench.events.filter((event) => event.startsWith('release:')).length,
      'every client acquired was released',
    );
  });

  it('continues with the remaining rows', async () => {
    const bench = harness({
      writeThrows: true,
      rows: [claimedRow({ id: '1' }), claimedRow({ id: '2' })],
    });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(summary.stateErrors, 2);
    assert.equal(bench.sends.length, 2, 'one poisonous row does not stop the batch behind it');
  });

  it('treats an adapter that throws as a state error, claiming no acceptance', async () => {
    // The adapter is contracted to return rather than throw. If it throws, the
    // request may still have been issued, so nothing may be concluded.
    const bench = harness({ sendThrows: true });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.equal(summary.stateErrors, 1);
    assert.equal(bench.writes.length, 0, 'no acceptance was invented either way');
  });
});

describe('the batch summary', () => {
  it('counts every outcome in one mixed pass', async () => {
    const bench = harness({
      rows: [
        claimedRow({ id: '1', attempts: 1 }),
        claimedRow({ id: '2', attempts: 1 }),
        claimedRow({ id: '3', attempts: 1 }),
        claimedRow({ id: '4', attempts: 1, payload: null }),
      ],
      results: [
        { outcome: 'accepted', providerReference: 'msg_1' },
        { outcome: 'transient', acceptance: 'unknown', reason: 'timeout' },
        { outcome: 'permanent', acceptance: 'rejected', reason: 'validation' },
        { outcome: 'accepted', providerReference: 'unused' },
      ],
    });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.deepEqual(summary, {
      claimed: 4,
      accepted: 1,
      retryScheduled: 1,
      // The permanent failure plus the unrenderable row.
      abandoned: 2,
      stale: 0,
      stateErrors: 0,
    });
  });

  it('reports an empty pass without touching the provider', async () => {
    const bench = harness({ rows: [] });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);

    assert.deepEqual(summary, {
      claimed: 0,
      accepted: 0,
      retryScheduled: 0,
      abandoned: 0,
      stale: 0,
      stateErrors: 0,
    });
    assert.equal(bench.sends.length, 0);
  });

  it('carries no address, subject, body or reference', async () => {
    const bench = harness({
      results: [{ outcome: 'permanent', acceptance: 'rejected', reason: 'guest@example.test is invalid' }],
    });

    const summary = await dispatchNotificationBatch(SETTINGS, bench.deps);
    const serialised = JSON.stringify(summary);

    for (const withheld of [
      'frozen-guest@example.test',
      'frozen-sender@example.test',
      'guest@example.test',
      'TPH-A2B3C4D5E6F7',
      RENDERED.subject,
      'DOCTYPE',
      SETTINGS.apiKey,
    ]) {
      assert.equal(serialised.includes(withheld), false, `the summary must not carry ${withheld}`);
    }
  });
});

describe('what the dispatcher is not', () => {
  it('reads no environment and keeps no timer or loop', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.dispatcher.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

    for (const forbidden of [
      'process.env',
      'setInterval',
      'setTimeout',
      'while (',
      'createApp',
      'listen(',
      'server',
      'console.',
    ]) {
      assert.equal(code.includes(forbidden), false, `the dispatcher must not use ${forbidden}`);
    }
  });

  it('sends sequentially, never in parallel', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.dispatcher.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

    assert.equal(code.includes('Promise.all'), false, 'no parallel fan-out');
    assert.equal(code.includes('Promise.allSettled'), false);
  });

  it('interleaves nothing: each row is finished before the next is sent', async () => {
    const bench = harness({
      rows: [claimedRow({ id: '1' }), claimedRow({ id: '2' })],
    });

    await dispatchNotificationBatch(SETTINGS, bench.deps);

    const providerAndWrites = bench.events.filter(
      (event) => event === 'send' || event.startsWith('write:'),
    );

    assert.deepEqual(providerAndWrites, ['send', 'write:accepted', 'send', 'write:accepted']);
  });
});
