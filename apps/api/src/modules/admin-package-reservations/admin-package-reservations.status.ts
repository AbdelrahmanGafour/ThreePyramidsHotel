import type {
  AdminPackageReservationStatus,
  AdminPackageReservationStatusTarget,
} from './admin-package-reservations.types';

/**
 * Which moves a package reservation may make, in one place.
 *
 * This is the only statement of the rule. A controller, a repository or a
 * button that decided for itself would be a second opinion able to disagree
 * with this one — and the disagreement would show up as a booking in a state
 * nobody meant to allow. The SQL below derives its own WHERE clause from this
 * table rather than restating it, so the two cannot drift apart.
 *
 * V1 in full:
 *
 *   pending -> confirmed   a request the hotel accepts
 *   pending -> cancelled   a request that falls through before confirmation
 *
 * Deliberately STRICTER than the room reservation rule, which also allows
 * `confirmed -> cancelled`. A confirmed room stay holds inventory that
 * cancelling releases; a confirmed package has no inventory to release, and
 * unwinding one is a conversation with an operator about a tour that may
 * already be booked with a third party. Until that process exists, this
 * endpoint must not pretend to perform it.
 *
 * Every same-state move is refused too: confirming a confirmed reservation is
 * not a quiet success, it is a request that misunderstood the booking, and
 * answering it with "done" would hide that.
 *
 * Nothing returns to `pending`: it is where a request starts, and a hotel that
 * has said yes or no does not go back to not having decided.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<AdminPackageReservationStatus, readonly AdminPackageReservationStatusTarget[]>
> = {
  pending: ['confirmed', 'cancelled'],
  // Both terminal, and deliberately written out rather than omitted: an empty
  // list is a decision, and the next person should see it was made on purpose.
  confirmed: [],
  cancelled: [],
};

const ALL_STATUSES: readonly AdminPackageReservationStatus[] = ['pending', 'confirmed', 'cancelled'];

/**
 * Answers whether a reservation in `currentStatus` may become `nextStatus`.
 *
 * Pure: it reads the rule and nothing else — no database, no request, no clock.
 */
export function isAdminPackageReservationStatusTransitionAllowed(
  currentStatus: AdminPackageReservationStatus,
  nextStatus: AdminPackageReservationStatusTarget,
): boolean {
  return ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus);
}

/**
 * Every stored status a reservation may legally be in to become `nextStatus`.
 *
 * Read straight from the table above so the conditional UPDATE's WHERE clause
 * is the rule itself rather than a copy of it. Widening the rule later widens
 * the SQL automatically; hardcoding `'pending'` in the query would not.
 */
export function allowedSourceStatusesFor(
  nextStatus: AdminPackageReservationStatusTarget,
): AdminPackageReservationStatus[] {
  return ALL_STATUSES.filter((current) =>
    isAdminPackageReservationStatusTransitionAllowed(current, nextStatus),
  );
}
