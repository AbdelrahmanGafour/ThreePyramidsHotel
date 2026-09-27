/**
 * The transactional outbox for reservation notification emails.
 *
 * One row is one notification that MUST be sent. It is written in the same
 * transaction as the reservation or status change it is about, so the two
 * commit together or neither does: state without its required notification is
 * the failure this table exists to make impossible. Nothing reads it in a
 * request path — a separate dispatcher claims rows, sends them, and records
 * what the provider said.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO FOREIGN KEY
 *
 * A notification's subject lives in one of TWO tables — `reservations` or
 * `package_reservations` — and `event_type` is what says which. There is no
 * single column a foreign key could point at, so the aggregate is identified
 * by `booking_reference`, which is already unique within each of those tables.
 *
 * That is a deliberate trade, not an oversight. A RESTRICT key would also have
 * obstructed the journey hard-delete path, and a CASCADE would silently
 * discard the record that somebody was never told something.
 *
 * ---------------------------------------------------------------------------
 * NO STATUS COLUMN
 *
 * State is derived from the timestamps, which are the only durable facts:
 *
 *     pending   accepted_at IS NULL AND failed_at IS NULL
 *     accepted  accepted_at IS NOT NULL
 *     abandoned failed_at IS NOT NULL
 *
 * A `status` column alongside them would be a second truth able to contradict
 * the first. `accepted_at` is named for what it records: the provider took the
 * message. It is NOT proof of delivery, and must never be read as one — if
 * delivery is ever tracked it gets its own column.
 *
 * ---------------------------------------------------------------------------
 * TWO EPOCHS OF IMMUTABILITY
 *
 * The provider request must be byte-identical across retries, because the
 * dispatcher sends every attempt under one idempotency key derived from
 * `(event_type, booking_reference)`. So the row freezes in two stages:
 *
 *   at INSERT, never updated:  event_type, booking_reference, recipient_kind,
 *                              recipient_email, template_key, payload
 *   at FIRST CLAIM, never updated after:  resolved_from, resolved_to
 *
 * The envelope cannot be frozen at insert, because `resolved_from` and the
 * hotel's `resolved_to` come from mail configuration — and reading that inside
 * a reservation transaction would let an unset email setting refuse a booking.
 * So the dispatcher resolves them once, on the claim that first touches the
 * row, and afterwards they are as fixed as the payload.
 *
 * ---------------------------------------------------------------------------
 * Additive throughout. No existing table, column, constraint, index or row is
 * touched, and the table starts empty. Nothing here knows which email provider
 * will send anything: no credential, no provider name, no endpoint, and no
 * rendered subject or body. The message is rendered at send time from
 * `template_key` and `payload`, so this table stores what a notification IS
 * and never what it looked like.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * The four events this system notifies about, and the whole of them.
 *
 * Written as a CHECK over `text` rather than a PostgreSQL enum, matching every
 * other status-like column in this schema (`reservations_status_check`,
 * `package_reservations_status_check`). Adding a value later is a migration
 * either way, and a text column needs no type-altering dance to do it.
 */
const EVENT_TYPES = [
  'room_reservation_created',
  'room_reservation_confirmed',
  'package_reservation_created',
  'package_reservation_confirmed',
];

/** Who the message goes to, as a role. The address is a separate question. */
const RECIPIENT_KINDS = ['hotel', 'guest'];

/**
 * What the last attempt proved about acceptance — the axis that decides
 * whether a frozen envelope may ever be re-resolved.
 *
 * Deliberately NOT the dispatcher's retry decision. "Retry this later" and
 * "no message can exist" are different questions: a validation refusal is
 * permanent AND definitely un-accepted, while a timeout is retryable AND
 * ambiguous. Only this axis is durable, because only it is consulted later,
 * by a person.
 *
 *   rejected  the provider definitively did not accept; no message exists
 *   unknown   acceptance cannot be determined; a message may exist
 *
 * NULL means no verdict has been recorded. On a row that already carries a
 * resolved envelope that is the crash window itself — claimed, then the
 * process died, with "before sending" and "after sending" indistinguishable —
 * so NULL must be treated as ambiguous, never as a rejection.
 */
const ACCEPTANCE_VERDICTS = ['rejected', 'unknown'];

/** `'a', 'b'` — a SQL literal list for an IN (...) predicate. */
const quoted = (values) => values.map((value) => `'${value}'`).join(', ');

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable('notification_outbox', {
    id: { type: 'bigserial', primaryKey: true },

    // --- What must be sent. Written at INSERT, never updated. ---
    event_type: { type: 'text', notNull: true },
    // The aggregate's identity. Unique within whichever reservations table
    // `event_type` names; see the note above on why this is not a foreign key.
    booking_reference: { type: 'text', notNull: true },
    recipient_kind: { type: 'text', notNull: true },
    // The guest's address, snapshotted from the reservation because the
    // message is about the booking that guest made. NULL for a hotel event,
    // whose address is configuration the dispatcher resolves — see the
    // recipient-pairing constraint below.
    recipient_email: { type: 'text' },
    // Versioned, e.g. `room_created_hotel.v1`. A renderer for a given key must
    // keep working for as long as rows carry it; changing what a key requires
    // means a new key, not an edit.
    template_key: { type: 'text', notNull: true },
    // Everything the template needs, frozen. No internal row id belongs here:
    // a payload is the human-facing facts of a booking, not its keys.
    payload: { type: 'jsonb', notNull: true },

    // --- Dispatch bookkeeping. The only columns a retry may move. ---
    attempts: { type: 'integer', notNull: true, default: 0 },
    last_attempt_at: { type: 'timestamptz' },
    // The claim key. Defaulting to now() makes a freshly inserted row
    // immediately claimable without the writer having to think about it.
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },

    // --- Terminal facts. ---
    // The provider took the message. NOT a delivery receipt.
    accepted_at: { type: 'timestamptz' },
    // The dispatcher gave up after exhausting its attempts. Rows carrying this
    // are the record that somebody was not told something, and retention must
    // never sweep them.
    failed_at: { type: 'timestamptz' },

    // --- What the last attempt learned. ---
    last_attempt_acceptance: { type: 'text' },
    // A short provider-safe reason, for a person. Nothing machine-reads it, so
    // no decision may ever be made by parsing it. It must never carry a
    // credential, a guest's address or a rendered body.
    last_error: { type: 'text' },
    // Whatever id the provider returned on acceptance. Provider-neutral by
    // name, so swapping providers needs no migration.
    provider_reference: { type: 'text' },

    // --- The delivery envelope. Written at FIRST CLAIM, never updated after. ---
    resolved_from: { type: 'text' },
    resolved_to: { type: 'text' },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // This row IS mutable: every attempt moves its bookkeeping, so it has a
    // meaningful last-changed time. Written by the application, as everywhere
    // else in this schema — there is no trigger.
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('notification_outbox', 'notification_outbox_event_type_check', {
    check: `event_type IN (${quoted(EVENT_TYPES)})`,
  });

  pgm.addConstraint('notification_outbox', 'notification_outbox_recipient_kind_check', {
    check: `recipient_kind IN (${quoted(RECIPIENT_KINDS)})`,
  });

  // Exactly one notification per event per booking, forever. This is the whole
  // of the deduplication rule: a retried request, a double-submitted form or a
  // replayed status change cannot create a second logical notification.
  //
  // A composite unique constraint rather than a synthetic dedupe column, so
  // there is no generation rule to keep in step and the writes have a natural
  // conflict target. Events are created strictly — a violation here means an
  // invariant was broken, and it is left to abort the transaction it is in.
  pgm.addConstraint('notification_outbox', 'notification_outbox_event_booking_key', {
    unique: ['event_type', 'booking_reference'],
  });

  // A guest event carries its recipient; a hotel event does not, because the
  // hotel's address is deployment configuration resolved at claim time. Stated
  // as an equivalence so neither half can drift: exactly one shape is legal
  // for each kind.
  pgm.addConstraint('notification_outbox', 'notification_outbox_recipient_pairing_check', {
    check: "(recipient_kind = 'guest') = (recipient_email IS NOT NULL)",
  });

  pgm.addConstraint('notification_outbox', 'notification_outbox_attempts_check', {
    check: 'attempts >= 0',
  });

  // Both envelope halves are written by one statement, so a half-set pair
  // could only mean corruption. Both NULL is the legal pre-claim state, which
  // is why this is an equivalence and not a NOT NULL pair.
  pgm.addConstraint('notification_outbox', 'notification_outbox_resolved_envelope_check', {
    check: '(resolved_from IS NULL) = (resolved_to IS NULL)',
  });

  pgm.addConstraint('notification_outbox', 'notification_outbox_last_attempt_acceptance_check', {
    check: `last_attempt_acceptance IS NULL OR last_attempt_acceptance IN (${quoted(ACCEPTANCE_VERDICTS)})`,
  });

  // The claim query's only index, and the only index this table needs beyond
  // the two its constraints already create.
  //
  // Partial on purpose: a row leaves it the moment it is accepted or
  // abandoned, so the index stays the size of the backlog rather than the size
  // of the history. `(next_attempt_at, id)` matches the claim's own
  // ORDER BY — due first, then oldest — so the scan stops at the batch limit
  // instead of sorting the queue.
  pgm.createIndex('notification_outbox', ['next_attempt_at', 'id'], {
    name: 'notification_outbox_claim_idx',
    where: 'accepted_at IS NULL AND failed_at IS NULL',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // This table only, and nothing else has to be named. It holds no foreign key
  // and nothing references it, so no other table can obstruct the drop and
  // none is touched by it — which is exactly what the absence of a foreign key
  // to the two reservations tables buys.
  pgm.dropTable('notification_outbox');
};
