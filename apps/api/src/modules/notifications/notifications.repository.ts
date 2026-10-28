import type { PoolClient } from '../../db/pool';
import type { NotificationEvent } from './notifications.types';

/**
 * `notification_outbox`, and nothing else.
 *
 * Two jobs, and a hard line between them. `insertNotificationEvent` runs inside
 * a reservation's transaction and writes the six columns that freeze at insert.
 * Everything below it is the dispatcher's side: claiming rows, and recording
 * what an attempt learned.
 *
 * What is NOT here is as deliberate as what is. This module holds no retry
 * schedule, no attempt ceiling, no batch size and no idea what a provider is.
 * A caller says how long to lease a row for and when the next attempt is due;
 * this file writes what it is told. Policy belongs with the dispatcher that
 * will own it, and persistence that quietly decided when to give up would be
 * the second place that rule lived.
 *
 * Every function takes the caller's `PoolClient` and runs inside whatever
 * transaction the caller opened; nothing here begins, commits, rolls back or
 * acquires a connection.
 *
 * That transaction is meant to be SHORT. The claim is one statement and the
 * caller is expected to commit it before going anywhere near a provider — a
 * row lock held open across a network send would tie a database connection to
 * somebody else's latency and turn a slow provider into a stalled pool. What
 * protects a claimed row afterwards is not the lock but the lease the claim
 * wrote into `next_attempt_at`, which is why the caller chooses its length.
 *
 * Nothing in this module performs or awaits provider I/O.
 *
 * Times come from the database clock (`UTC_TIMESTAMP(3)`), never from JavaScript. The database's clock is the
 * one the rows are ordered by, and a second opinion from an application server
 * with a drifting clock could make a row due early, late, or never.
 *
 * ---------------------------------------------------------------------------
 * THE INSERT SEAM
 *
 * One function, one statement. This is the seam where a notification stops
 * being a value and becomes a row, and the only thing it is allowed to decide
 * is how the six frozen columns map onto parameters.
 *
 * ---------------------------------------------------------------------------
 * THE CALLER OWNS THE TRANSACTION
 *
 * The client is passed in and used exactly as given. Nothing here acquires a
 * connection, begins, commits, rolls back or releases — the caller is already
 * inside the transaction that is creating the reservation, and this insert has
 * to be part of that same atomic unit or the whole design collapses. A booking
 * that committed without its notification is the failure the outbox exists to
 * prevent, and it is prevented by sharing the transaction, not by trying
 * harder afterwards.
 *
 * That also rules out a retry in here. Retrying inside somebody else's
 * transaction would either repeat a statement whose first attempt already
 * aborted it, or paper over the one thing the caller most needs to hear about.
 *
 * ---------------------------------------------------------------------------
 * STRICT, AND DELIBERATELY FRAGILE
 *
 * A plain INSERT. No `ON CONFLICT`, no error translation, no domain outcome
 * union. Every PostgreSQL error propagates exactly as the driver raised it,
 * which aborts the caller's transaction and rolls the reservation back with it.
 *
 * That is the intended behaviour, not a gap. `UNIQUE (event_type,
 * booking_reference)` says one notification per event per booking, forever, and
 * a violation means something upstream has produced a second event for a
 * booking reference that is unique for the lifetime of the reservations table.
 * There is no benign reading of that. `ON CONFLICT DO NOTHING` would turn it
 * into silence, and the row that got silently dropped would be a message
 * somebody was owed. A CHECK failure is the same story: the schema describes
 * shapes the builders cannot legally produce, so tripping one means the value
 * did not come from where it was supposed to.
 *
 * Failing the booking is the conservative answer. The guest sees an error and
 * retries; the alternative is a confirmed reservation nobody will ever be told
 * about.
 */

/**
 * Inserts one notification event into the outbox.
 *
 * Writes exactly the six columns that are frozen at insert. Every other column
 * is left to the schema: `attempts` starts at 0, `next_attempt_at` and
 * `created_at`/`updated_at` default to the current time — the transaction's own clock,
 * which is the right one — and the envelope, the verdict, the error and the
 * provider reference all start NULL because nothing has been attempted yet.
 * Naming any of them here would be this layer claiming to know something about
 * dispatch, which it does not.
 *
 * Returns nothing. The id exists, but no caller has a use for it: the
 * dispatcher finds rows by its own claim query, nothing holds a foreign key to
 * this table, and the business flow has no further business with the row. A
 * returned id would also be a reference to something that may never exist —
 * the caller's transaction can still roll back — so handing one out would
 * invite exactly the mistake this shape prevents.
 *
 * @throws whatever the database raised, unchanged. See the note above.
 */
export async function insertNotificationEvent(
  client: PoolClient,
  event: NotificationEvent,
): Promise<void> {
  await client.query(
    `INSERT INTO notification_outbox
       (event_type, booking_reference, recipient_kind, recipient_email, template_key, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      event.eventType,
      event.bookingReference,
      event.recipientKind,
      event.recipientEmail,
      event.templateKey,
      // Serialised here rather than left to the driver's own object handling,
      // so what lands in the JSON column is decided by this file and not by a coercion
      // rule that could change under it. It is also a copy: the caller's
      // payload is never handed to the driver to hold.
      JSON.stringify(event.payload),
    ],
  );

  // No rowCount check. A single-row INSERT with no ON CONFLICT either inserts
  // its row or raises, so a zero here is unreachable and a guard against it
  // would be a branch no test could ever enter.
}

// ---------------------------------------------------------------------------
// THE DISPATCHER SIDE
//
// Claiming a row, and recording what happened to it. None of this runs in a
// request path.
// ---------------------------------------------------------------------------

/** A bigserial id, kept as the string the driver produced. */
const INTERNAL_ID_PATTERN = /^[1-9]\d*$/;

/** What the acceptance axis can say once an attempt has been made. */
export type NotificationAcceptance = 'rejected' | 'unknown';

/**
 * One row, leased and ready to send.
 *
 * Carries the frozen columns plus the envelope the claim resolved. `attempts`
 * is the count INCLUDING this claim, so a caller comparing it against its own
 * ceiling is asking "how many times has this been tried", not "how many times
 * before now".
 */
export type ClaimedNotificationEvent = {
  /**
   * The row's own id, as text.
   *
   * Never a number: `bigint` outruns exact integer arithmetic in JavaScript,
   * and a key that has been through a float may no longer identify the row it
   * came from. It exists to be handed back to the writes below.
   */
  readonly id: string;
  readonly eventType: string;
  readonly bookingReference: string;
  readonly recipientKind: string;
  readonly recipientEmail: string | null;
  readonly templateKey: string;
  /**
   * The stored payload, deliberately opaque here.
   *
   * Checking it against the contract its `templateKey` names is the renderer's
   * job, and doing it in two places would be two things that could disagree
   * about what a valid payload is. Persistence hands back what it stored.
   */
  readonly payload: unknown;
  readonly attempts: number;
  /** Resolved on the first claim, and identical on every claim after it. */
  readonly resolvedFrom: string;
  readonly resolvedTo: string;
};

type ClaimedRow = {
  /**
   * The row's `next_attempt_at` as it stood BEFORE this claim, read from the
   * CTE. The column itself has already been pushed forward by the lease, so
   * the post-update value is the same instant for every row in the batch and
   * says nothing about the order they were selected in.
   */
  claim_due_at: Date;
  id: string;
  event_type: string;
  booking_reference: string;
  recipient_kind: string;
  recipient_email: string | null;
  template_key: string;
  payload: unknown;
  attempts: number;
  resolved_from: string;
  resolved_to: string;
};

/**
 * The guards below protect against stored data this schema's own constraints
 * say cannot exist. If one fires it is a data or migration problem, so it
 * raises rather than being softened into a default.
 */
function requireOutboxText(column: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Unexpected notification ${column} from the database: expected a non-empty value`);
  }

  return value;
}

function requireOutboxId(value: unknown): string {
  if (typeof value !== 'string' || !INTERNAL_ID_PATTERN.test(value)) {
    throw new Error('Unexpected notification id from the database: expected an internal identifier');
  }

  return value;
}

function requireOutboxAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Unexpected notification attempts from the database: expected a count of at least 1');
  }

  return value;
}

function toClaimedNotificationEvent(row: ClaimedRow): ClaimedNotificationEvent {
  return {
    id: requireOutboxId(row.id),
    eventType: requireOutboxText('event_type', row.event_type),
    bookingReference: requireOutboxText('booking_reference', row.booking_reference),
    recipientKind: requireOutboxText('recipient_kind', row.recipient_kind),
    recipientEmail:
      row.recipient_email === null ? null : requireOutboxText('recipient_email', row.recipient_email),
    templateKey: requireOutboxText('template_key', row.template_key),
    payload: row.payload,
    attempts: requireOutboxAttempts(row.attempts),
    resolvedFrom: requireOutboxText('resolved_from', row.resolved_from),
    resolvedTo: requireOutboxText('resolved_to', row.resolved_to),
  };
}

export type ClaimNotificationEventsInput = {
  /** How many rows to lease at most. */
  readonly limit: number;
  /** The sender this deployment uses, for rows never claimed before. */
  readonly resolvedFrom: string;
  /** Where a HOTEL event goes. Ignored for guest rows, which carry their own. */
  readonly hotelRecipient: string;
  /**
   * How long this claim holds the rows, in seconds.
   *
   * The lease, and the reason a crash between claiming and sending does not
   * become a hot loop: `next_attempt_at` moves forward now, so another poll
   * cannot pick the row straight back up. Chosen by the caller, because how
   * long a send may take is the dispatcher's knowledge and not this file's.
   */
  readonly leaseSeconds: number;
};

/**
 * Leases up to `limit` due rows and returns them ready to send.
 *
 * One statement. The inner SELECT chooses and the outer UPDATE leases, so
 * there is no window between picking a row and holding it.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets more than one dispatcher run: a row
 * another worker already holds is passed over rather than waited for, so two
 * processes divide the backlog instead of serialising on its head. The
 * ORDER BY matches `notification_outbox_claim_idx` — due first, then oldest —
 * so the scan stops at `limit` rather than sorting the queue.
 *
 * `attempts` is incremented HERE, at claim time, not after a send. A process
 * that dies mid-flight has still used an attempt; counting only completed
 * sends would let a row that crashes the sender be retried forever.
 *
 * The envelope is resolved on the first claim and frozen by COALESCE — first
 * write wins, enforced by the database rather than by remembering to check.
 * That matters because every retry goes under one idempotency key derived from
 * the event and booking reference, so a settings change between attempts must
 * not be able to alter a queued message and turn a legitimate retry into a
 * rejected conflicting replay. A guest row takes its own `recipient_email`; a
 * hotel row, whose address is deployment configuration, takes `hotelRecipient`.
 *
 * An empty array means nothing is due, which is the ordinary state of a
 * healthy queue and not a condition.
 */
export async function claimNotificationEvents(
  client: PoolClient,
  input: ClaimNotificationEventsInput,
): Promise<ClaimedNotificationEvent[]> {
  // Three statements inside the caller's (short) transaction: choose and lock
  // with SKIP LOCKED, lease, then read the leased rows back. MySQL has no
  // UPDATE ... RETURNING and no UPDATE ... FROM, so the pre-lease due time is
  // carried from the first statement rather than the CTE.
  const due = await client.query<{ id: string; next_attempt_at: Date }>(
    `SELECT id, next_attempt_at
       FROM notification_outbox
      WHERE accepted_at IS NULL
        AND failed_at IS NULL
        AND next_attempt_at <= UTC_TIMESTAMP(3)
      ORDER BY next_attempt_at, id
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [input.limit],
  );

  if (due.rows.length === 0) {
    return [];
  }

  const ids = due.rows.map((row) => row.id);
  const dueAt = new Map(due.rows.map((row) => [String(row.id), row.next_attempt_at]));
  const placeholders = ids.map(() => '?').join(', ');

  await client.query(
    `UPDATE notification_outbox
        SET attempts = attempts + 1,
            last_attempt_at = UTC_TIMESTAMP(3),
            next_attempt_at = UTC_TIMESTAMP(3) + INTERVAL ? SECOND,
            resolved_from = COALESCE(resolved_from, ?),
            resolved_to = COALESCE(resolved_to, recipient_email, ?),
            updated_at = UTC_TIMESTAMP(3)
      WHERE id IN (${placeholders})`,
    [input.leaseSeconds, input.resolvedFrom, input.hotelRecipient, ...ids],
  );

  const { rows: leased } = await client.query<Omit<ClaimedRow, 'claim_due_at'>>(
    `SELECT CAST(o.id AS CHAR) AS id,
            o.event_type,
            o.booking_reference,
            o.recipient_kind,
            o.recipient_email,
            o.template_key,
            o.payload,
            o.attempts,
            o.resolved_from,
            o.resolved_to
       FROM notification_outbox o
      WHERE o.id IN (${placeholders})`,
    ids,
  );

  const rows: ClaimedRow[] = leased.map((row) => {
    const claimDueAt = dueAt.get(String(row.id));

    if (!claimDueAt) {
      throw new Error('Unexpected notification id from the database: leased a row that was not selected');
    }

    return { ...row, claim_due_at: claimDueAt };
  });

  // The read-back makes no promise about the order it returns rows in, so
  // the claim's own order is restored here — and it is restored on the SAME
  // key the claim selected by, `(next_attempt_at, id)`, using the due time as
  // it stood before the lease moved it. Sorting by id alone would be a
  // different order: an old row that has been retried into the future would
  // jump ahead of a newer row that is due now.
  return rows
    .slice()
    .sort((left, right) => {
      const dueOrder = left.claim_due_at.getTime() - right.claim_due_at.getTime();

      if (dueOrder !== 0) {
        return dueOrder;
      }

      // Numeric, not lexicographic: '30' sorts before '7' as text.
      return BigInt(left.id) < BigInt(right.id) ? -1 : 1;
    })
    .map(toClaimedNotificationEvent);
}

/**
 * Whether the write found its row.
 *
 * `applied: false` is not an error and must not be treated as one. It is the
 * ordinary answer to "this row is no longer the one I claimed" — already
 * accepted, already abandoned, or already re-claimed by somebody else — and
 * every one of those means another attempt is authoritative and this one
 * should keep its hands off.
 */
export type NotificationStateWriteResult = { readonly applied: boolean };

/**
 * Every completion below is guarded on `attempts = $expectedAttempt`, the
 * number the claim returned.
 *
 * That number is the lease's receipt. A send that overran its lease has had
 * its row re-claimed and re-sent by another worker, and `attempts` has moved
 * on; without the guard, the slow attempt's answer would land on top of the
 * fast one's — marking a row failed that another worker had already got
 * accepted, or writing a stale provider reference over a live one. With it,
 * the late write matches nothing and says so.
 *
 * The two terminal guards are there for the same reason from the other
 * direction: `accepted_at IS NULL AND failed_at IS NULL` means a settled row
 * stays settled. In particular an abandoned row can never be quietly turned
 * into an accepted one by a completion that arrived after somebody gave up.
 *
 * None of the three touches `resolved_from` or `resolved_to`. The envelope is
 * frozen at the first claim and every retry has to rebuild the identical
 * request.
 */

/**
 * Records that the provider took the message.
 *
 * `accepted_at` means accepted, never delivered: the provider answered and owns
 * the message now. If delivery is ever tracked it gets its own column.
 *
 * The row leaves the claim index here and is never sent again. The acceptance
 * verdict and the last error are cleared because neither describes this row any
 * more — a stale `unknown` sitting beside an `accepted_at` would invite
 * somebody to read a settled row as ambiguous.
 *
 * `accepted_at IS NULL` in the WHERE keeps the first acceptance authoritative:
 * a duplicated completion cannot move the timestamp or overwrite the provider
 * reference of the send that actually succeeded.
 *
 * The envelope is untouched. Nothing after the first claim may move it.
 */
export async function markNotificationAccepted(
  client: PoolClient,
  input: {
    readonly id: string;
    readonly expectedAttempt: number;
    readonly providerReference: string | null;
  },
): Promise<NotificationStateWriteResult> {
  const { rowCount } = await client.query(
    `UPDATE notification_outbox
        SET accepted_at = UTC_TIMESTAMP(3),
            provider_reference = $3,
            last_attempt_acceptance = NULL,
            last_error = NULL,
            updated_at = UTC_TIMESTAMP(3)
      WHERE id = $1
        AND attempts = $2
        AND accepted_at IS NULL
        AND failed_at IS NULL`,
    [input.id, input.expectedAttempt, input.providerReference],
  );

  return { applied: (rowCount ?? 0) > 0 };
}

/**
 * Records a failed attempt, and when the row becomes due again.
 *
 * `acceptance` is the durable half of the answer and the only part anybody
 * reads later: `rejected` means the provider definitively did not take it, so
 * no message exists; `unknown` means acceptance could not be determined and one
 * may. Whether to retry is the dispatcher's separate, ephemeral decision and is
 * deliberately not stored — a permanent refusal and a timeout are both
 * failures, but only one of them is ambiguous.
 *
 * `attempts` is NOT incremented: the claim already counted this try. Nothing
 * terminal is written, so the row simply returns to the queue once
 * `retryAfterSeconds` has passed. Giving up is `markNotificationAbandoned`, a
 * separate decision with a separate name.
 *
 * The envelope is untouched, which is the whole point of freezing it: the next
 * attempt has to rebuild an identical request.
 */
export async function markNotificationAttemptFailed(
  client: PoolClient,
  input: {
    readonly id: string;
    readonly expectedAttempt: number;
    readonly acceptance: NotificationAcceptance;
    readonly error: string | null;
    readonly retryAfterSeconds: number;
  },
): Promise<NotificationStateWriteResult> {
  const { rowCount } = await client.query(
    `UPDATE notification_outbox
        SET next_attempt_at = UTC_TIMESTAMP(3) + INTERVAL $5 SECOND,
            last_attempt_acceptance = $3,
            last_error = $4,
            updated_at = UTC_TIMESTAMP(3)
      WHERE id = $1
        AND attempts = $2
        AND accepted_at IS NULL
        AND failed_at IS NULL`,
    [input.id, input.expectedAttempt, input.acceptance, input.error, input.retryAfterSeconds],
  );

  return { applied: (rowCount ?? 0) > 0 };
}

/**
 * Records that the dispatcher has stopped trying.
 *
 * `failed_at` is the record that somebody was not told something. The row
 * leaves the claim index and nothing sweeps it: retention has to keep these,
 * because a queue that quietly forgot its failures would look healthy while
 * being the opposite.
 *
 * The acceptance verdict travels with it, and it is the field a person reads
 * first. `rejected` means no message exists and the booking can safely be
 * followed up by hand; `unknown` means one may already have gone out, and a
 * second would be a duplicate to a guest.
 */
export async function markNotificationAbandoned(
  client: PoolClient,
  input: {
    readonly id: string;
    readonly expectedAttempt: number;
    readonly acceptance: NotificationAcceptance;
    readonly error: string | null;
  },
): Promise<NotificationStateWriteResult> {
  const { rowCount } = await client.query(
    `UPDATE notification_outbox
        SET failed_at = UTC_TIMESTAMP(3),
            last_attempt_acceptance = $3,
            last_error = $4,
            updated_at = UTC_TIMESTAMP(3)
      WHERE id = $1
        AND attempts = $2
        AND accepted_at IS NULL
        AND failed_at IS NULL`,
    [input.id, input.expectedAttempt, input.acceptance, input.error],
  );

  return { applied: (rowCount ?? 0) > 0 };
}
