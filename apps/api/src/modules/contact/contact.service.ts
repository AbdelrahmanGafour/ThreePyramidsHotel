import type { PoolClient } from '../../db/pool';
import { dbPool } from '../../db/pool';
import { buildContactInquiryReceivedNotification } from '../notifications/notifications.events';
import { insertNotificationEvent } from '../notifications/notifications.repository';
import { generateContactReference } from './contact-reference';
import { parseContactInquiryInput } from './contact.validation';

/**
 * Accepting one contact inquiry.
 *
 * The whole flow is a validation and a single INSERT. A visitor's message
 * becomes one `notification_outbox` row and nothing else — there is no contact
 * table, so that row is both the delivery queue and the only copy of what they
 * wrote.
 *
 * ---------------------------------------------------------------------------
 * NO TRANSACTION, DELIBERATELY
 *
 * The four reservation flows wrap `insertNotificationEvent` in BEGIN/COMMIT
 * because they have a business row that must commit atomically with the event.
 * This one has no second row: a single statement is already atomic, so a
 * transaction would buy nothing and cost two round trips.
 *
 * It would also break the retry below. `insertNotificationEvent` is strict —
 * no `ON CONFLICT` — so a duplicate reference RAISES, and inside a transaction
 * that raise aborts everything after it (`25P02`). The room flow can retry
 * references inside its transaction only because its insert uses
 * `ON CONFLICT DO NOTHING`, which makes a conflict a non-error. Outside a
 * transaction each statement is its own implicit one, so a failed INSERT
 * aborts only itself and leaves the session usable — which is exactly what
 * makes retrying possible here.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS SENT HERE
 *
 * No provider call, no network, no rendering. The dispatcher claims the row
 * later and sends it, so a slow or unavailable Resend cannot make a visitor's
 * form submission hang or fail.
 */

/** Matches the room flow's `MAX_BOOKING_REFERENCE_ATTEMPTS`. */
const MAX_REFERENCE_ATTEMPTS = 5;

/** PostgreSQL unique_violation. */
const UNIQUE_VIOLATION_SQLSTATE = '23505';

/**
 * The outbox's own `UNIQUE (event_type, booking_reference)`, by its real name.
 *
 * Matched exactly rather than on the SQLSTATE alone: a bare `23505` check
 * would also swallow a unique violation on some column added later, and
 * silently retry something a new reference cannot fix.
 */
const OUTBOX_EVENT_BOOKING_CONSTRAINT = 'notification_outbox_event_booking_key';

/** True only for a collision a fresh reference would actually resolve. */
function isReferenceCollision(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION_SQLSTATE &&
    (error as { constraint?: unknown }).constraint === OUTBOX_EVENT_BOOKING_CONSTRAINT
  );
}

/**
 * What the visitor is told.
 *
 * Deliberately empty of everything. The internal `TPC-` reference is not here,
 * and neither is any field they submitted: a response that echoed a message
 * back would make this endpoint a small reflection service for anyone who
 * wanted one.
 */
export type ContactInquiryAccepted = { readonly received: true };

/**
 * Validates and queues one contact inquiry.
 *
 * @throws {ContactInquiryValidationError} for anything the form should not
 * have sent, the honeypot included and indistinguishable.
 * @throws whatever PostgreSQL raised, unchanged, for any error that is not a
 * reference collision.
 */
export async function submitContactInquiry(body: unknown): Promise<ContactInquiryAccepted> {
  // First, and before a connection is taken: a malformed or trapped submission
  // never touches the database.
  const input = parseContactInquiryInput(body);

  const client: PoolClient = await dbPool.connect();

  try {
    for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
      const event = buildContactInquiryReceivedNotification({
        reference: generateContactReference(),
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        inquiryType: input.inquiryType,
        message: input.message,
      });

      try {
        await insertNotificationEvent(client, event);

        return { received: true };
      } catch (error) {
        // Only a collision on the outbox's own uniqueness is worth another
        // reference. Everything else — a CHECK violation, a lost connection,
        // a different unique index — propagates exactly as PostgreSQL raised
        // it, because none of it would be fixed by trying again.
        if (!isReferenceCollision(error)) {
          throw error;
        }
      }
    }

    // Unreachable short of something badly wrong: the reference is 12
    // characters from a 32-symbol alphabet, so five collisions in a row is not
    // a probability, it is a symptom. Generic on purpose — the controller
    // turns this into a sanitised 500.
    throw new Error(
      `Could not generate a unique contact reference after ${MAX_REFERENCE_ATTEMPTS} attempts`,
    );
  } finally {
    client.release();
  }
}
