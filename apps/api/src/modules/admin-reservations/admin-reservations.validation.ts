import { isBookingReference } from '../reservations/booking-reference';
import {
  DEFAULT_RESERVATION_LIST_LIMIT,
  DEFAULT_RESERVATION_LIST_OFFSET,
  InvalidBookingReferenceError,
  InvalidPaginationError,
  InvalidReservationStatusError,
  MAX_RESERVATION_LIST_LIMIT,
  MIN_RESERVATION_LIST_LIMIT,
  type AdminReservationListQuery,
  type AdminReservationStatusTarget,
} from './admin-reservations.types';

// Digits only. This rejects "25abc", "2.5", "-1", "1e3", "+5", " 5", "" and
// "0x10" before any conversion happens — the whole string must be the number,
// so none of the permissive coercion in parseInt() or Number() can apply.
// Leading zeros ("025") are accepted: that string does completely represent 25.
const WHOLE_NUMBER_PATTERN = /^\d+$/;

/**
 * What Express hands over: `req.query` values are strings, arrays when a
 * parameter repeats, and `undefined` when absent.
 */
type AdminReservationListQueryInput = {
  limit?: unknown;
  offset?: unknown;
};

/**
 * Reads one supplied pagination value.
 *
 * Only `undefined` counts as "not supplied" — anything actually present must be
 * a well-formed whole number, so `?limit=` and `?limit=%20` are mistakes to
 * report rather than requests to fall back to a default. A repeated parameter
 * arrives as an array and is refused outright: guessing which of two conflicting
 * values the caller meant is worse than saying no.
 */
function parseSuppliedWholeNumber(value: unknown): number {
  if (typeof value !== 'string') {
    // Covers arrays (`?limit=1&limit=2`), null, numbers and objects alike.
    throw new InvalidPaginationError();
  }

  if (!WHOLE_NUMBER_PATTERN.test(value)) {
    throw new InvalidPaginationError();
  }

  const parsed = Number(value);

  // A long run of digits can pass the pattern and still land beyond exact
  // integer arithmetic, where the parsed value is not the number that was sent.
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidPaginationError();
  }

  return parsed;
}

/**
 * Validates the admin reservation list's pagination window.
 *
 * Framework-independent: plain values in, a plain window out, and
 * `InvalidPaginationError` on anything unusable. An out-of-range value is
 * rejected rather than clamped — a caller asking for 500 rows has misunderstood
 * the contract, and silently handing back 100 hides that from them.
 *
 * Omitting both parameters is the normal first request, so absent values take
 * the documented defaults.
 */
export function parseAdminReservationListQuery(
  query: AdminReservationListQueryInput,
): AdminReservationListQuery {
  const limit =
    query.limit === undefined
      ? DEFAULT_RESERVATION_LIST_LIMIT
      : parseSuppliedWholeNumber(query.limit);

  if (limit < MIN_RESERVATION_LIST_LIMIT || limit > MAX_RESERVATION_LIST_LIMIT) {
    throw new InvalidPaginationError();
  }

  // The digits-only pattern already excludes negatives, so offset needs no
  // lower-bound check of its own; it has no upper bound beyond safe integers.
  const offset =
    query.offset === undefined
      ? DEFAULT_RESERVATION_LIST_OFFSET
      : parseSuppliedWholeNumber(query.offset);

  return { limit, offset };
}

/**
 * Validates the `:bookingReference` route parameter.
 *
 * The canonical reservation-domain rule decides what a reference looks like;
 * this only turns a rejection into the admin module's own error. Nothing is
 * trimmed and nothing is upper-cased: the lookup that follows is an exact
 * match, so a value that needs tidying is not the value the database holds.
 *
 * Returns the reference unchanged, so a caller cannot accidentally use the raw
 * parameter in place of the validated one.
 */
export function parseBookingReferenceParam(value: unknown): string {
  if (typeof value !== 'string' || !isBookingReference(value)) {
    throw new InvalidBookingReferenceError();
  }

  return value;
}

/** The only statuses a request may ask for; `pending` is deliberately absent. */
const STATUS_TARGETS: readonly AdminReservationStatusTarget[] = ['confirmed', 'cancelled'];

/**
 * Validates the body of a status change request.
 *
 * Exact: `"confirmed"` and `"cancelled"` and nothing else. No trimming, no case
 * folding — `" confirmed "` and `"CONFIRMED"` are mistakes to report, not input
 * to tidy up, and a caller that meant one of them should be told rather than
 * guessed at. `"pending"` is refused here too, before any reservation is even
 * loaded: it is not a place a booking can be sent.
 *
 * Other keys in the body are ignored; only `status` is read.
 *
 * Returns the narrow target type, so a caller cannot use the raw body in place
 * of the validated value.
 */
export function parseAdminReservationStatusUpdate(body: unknown): AdminReservationStatusTarget {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidReservationStatusError();
  }

  // Only a plain object (or a null-prototype one, as JSON.parse with a reviver
  // can produce). A Date, Map or class instance is an object whose fields would
  // not survive a JSON round-trip.
  const prototype = Object.getPrototypeOf(body);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidReservationStatusError();
  }

  const { status } = body as Record<string, unknown>;

  // find(), not includes(): it returns the matched literal, so the union is
  // reached by narrowing rather than by an unchecked assertion.
  const target = STATUS_TARGETS.find((candidate) => candidate === status);

  if (!target) {
    throw new InvalidReservationStatusError();
  }

  return target;
}
