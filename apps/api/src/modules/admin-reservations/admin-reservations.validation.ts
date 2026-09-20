import { isBookingReference } from '../reservations/booking-reference';
import {
  DEFAULT_RESERVATION_LIST_LIMIT,
  DEFAULT_RESERVATION_LIST_OFFSET,
  InvalidBookingReferenceError,
  InvalidPaginationError,
  MAX_RESERVATION_LIST_LIMIT,
  MIN_RESERVATION_LIST_LIMIT,
  type AdminReservationListQuery,
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
