import type { PoolClient } from 'pg';
import type { NotificationEvent } from './notifications.types';

/**
 * Writes to `notification_outbox`, and nothing else.
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
 * `created_at`/`updated_at` default to `now()` — the transaction's own clock,
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
 * @throws whatever PostgreSQL raised, unchanged. See the note above.
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
      // so what lands in `jsonb` is decided by this file and not by a coercion
      // rule that could change under it. It is also a copy: the caller's
      // payload is never handed to the driver to hold.
      JSON.stringify(event.payload),
    ],
  );

  // No rowCount check. A single-row INSERT with no ON CONFLICT either inserts
  // its row or raises, so a zero here is unreachable and a guard against it
  // would be a branch no test could ever enter.
}
