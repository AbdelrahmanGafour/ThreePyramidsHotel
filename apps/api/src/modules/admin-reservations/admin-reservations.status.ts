import type { AdminReservationStatus, AdminReservationStatusTarget } from './admin-reservations.types';

/**
 * Which moves a reservation may make, in one place.
 *
 * This is the only statement of the rule. A controller, a repository or a
 * button that decided for itself would be a second opinion able to disagree
 * with this one — and the disagreement would show up as a booking in a state
 * nobody meant to allow.
 *
 * V1 in full:
 *
 *   pending   -> confirmed   a booking the hotel accepts
 *   pending   -> cancelled   a booking that falls through before confirmation
 *   confirmed -> cancelled   a confirmed stay called off
 *
 * Everything else is refused, including every same-state move: confirming a
 * confirmed booking is not a quiet success, it is a request that misunderstood
 * the booking, and answering it with "done" would hide that.
 *
 * `cancelled` is terminal. A cancelled reservation has released its room to the
 * exclusion constraint, and that room may already be someone else's — so there
 * is nothing to revive it into. Undoing a cancellation means taking a new
 * booking, which is the reservation flow's job, not this one's.
 *
 * Nothing returns to `pending`: it is where a booking starts, and a hotel that
 * has said yes or no does not go back to not having decided.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<AdminReservationStatus, readonly AdminReservationStatusTarget[]>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['cancelled'],
  // Terminal, and deliberately written out rather than omitted: an empty list
  // is a decision, and the next person should see it was made on purpose.
  cancelled: [],
};

/**
 * Answers whether a reservation in `currentStatus` may become `nextStatus`.
 *
 * Pure: it reads the rule and nothing else — no database, no request, no clock.
 * `currentStatus` is the reservation's stored state, which the repository has
 * already checked against the schema's own constraint.
 */
export function isAdminReservationStatusTransitionAllowed(
  currentStatus: AdminReservationStatus,
  nextStatus: AdminReservationStatusTarget,
): boolean {
  return ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus);
}
