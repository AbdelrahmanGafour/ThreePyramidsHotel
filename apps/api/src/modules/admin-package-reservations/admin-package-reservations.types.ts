/**
 * The administration contract for package reservations.
 *
 * Separate from the room reservation contract on purpose. The two look alike
 * at a glance and are not the same thing: a package reservation consumes no
 * room inventory, is priced in USD, and may legitimately carry no total at
 * all. Sharing a type between them would mean one set of literals having to
 * describe both currencies and both pricing models.
 */

/** The three states the schema's status CHECK allows, and nothing else. */
export type AdminPackageReservationStatus = 'pending' | 'confirmed' | 'cancelled';

/**
 * Whether the stored total is a real quote or a promise to quote later.
 *
 * `requires_confirmation` is not an error state and not a missing value: the
 * schema's own CHECK makes `total_amount_snapshot` NULL for exactly these
 * reservations, so a null total is the correct answer rather than an absent
 * one. A reader must show it as "to be confirmed", never as zero or blank.
 */
export type AdminPackageReservationPricingStatus = 'quoted' | 'requires_confirmation';

/**
 * One row of the administration list.
 *
 * No database id of any kind appears here — not the reservation's, not the
 * package's, not the variant's. A reservation is addressed by its booking
 * reference, and a package or variant by the slug and key an administrator
 * can also see in the catalogue.
 *
 * Deliberately narrower than the row it is built from. `childAges`,
 * `specialRequests`, `adultUnitRateSnapshot` and `childUnitRateSnapshot` are
 * all stored and all useful, but none of them belongs in a list: they are
 * what a detail view is for, and a list that carries everything is a list
 * that leaks by default.
 */
export type AdminPackageReservationListItem = {
  bookingReference: string;
  /**
   * What the guest actually booked. `code` and `title` are the reservation's
   * own snapshots, so a later catalogue edit cannot rewrite history; `slug`
   * is read from the live package because it is an address rather than a
   * fact about the booking, and is the only way to link to the catalogue.
   */
  package: {
    code: string;
    slug: string;
    title: string;
  };
  /** `label` is the booked snapshot; `key` is the live identifier, as above. */
  variant: {
    key: string;
    label: string;
  };
  guestName: string;
  guestEmail: string;
  /**
   * Included where the room list carries only an email: a confirmation-
   * required booking is settled by contacting the guest, and the phone
   * number is what that takes.
   */
  guestPhone: string;
  /** A calendar day, exactly as stored — never an instant. */
  tourDate: string;
  adults: number;
  children: number;
  status: AdminPackageReservationStatus;
  pricingStatus: AdminPackageReservationPricingStatus;
  currency: 'USD';
  /**
   * The stored quote, exactly as PostgreSQL returned it, or null for a
   * confirmation-required reservation. Never recomputed here: the total was
   * settled when the reservation was taken, and the schema already proves it
   * agrees with the unit rates.
   */
  totalAmountSnapshot: string | null;
  createdAt: string;
};

/** What the service returns, with no HTTP envelope around it. */
export type AdminPackageReservationList = {
  reservations: AdminPackageReservationListItem[];
};

/**
 * One reservation in full.
 *
 * Defined as the list item plus the rest, rather than as a second field list,
 * so "the detail view shows everything the list shows" is true by
 * construction and cannot drift as either contract changes.
 *
 * Still no database id of any kind: a reservation is addressed by its booking
 * reference here exactly as it is in the list.
 */
export type AdminPackageReservationDetail = AdminPackageReservationListItem & {
  guestCountry: string;
  /**
   * One age per child, in the order the guest gave them, or null when exact
   * child pricing never needed ages. Null and `[]` are different answers and
   * both are preserved: the schema forbids an empty array alongside
   * `children > 0`.
   */
  childAges: number[] | null;
  specialRequests: string | null;
  /**
   * The unit rates that produced the total, exactly as stored. Read back, not
   * recomputed: the live catalogue may have been repriced since, and the
   * reservation's own snapshot is what the guest was quoted.
   */
  adultUnitRateSnapshot: string;
  /** Null when no children were booked, or when the total awaits confirmation. */
  childUnitRateSnapshot: string | null;
};

/**
 * The only statuses a request may ask for; `pending` is deliberately absent.
 *
 * It is where a reservation starts, not a place one can be sent, so it is
 * refused as input before any reservation is even loaded.
 */
export type AdminPackageReservationStatusTarget = 'confirmed' | 'cancelled';

export const INVALID_PACKAGE_RESERVATION_STATUS_ERROR_CODE = 'INVALID_PACKAGE_RESERVATION_STATUS';
export const INVALID_PACKAGE_RESERVATION_STATUS_ERROR_MESSAGE = 'Invalid package reservation status';

/** The request body did not name a status this endpoint can be asked for. */
export class InvalidPackageReservationStatusError extends Error {
  readonly code = INVALID_PACKAGE_RESERVATION_STATUS_ERROR_CODE;

  constructor() {
    super(INVALID_PACKAGE_RESERVATION_STATUS_ERROR_MESSAGE);
    this.name = 'InvalidPackageReservationStatusError';
  }
}

export function isInvalidPackageReservationStatusError(
  error: unknown,
): error is InvalidPackageReservationStatusError {
  return error instanceof InvalidPackageReservationStatusError;
}

export const INVALID_PACKAGE_RESERVATION_STATUS_TRANSITION_ERROR_CODE =
  'INVALID_PACKAGE_RESERVATION_STATUS_TRANSITION';
export const INVALID_PACKAGE_RESERVATION_STATUS_TRANSITION_ERROR_MESSAGE =
  'Package reservation status transition is not allowed';

/**
 * A refused transition is a conflict with the reservation's current state, not
 * a malformed request: the reference was real, the target was a status, and
 * the answer is still no. It has no error class beside it — it is an ordinary
 * outcome the service returns as a value, never something thrown.
 *
 * The message names no status. Which state the reservation is actually in is
 * visible from the detail endpoint to the same administrator, and repeating it
 * in an error body only invites a client to branch on parsed English.
 */
export const INVALID_PACKAGE_RESERVATION_STATUS_TRANSITION_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: INVALID_PACKAGE_RESERVATION_STATUS_TRANSITION_ERROR_CODE,
    message: INVALID_PACKAGE_RESERVATION_STATUS_TRANSITION_ERROR_MESSAGE,
  }),
});

export const INVALID_PACKAGE_BOOKING_REFERENCE_ERROR_CODE = 'INVALID_PACKAGE_BOOKING_REFERENCE';
export const INVALID_PACKAGE_BOOKING_REFERENCE_ERROR_MESSAGE = 'Invalid package booking reference';

/**
 * The reference in the URL is not a package booking reference at all.
 *
 * Kept apart from "no reservation has it": one is a malformed request, the
 * other is an answer. The message never echoes the supplied value.
 */
export class InvalidPackageBookingReferenceError extends Error {
  readonly code = INVALID_PACKAGE_BOOKING_REFERENCE_ERROR_CODE;

  constructor() {
    super(INVALID_PACKAGE_BOOKING_REFERENCE_ERROR_MESSAGE);
    this.name = 'InvalidPackageBookingReferenceError';
  }
}

export function isInvalidPackageBookingReferenceError(
  error: unknown,
): error is InvalidPackageBookingReferenceError {
  return error instanceof InvalidPackageBookingReferenceError;
}

export const PACKAGE_RESERVATION_NOT_FOUND_ERROR_CODE = 'PACKAGE_RESERVATION_NOT_FOUND';
export const PACKAGE_RESERVATION_NOT_FOUND_ERROR_MESSAGE = 'Package reservation not found';

/**
 * Frozen so the one not-found body cannot be mutated by a caller that
 * happens to receive it.
 */
export const PACKAGE_RESERVATION_NOT_FOUND_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_RESERVATION_NOT_FOUND_ERROR_CODE,
    message: PACKAGE_RESERVATION_NOT_FOUND_ERROR_MESSAGE,
  }),
});
