import type { PoolClient } from 'pg';
import { dbPool } from '../../db/pool';
import {
  claimNotificationEvents,
  markNotificationAbandoned,
  markNotificationAccepted,
  markNotificationAttemptFailed,
  type ClaimedNotificationEvent,
  type NotificationAcceptance,
} from './notifications.repository';
import {
  renderNotificationEmail,
  type NotificationTemplatePayload,
} from './notifications.templates';
import { sendNotificationEmail, type ProviderResult } from './notifications.resend';
import type { NotificationTemplateKey } from './notifications.types';

// One pass over the outbox: claim a bounded batch, send it, record what
// happened. No loop, no timer, no server lifecycle — something else decides
// when to call this.
//
// ---------------------------------------------------------------------------
// THE SHAPE THAT MATTERS
//
// A database connection is never held across a provider call. The claim takes a
// client, commits, and releases it BEFORE anything is rendered or sent; each
// completion takes a fresh client for one statement and gives it straight back.
//
// That is not tidiness. A row lock held open across a network send would tie a
// connection to the provider's latency, and a slow provider would stall the
// pool the website serves requests from. What protects a claimed row while its
// send is in flight is not the lock but the lease the claim wrote into
// `next_attempt_at`.
//
// ---------------------------------------------------------------------------
// THE LEASE HAS TO COVER THE WHOLE BATCH, NOT ONE ROW
//
// The claim is a single statement, so EVERY row in a batch has its lease
// stamped at the same instant. Processing is then sequential, so the last row
// does not even begin its provider call until every row before it has
// finished or timed out.
//
// With `batchSize` 10 and a 5s timeout, the tenth row can start its send ~45s
// after the claim. A 5s lease — which satisfies "the lease covers one request"
// — expired forty seconds earlier, and another worker can have re-claimed and
// re-sent that row while the first worker's request is still in flight. The
// provider's idempotency key would probably save it, but the design must not
// depend on that: the key is the last line of defence, not the first.
//
// So the lease is validated against the WORST-CASE WINDOW FOR THE WHOLE BATCH:
//
//     claimLeaseSeconds * 1000 >= batchSize * requestTimeoutMs
//
// It is rejected, never quietly raised. A lease that this file silently
// enlarged would hide a misconfiguration that a person needs to see, and it
// would change how long a genuinely stuck row blocks retrying.
//
// ---------------------------------------------------------------------------
// ONE PROVIDER REQUEST PER ROW PER PASS
//
// Whatever happens, a claimed row gets at most one HTTP request from this pass.
// There is no inner retry: a retry is a later pass, with the row re-claimed and
// its attempt counted. That is what keeps `attempts` honest, and it is why a
// failure to record an outcome must NOT be followed by another send.
//
// ---------------------------------------------------------------------------
// WHAT IS NEVER LOGGED
//
// This module does not log. Not the key, not an address, not a subject, not a
// rendered body, not a payload. The summary it returns is counts only. The one
// piece of text that can leave here is `configError`, which is this file's own
// wording and never contains a setting's value.

/**
 * Everything a pass needs, supplied by the caller.
 *
 * No `process.env` anywhere in this module. Reading configuration is the
 * lifecycle code's job, and keeping it out of here is what makes a pass a pure
 * function of its settings and its collaborators.
 */
export type DispatcherSettings = {
  readonly apiKey: string;
  /** The sender frozen onto rows that have never been claimed before. */
  readonly fromAddress: string;
  /** Where a hotel event goes. Guest rows carry their own address. */
  readonly hotelRecipient: string;
  readonly requestTimeoutMs: number;
  readonly batchSize: number;
  /** How many attempts a row gets before it is abandoned. */
  readonly maxAttempts: number;
  /**
   * How long a claim protects a row.
   *
   * Must cover `batchSize * requestTimeoutMs`, not a single request: the whole
   * batch is leased at one instant and sent sequentially, so the last row's
   * send can begin almost the entire batch window after the claim.
   */
  readonly claimLeaseSeconds: number;
  /**
   * The caller's backoff policy: how long to wait before the given attempt
   * number may be tried again. No schedule lives in this file.
   */
  readonly retryDelaySecondsFor: (attempts: number) => number;
};

/** Counts only. Nothing here identifies a booking, a guest or an address. */
export type DispatchSummary = {
  readonly claimed: number;
  readonly accepted: number;
  readonly retryScheduled: number;
  readonly abandoned: number;
  /** Rows whose completion found the row had moved on. Neither sent nor retried. */
  readonly stale: number;
  /** Rows whose outcome could not be recorded. Left to their lease. */
  readonly stateErrors: number;
  /** Set only when settings were refused, in which case nothing was claimed. */
  readonly configError?: string;
};

/**
 * The collaborators, injectable so a test needs no database and no network.
 *
 * Production supplies none of them and gets the real ones.
 */
export type DispatchDependencies = {
  readonly acquireClient?: () => Promise<PoolClient>;
  readonly claim?: typeof claimNotificationEvents;
  readonly render?: typeof renderNotificationEmail;
  readonly send?: typeof sendNotificationEmail;
  readonly markAccepted?: typeof markNotificationAccepted;
  readonly markAttemptFailed?: typeof markNotificationAttemptFailed;
  readonly markAbandoned?: typeof markNotificationAbandoned;
};

const empty = (): DispatchSummary => ({
  claimed: 0,
  accepted: 0,
  retryScheduled: 0,
  abandoned: 0,
  stale: 0,
  stateErrors: 0,
});

const isNonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isPositiveSeconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Checks the settings before a single row is claimed.
 *
 * Deliberately first. A pass that claimed rows and then discovered it had no
 * API key would have spent an attempt on every one of them and pushed their
 * `next_attempt_at` forward for nothing.
 *
 * Returns this file's own wording, never the offending value — a message that
 * quoted the key would be the worst possible thing to hand back to a caller
 * that might log it.
 */
function describeSettingsProblem(settings: DispatcherSettings): string | null {
  if (!isNonEmpty(settings.apiKey)) {
    return 'The provider API key is missing';
  }
  if (!isNonEmpty(settings.fromAddress)) {
    return 'The sender address is missing';
  }
  if (!isNonEmpty(settings.hotelRecipient)) {
    return 'The hotel recipient address is missing';
  }
  if (!isPositiveInteger(settings.requestTimeoutMs)) {
    return 'The request timeout must be a positive whole number of milliseconds';
  }
  if (!isPositiveInteger(settings.batchSize)) {
    return 'The batch size must be a positive whole number';
  }
  if (!isPositiveInteger(settings.maxAttempts)) {
    return 'The maximum attempt count must be a positive whole number';
  }
  if (!isPositiveSeconds(settings.claimLeaseSeconds)) {
    return 'The claim lease must be a positive number of seconds';
  }

  // Every row in a batch is leased at the same instant, and sequential
  // processing means each row consumes the previous rows' timeout budget
  // before its own send begins. The lease therefore has to cover the whole
  // batch's worst case, not one request's.
  const leaseMs = settings.claimLeaseSeconds * 1000;
  const batchSendWindowMs = settings.batchSize * settings.requestTimeoutMs;

  // Both operands are already safe integers, so a product that is not one has
  // overflowed past exact representation and cannot be compared meaningfully.
  // Checked before the comparison, so an overflow can never read as "large
  // enough".
  if (!Number.isFinite(leaseMs) || !Number.isSafeInteger(batchSendWindowMs)) {
    return 'The claim lease and the batch send window must be exactly representable in milliseconds';
  }

  if (leaseMs < batchSendWindowMs) {
    return 'The claim lease must cover the whole batch: the batch size times the request timeout';
  }

  if (typeof settings.retryDelaySecondsFor !== 'function') {
    return 'The retry delay policy must be a function';
  }

  // Probed up front across every attempt this pass could reach, so a policy
  // that returns nonsense is found before rows are claimed rather than after
  // one has already been sent.
  for (let attempt = 1; attempt <= settings.maxAttempts; attempt += 1) {
    if (!isPositiveSeconds(settings.retryDelaySecondsFor(attempt))) {
      return 'The retry delay policy must return a positive number of seconds';
    }
  }

  return null;
}

/** What one row's processing concluded, before it is counted. */
type RowOutcome = 'accepted' | 'retryScheduled' | 'abandoned' | 'stale' | 'stateError';

/**
 * Renders a claimed row, or says it cannot be rendered.
 *
 * A stored row can name a template this build no longer has, or carry a payload
 * that does not match the contract its template key promises. Either is a data
 * fault and terminal: no amount of retrying will make an unrenderable row
 * renderable, and no provider request has happened, so nothing was sent.
 *
 * The reason returned is generic on purpose. A renderer error could quote a
 * payload field, and a payload holds a guest's name.
 */
function renderRow(
  row: ClaimedNotificationEvent,
  render: NonNullable<DispatchDependencies['render']>,
): { readonly subject: string; readonly html: string; readonly text: string } | null {
  if (typeof row.payload !== 'object' || row.payload === null) {
    return null;
  }

  try {
    const email = render(
      // The stored key is only a string until the renderer recognises it; an
      // unknown one raises, which is caught below.
      row.templateKey as NotificationTemplateKey,
      row.payload as NotificationTemplatePayload[NotificationTemplateKey],
    );

    // A payload missing fields renders blanks rather than raising, so the
    // output is checked too.
    if (!isNonEmpty(email.subject) || !isNonEmpty(email.html) || !isNonEmpty(email.text)) {
      return null;
    }

    return email;
  } catch {
    return null;
  }
}

/**
 * Records one row's provider result.
 *
 * Every write is guarded on the attempt the claim returned, so a completion
 * that arrives after the row was re-claimed matches nothing and says so. That
 * answer is `stale`: the row belongs to a newer attempt, and this pass must
 * neither transition it again nor send to it again.
 *
 * Acceptance is passed through exactly as the provider adapter reported it.
 * This function never upgrades `unknown` to `rejected` or the reverse — the
 * adapter is the only thing that knows, and a dispatcher that second-guessed
 * it would be inventing certainty about whether a guest got an email.
 */
async function recordOutcome(
  row: ClaimedNotificationEvent,
  result: ProviderResult,
  settings: DispatcherSettings,
  deps: Required<
    Pick<DispatchDependencies, 'acquireClient' | 'markAccepted' | 'markAttemptFailed' | 'markAbandoned'>
  >,
): Promise<RowOutcome> {
  // One short-lived client for one statement. Acquired here, after the provider
  // call has already finished, so no connection was held during it.
  const client = await deps.acquireClient();

  try {
    if (result.outcome === 'accepted') {
      const { applied } = await deps.markAccepted(client, {
        id: row.id,
        expectedAttempt: row.attempts,
        providerReference: result.providerReference,
      });

      return applied ? 'accepted' : 'stale';
    }

    // A permanent refusal cannot succeed later, so the row is given up on now
    // rather than after exhausting attempts that would all fail identically.
    // A transient or blocked failure is worth another attempt, unless this was
    // the last one the caller allows.
    const giveUp = result.outcome === 'permanent' || row.attempts >= settings.maxAttempts;

    if (giveUp) {
      const { applied } = await deps.markAbandoned(client, {
        id: row.id,
        expectedAttempt: row.attempts,
        acceptance: result.acceptance,
        error: result.reason,
      });

      return applied ? 'abandoned' : 'stale';
    }

    const retryAfterSeconds = settings.retryDelaySecondsFor(row.attempts);

    if (!isPositiveSeconds(retryAfterSeconds)) {
      // The policy was probed before claiming, so reaching this means it is
      // not deterministic. The provider request has already happened, so the
      // only safe move is to write nothing and let the lease expire.
      return 'stateError';
    }

    const { applied } = await deps.markAttemptFailed(client, {
      id: row.id,
      expectedAttempt: row.attempts,
      acceptance: result.acceptance,
      error: result.reason,
      retryAfterSeconds,
    });

    return applied ? 'retryScheduled' : 'stale';
  } finally {
    client.release();
  }
}

/**
 * Records a row that could not be rendered.
 *
 * Terminal, and definitively un-accepted: no request was made, so no message
 * can exist. This is the one place the dispatcher decides an acceptance itself,
 * and it can only do so because it knows nothing was sent.
 */
async function recordUnrenderable(
  row: ClaimedNotificationEvent,
  deps: Required<Pick<DispatchDependencies, 'acquireClient' | 'markAbandoned'>>,
): Promise<RowOutcome> {
  const client = await deps.acquireClient();

  try {
    const { applied } = await deps.markAbandoned(client, {
      id: row.id,
      expectedAttempt: row.attempts,
      acceptance: 'rejected',
      // Generic on purpose: a renderer's own message could quote a payload
      // field, and a payload holds a guest's name.
      error: 'The stored notification could not be rendered',
    });

    return applied ? 'abandoned' : 'stale';
  } finally {
    client.release();
  }
}

/**
 * Runs one dispatch pass.
 *
 * Claims at most `batchSize` due rows, then sends them one at a time in the
 * order the claim returned — due first, then oldest. Sequential on purpose for
 * this version: concurrent sends would need their own rate-limit handling, and
 * a queue that overtakes itself is harder to reason about than a slow one.
 *
 * Never throws for an individual row. A row that cannot be rendered, cannot be
 * sent, or whose outcome cannot be written is counted and the pass moves on, so
 * one poisonous row cannot stop the batch behind it. A failure to CLAIM does
 * throw, because that is not a row-level problem.
 */
export async function dispatchNotificationBatch(
  settings: DispatcherSettings,
  dependencies: DispatchDependencies = {},
): Promise<DispatchSummary> {
  const deps = {
    acquireClient: dependencies.acquireClient ?? (() => dbPool.connect()),
    claim: dependencies.claim ?? claimNotificationEvents,
    render: dependencies.render ?? renderNotificationEmail,
    send: dependencies.send ?? sendNotificationEmail,
    markAccepted: dependencies.markAccepted ?? markNotificationAccepted,
    markAttemptFailed: dependencies.markAttemptFailed ?? markNotificationAttemptFailed,
    markAbandoned: dependencies.markAbandoned ?? markNotificationAbandoned,
  };

  const problem = describeSettingsProblem(settings);

  if (problem) {
    // Nothing is claimed. No attempt is spent, no lease is moved.
    return { ...empty(), configError: problem };
  }

  // --- The only transaction in this pass, and it ends here. ---
  const claimed = await (async (): Promise<ClaimedNotificationEvent[]> => {
    const client = await deps.acquireClient();

    try {
      await client.query('BEGIN');
      const rows = await deps.claim(client, {
        limit: settings.batchSize,
        resolvedFrom: settings.fromAddress,
        hotelRecipient: settings.hotelRecipient,
        leaseSeconds: settings.claimLeaseSeconds,
      });
      await client.query('COMMIT');

      return rows;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The claim already failed; a rollback that also fails changes nothing
        // and must not mask the original error.
      }

      throw error;
    } finally {
      // Released before a single byte is rendered or sent.
      client.release();
    }
  })();

  const counts = {
    accepted: 0,
    retryScheduled: 0,
    abandoned: 0,
    stale: 0,
    stateErrors: 0,
  };

  const tally = (outcome: RowOutcome): void => {
    if (outcome === 'stateError') {
      counts.stateErrors += 1;
      return;
    }
    if (outcome === 'stale') {
      counts.stale += 1;
      return;
    }
    counts[outcome] += 1;
  };

  for (const row of claimed) {
    const email = renderRow(row, deps.render);

    if (!email) {
      // No provider request happens for this row at all.
      try {
        tally(await recordUnrenderable(row, deps));
      } catch {
        tally('stateError');
      }
      continue;
    }

    let result: ProviderResult;

    try {
      // Exactly one request. The envelope is the row's frozen pair, used as
      // given — this file never resolves an address of its own.
      result = await deps.send({
        apiKey: settings.apiKey,
        eventType: row.eventType,
        bookingReference: row.bookingReference,
        resolvedFrom: row.resolvedFrom,
        resolvedTo: row.resolvedTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
        timeoutMs: settings.requestTimeoutMs,
      });
    } catch {
      // The adapter is contracted to return rather than throw, so this is a
      // fault in it. The request may have been issued, so acceptance cannot be
      // claimed either way: the row is left to its lease rather than being
      // marked with an acceptance nobody knows.
      tally('stateError');
      continue;
    }

    try {
      tally(await recordOutcome(row, result, settings, deps));
    } catch {
      // The send happened; only the bookkeeping failed. Nothing is retried
      // here — not the write, and above all not the send. The lease expires,
      // the row is re-claimed later, and the provider's idempotency key is what
      // stops the next attempt becoming a second email.
      tally('stateError');
    }
  }

  return { claimed: claimed.length, ...counts };
}

/** Re-exported so callers can name an acceptance without reaching past this module. */
export type { NotificationAcceptance };
