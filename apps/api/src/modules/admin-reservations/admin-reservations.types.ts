/**
 * The administration view of reservations. Separate from the guest-facing
 * `reservations` module on purpose: different audience, different guard, and a
 * different set of fields. Nothing here is reachable without an admin session.
 */

/** Mirrors the database's `reservations_status_check`. */
export type AdminReservationStatus = 'pending' | 'confirmed' | 'cancelled';

/**
 * One row of the admin reservations list — deliberately narrow.
 *
 * The database id, the allocated physical room, the nightly rate, the party
 * size and the guest's phone, country and special requests are all absent: they
 * belong to a reservation detail view, and a list that carries them is a list
 * that leaks more than it shows. `bookingReference` is unique, so it is the
 * identifier a later detail route can be built on.
 *
 * Dates are calendar days in "YYYY-MM-DD" form and money is an exact decimal
 * string; neither is ever a `Date` or a `number`.
 */
export type AdminReservationListItem = {
  bookingReference: string;
  /** Composed server-side, so the UI never assembles a name. */
  guestName: string;
  guestEmail: string;
  roomType: {
    slug: string;
    name: string;
  };
  checkIn: string;
  checkOut: string;
  status: AdminReservationStatus;
  totalAmount: string;
  currency: 'EGP';
  /** ISO 8601 instant. */
  createdAt: string;
};

/** A validated window over the list. `total` is the full count, not the page's. */
export type AdminReservationListPagination = {
  limit: number;
  offset: number;
  total: number;
};

export type AdminReservationListResponse = {
  data: {
    reservations: AdminReservationListItem[];
    pagination: AdminReservationListPagination;
  };
};

/** A parsed, trustworthy pagination window. Only the validator produces one. */
export type AdminReservationListQuery = {
  limit: number;
  offset: number;
};

export const DEFAULT_RESERVATION_LIST_LIMIT = 25;
export const MIN_RESERVATION_LIST_LIMIT = 1;
export const MAX_RESERVATION_LIST_LIMIT = 100;
export const DEFAULT_RESERVATION_LIST_OFFSET = 0;

export const INVALID_PAGINATION_ERROR_CODE = 'INVALID_PAGINATION';

/**
 * The single public message for every rejection.
 *
 * Fixed rather than per-field so a controller mapping `code`/`message` straight
 * onto a 400 always produces the locked response body, and no internal detail
 * can drift into it later. With two integer parameters there is nothing a
 * caller could learn from a longer message that the parameter names do not
 * already tell them.
 */
export const INVALID_PAGINATION_ERROR_MESSAGE = 'Invalid pagination parameters';

/**
 * Raised when pagination input is not usable. Local to this module — not the
 * start of an application-wide error framework.
 */
export class InvalidPaginationError extends Error {
  readonly code = INVALID_PAGINATION_ERROR_CODE;

  constructor() {
    super(INVALID_PAGINATION_ERROR_MESSAGE);
    this.name = 'InvalidPaginationError';
  }
}

export function isInvalidPaginationError(error: unknown): error is InvalidPaginationError {
  return error instanceof InvalidPaginationError;
}
