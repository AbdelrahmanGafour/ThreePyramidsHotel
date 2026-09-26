import { isPackageBookingReference } from '../package-reservations/booking-reference';
import {
  InvalidPackageBookingReferenceError,
  InvalidPackageReservationStatusError,
  type AdminPackageReservationStatusTarget,
} from './admin-package-reservations.types';

/**
 * Validates the booking reference in the URL.
 *
 * Reuses `isPackageBookingReference` — the same predicate the public
 * reservation path already uses — rather than restating the format. There is
 * deliberately no second, looser parser here: a reference is the exact string
 * the system issued or it is not one, and accepting a lowercased or trimmed
 * variant would mean looking up a value the caller never sent.
 *
 * Nothing is normalised. The validated value is returned as given.
 */
export function parsePackageBookingReferenceParam(value: unknown): string {
  if (typeof value !== 'string' || !isPackageBookingReference(value)) {
    throw new InvalidPackageBookingReferenceError();
  }

  return value;
}

/** The only statuses a request may ask for; `pending` is deliberately absent. */
const STATUS_TARGETS: readonly AdminPackageReservationStatusTarget[] = ['confirmed', 'cancelled'];

/**
 * Validates the body of a status change request.
 *
 * Exact: `"confirmed"` and `"cancelled"` and nothing else. No trimming, no
 * case folding — `" confirmed "` and `"CONFIRMED"` are mistakes to report,
 * not input to tidy up, and a caller that meant one of them should be told
 * rather than guessed at. `"pending"` is refused here too, before any
 * reservation is loaded: it is not a place a booking can be sent.
 *
 * Other keys in the body are ignored; only `status` is read. A body that is
 * not an object at all — null, an array, a string — is refused outright.
 *
 * Returns the narrow target type, so a caller cannot use the raw body in
 * place of the validated value.
 */
export function parseAdminPackageReservationStatusUpdate(
  body: unknown,
): AdminPackageReservationStatusTarget {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidPackageReservationStatusError();
  }

  const status = (body as { status?: unknown }).status;
  const target = STATUS_TARGETS.find((candidate) => candidate === status);

  if (!target) {
    throw new InvalidPackageReservationStatusError();
  }

  return target;
}
