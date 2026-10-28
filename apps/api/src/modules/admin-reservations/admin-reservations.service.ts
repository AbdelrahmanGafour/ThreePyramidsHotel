import { dbPool } from '../../db/pool';
import { buildRoomReservationConfirmedEvent } from '../notifications/notifications.events';
import { insertNotificationEvent } from '../notifications/notifications.repository';
import {
  findAdminReservationByReference,
  findAdminReservationPage,
  lockReservationForStatusChange,
  updateReservationStatus,
  type AdminReservationListPage,
  type AdminReservationStatusChange,
} from './admin-reservations.repository';
import { isAdminReservationStatusTransitionAllowed } from './admin-reservations.status';
import type {
  AdminReservationDetail,
  AdminReservationListQuery,
  AdminReservationStatusTarget,
} from './admin-reservations.types';

/**
 * Reads one page of reservations for the administration list.
 *
 * Thin by design, and deliberately still here: it is the seam where later
 * reservation rules belong — status filtering, an operational "arriving today"
 * view — so neither the controller nor the repository has to grow HTTP or SQL
 * concerns to accommodate them.
 *
 * Knows nothing about Express: it takes a window the validator already
 * approved, and returns domain data with no response envelope around it.
 * Authentication happens in the route chain, never here.
 */
export async function listAdminReservations(
  query: AdminReservationListQuery,
): Promise<AdminReservationListPage> {
  return findAdminReservationPage(query);
}

/**
 * Reads one reservation by its booking reference.
 *
 * Thin on purpose, and read-only. The reference arrives already validated, and
 * is used exactly as given: normalising it here would mean looking up a value
 * the caller never sent.
 *
 * Returns null only when no reservation has that reference. A stored row that
 * cannot be trusted raises from the repository instead, so a data fault never
 * reaches a caller disguised as a missing booking.
 */
export async function getAdminReservation(
  bookingReference: string,
): Promise<AdminReservationDetail | null> {
  return findAdminReservationByReference(bookingReference);
}

/**
 * Three things that can happen, as values rather than a mixture of values and
 * thrown errors.
 *
 * A discriminated union rather than `null` plus an exception: not-found and a
 * refused transition are both ordinary answers this endpoint gives every day,
 * and a caller that forgets one should fail to compile rather than fail in
 * production. A genuine fault — a lost connection, a row the schema says cannot
 * exist — is none of these three and still throws.
 */
export type AdminReservationStatusChangeResult =
  | { outcome: 'updated'; reservation: AdminReservationStatusChange }
  | { outcome: 'not-found' }
  | { outcome: 'invalid-transition' };

/**
 * Changes one reservation's status, serialized against every other attempt on
 * the same reservation.
 *
 * The whole decision happens inside one transaction holding the row's lock:
 * read the current status, ask the policy, write. A second request for the same
 * booking waits at the lock and then reads what the first one actually did, so
 * two administrators confirming at once cannot both succeed — the second sees
 * `confirmed` and is refused.
 *
 * Which of them wins is MySQL's to decide by lock order, and this code
 * does not try to influence it. A confirm and a cancel racing may therefore
 * both succeed, in that order: pending -> confirmed -> cancelled is a perfectly
 * legal history.
 *
 * The transaction lives here rather than in the repository, following the same
 * split reservation creation uses: the service owns the connection and the
 * transaction, the repository issues statements on the client it is given.
 *
 * Only the status moves. The allocated room, the stay and the price are never
 * touched, and no room is re-allocated — a cancellation frees inventory purely
 * by changing what the overlap check considers active.
 */
export async function changeAdminReservationStatus(
  bookingReference: string,
  nextStatus: AdminReservationStatusTarget,
): Promise<AdminReservationStatusChangeResult> {
  const client = await dbPool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const locked = await lockReservationForStatusChange(client, bookingReference);

    if (!locked) {
      // Nothing was read that matters and nothing was written; the rollback
      // just ends the transaction and releases whatever it held. The flag is
      // cleared only once it has actually succeeded, so a rollback that throws
      // still reaches the handler below.
      await client.query('ROLLBACK');
      inTransaction = false;

      return { outcome: 'not-found' };
    }

    // The one canonical policy, asked here and nowhere else. It is deliberately
    // not expressed in the WHERE clause: a rule spread between SQL and
    // TypeScript is a rule that can disagree with itself.
    if (!isAdminReservationStatusTransitionAllowed(locked.status, nextStatus)) {
      await client.query('ROLLBACK');
      inTransaction = false;

      return { outcome: 'invalid-transition' };
    }

    const reservation = await updateReservationStatus(client, bookingReference, nextStatus);

    if (nextStatus === 'confirmed') {
      // The guest's copy of the confirmation, queued in the same transaction.
      //
      // Only on confirmation. A cancellation is a different conversation and a
      // different event, and this slice owes the guest nothing when a booking
      // is called off — so nothing is queued and no template decides later
      // whether to stay silent.
      //
      // After the UPDATE, so the status this announces is the one that was
      // actually written. Before the COMMIT, so the confirmed booking and the
      // obligation to tell the guest become durable together: there is no
      // instant at which a reservation reads `confirmed` and nobody is going
      // to hear about it.
      //
      // Every field comes from the row locked at the top of this transaction,
      // which is the only moment they are provably consistent with the status
      // being changed. No re-read, and no `process.env`.
      //
      // Strict, and allowed to be fatal. `insertNotificationEvent` carries no
      // `ON CONFLICT` and translates nothing, so a failure raises past here
      // into the catch below and rolls the confirmation back with it. An
      // administrator who sees an error and retries costs less than a guest
      // who is never told their stay was confirmed.
      await insertNotificationEvent(
        client,
        buildRoomReservationConfirmedEvent({
          bookingReference: reservation.bookingReference,
          guestFirstName: locked.guestFirstName,
          guestLastName: locked.guestLastName,
          // Becomes `recipientEmail`, not a payload field: the address as it
          // stood when the hotel confirmed, so a later edit cannot redirect a
          // notification that was already owed to somebody.
          guestEmail: locked.guestEmail,
          roomTypeName: locked.roomTypeName,
          checkIn: locked.checkIn,
          checkOut: locked.checkOut,
          nights: locked.nights,
          adults: locked.adults,
          children: locked.children,
          nightlyRate: locked.nightlyRate,
          totalAmount: locked.totalAmount,
          specialRequests: locked.specialRequests,
        }),
      );
    }

    // Cleared only after COMMIT returns, so a commit that fails is still an
    // open transaction as far as the handler below is concerned.
    await client.query('COMMIT');
    inTransaction = false;

    return { outcome: 'updated', reservation };
  } catch (error) {
    // One rollback path for every failure, including a failed COMMIT.
    if (inTransaction) {
      inTransaction = false;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to roll back reservation status transaction:', rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}
