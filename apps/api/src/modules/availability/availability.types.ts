/**
 * Normalized availability request. Dates are validated calendar days in
 * "YYYY-MM-DD" form and the stay is half-open [checkIn, checkOut), so `nights`
 * is the calendar-day difference between the two.
 */
export type AvailabilityInput = {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  nights: number;
};

/**
 * One qualifying room type with its live availability for a requested stay.
 * `availableRoomCount` is calculated in MySQL per request and never
 * stored; it can legitimately be 0. Physical rooms stay internal — only the
 * count of them is exposed.
 */
export type RoomTypeAvailability = {
  slug: string;
  name: string;
  capacity: number;
  /** MySQL numeric, kept as a string so no precision is lost. */
  baseNightlyRate: string;
  availableRoomCount: number;
};

/** One room type as returned by the availability API, including sold-out ones. */
export type RoomTypeAvailabilityResponse = {
  slug: string;
  name: string;
  capacity: number;
  /** MySQL numeric strings — exact two-decimal money, never floats. */
  baseNightlyRate: string;
  totalAmount: string;
  currency: 'EGP';
  availableRoomCount: number;
};

export type AvailabilityResponse = {
  data: {
    checkIn: string;
    checkOut: string;
    nights: number;
    adults: number;
    children: number;
    roomTypes: RoomTypeAvailabilityResponse[];
  };
};

export const AVAILABILITY_QUERY_ERROR_CODE = 'INVALID_AVAILABILITY_QUERY';

/**
 * Raised when an availability query is not usable. Deliberately local to this
 * module — not the start of an application-wide error framework. A controller
 * can catch it and map `code`/`message` straight onto a 400 response.
 */
export class AvailabilityQueryError extends Error {
  readonly code = AVAILABILITY_QUERY_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'AvailabilityQueryError';
  }
}

export function isAvailabilityQueryError(error: unknown): error is AvailabilityQueryError {
  return error instanceof AvailabilityQueryError;
}
