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

/**
 * One reservation in full, for an administrator looking at a single booking.
 *
 * Wider than the list item on purpose: a receptionist needs the guest's phone,
 * the party size, the special requests and which physical room was allocated.
 * That last one appears nowhere else in the API — it is exposed here, behind an
 * admin session, and nowhere a guest can reach.
 *
 * Still absent, deliberately: the database `id`, `roomId` and `roomTypeId`,
 * which are internal join keys with no meaning outside the database, and
 * `updatedAt`, which stays meaningless until something writes to it.
 *
 * Money is an exact decimal string and the stay dates are plain calendar days;
 * neither is ever a number or a Date.
 */
export type AdminReservationDetail = {
  bookingReference: string;
  status: AdminReservationStatus;
  guest: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    country: string;
  };
  stay: {
    /** "YYYY-MM-DD". */
    checkIn: string;
    /** "YYYY-MM-DD". Half-open: the guest leaves on this day. */
    checkOut: string;
    nights: number;
    adults: number;
    children: number;
  };
  roomType: {
    slug: string;
    name: string;
  };
  room: {
    number: string;
  };
  pricing: {
    /** The rate accepted at booking time, not the room type's rate today. */
    nightlyRate: string;
    totalAmount: string;
    currency: 'EGP';
  };
  specialRequests: string | null;
  /** ISO 8601 instant. */
  createdAt: string;
};

export type AdminReservationDetailResponse = {
  data: AdminReservationDetail;
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

export const INVALID_BOOKING_REFERENCE_ERROR_CODE = 'INVALID_BOOKING_REFERENCE';

/**
 * Fixed for the same reason the pagination message is: a controller mapping
 * `code`/`message` straight onto a 400 always produces the locked response
 * body, and nothing about the expected format can leak into it later.
 */
export const INVALID_BOOKING_REFERENCE_ERROR_MESSAGE = 'Invalid booking reference';

/**
 * The route parameter is not a booking reference. Distinct from a reference
 * that is well formed but unknown, which is a 404: one is a malformed request,
 * the other a question with the answer "no".
 */
export class InvalidBookingReferenceError extends Error {
  readonly code = INVALID_BOOKING_REFERENCE_ERROR_CODE;

  constructor() {
    super(INVALID_BOOKING_REFERENCE_ERROR_MESSAGE);
    this.name = 'InvalidBookingReferenceError';
  }
}

export function isInvalidBookingReferenceError(error: unknown): error is InvalidBookingReferenceError {
  return error instanceof InvalidBookingReferenceError;
}

export const RESERVATION_NOT_FOUND_ERROR_CODE = 'RESERVATION_NOT_FOUND';
export const RESERVATION_NOT_FOUND_ERROR_MESSAGE = 'Reservation not found';

/**
 * The one 404 body this module sends.
 *
 * Frozen and built once so a handler can only send the locked contract, never
 * a hand-assembled near-copy. The requested reference is deliberately absent:
 * echoing a caller's input back into an error body is how reflected content
 * gets into places it was never meant to reach, and it tells them nothing they
 * did not already know.
 */
export const RESERVATION_NOT_FOUND_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: RESERVATION_NOT_FOUND_ERROR_CODE,
    message: RESERVATION_NOT_FOUND_ERROR_MESSAGE,
  }),
});
