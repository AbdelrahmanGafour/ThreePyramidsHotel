/**
 * Normalized reservation request. Everything here comes from the guest; the
 * server owns room allocation, booking reference, pricing, currency and status,
 * so none of those appear in this shape.
 *
 * Stay semantics are half-open [checkIn, checkOut), so `nights` is the
 * calendar-day difference between the two dates.
 */
export type ReservationInput = {
  roomTypeSlug: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  nights: number;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
  guestCountry: string;
  specialRequests: string | null;
};

/**
 * The room type fields reservation creation needs: capacity to validate the
 * party and the rate to snapshot. PostgreSQL bigint and numeric values stay
 * strings so no precision is lost.
 */
export type ReservationRoomType = {
  id: string;
  slug: string;
  name: string;
  capacity: number;
  baseNightlyRate: string;
};

/** Everything the reservation INSERT needs. `status` and `currency` are not here: the repository writes those itself. */
export type InsertReservationInput = {
  bookingReference: string;
  roomTypeId: string;
  roomId: string;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
  guestCountry: string;
  adults: number;
  children: number;
  checkIn: string;
  checkOut: string;
  nightlyRateSnapshot: string;
  totalAmount: string;
  specialRequests: string | null;
};

/**
 * Guest-safe result of creating a reservation. The physical room, the guest
 * contact details and the database id are deliberately absent.
 */
export type CreatedReservation = {
  bookingReference: string;
  status: 'pending';
  roomType: {
    slug: string;
    name: string;
  };
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  nightlyRate: string;
  totalAmount: string;
  currency: 'EGP';
};

export const RESERVATION_VALIDATION_ERROR_CODE = 'INVALID_RESERVATION';

/**
 * Raised when a reservation request is not usable. Local to this module — not
 * the start of an application-wide error framework. A controller can map
 * `code`/`message` straight onto a 400 response.
 */
export class ReservationValidationError extends Error {
  readonly code = RESERVATION_VALIDATION_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'ReservationValidationError';
  }
}

export function isReservationValidationError(error: unknown): error is ReservationValidationError {
  return error instanceof ReservationValidationError;
}

export const ROOM_TYPE_NOT_FOUND_ERROR_CODE = 'ROOM_TYPE_NOT_FOUND';

/** The requested room type slug does not exist, or is not active. */
export class RoomTypeNotFoundError extends Error {
  readonly code = ROOM_TYPE_NOT_FOUND_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'RoomTypeNotFoundError';
  }
}

export function isRoomTypeNotFoundError(error: unknown): error is RoomTypeNotFoundError {
  return error instanceof RoomTypeNotFoundError;
}

export const NO_AVAILABILITY_ERROR_CODE = 'NO_AVAILABILITY';

/**
 * No physical room of the requested type is free for the requested stay. Also
 * raised when the database's exclusion constraint rejects the allocation.
 */
export class NoAvailabilityError extends Error {
  readonly code = NO_AVAILABILITY_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'NoAvailabilityError';
  }
}

export function isNoAvailabilityError(error: unknown): error is NoAvailabilityError {
  return error instanceof NoAvailabilityError;
}
