import type { Request, Response } from 'express';
import {
  changeAdminPackageReservationStatus,
  getAdminPackageReservation,
  listAdminPackageReservations,
} from './admin-package-reservations.service';
import {
  INVALID_PACKAGE_RESERVATION_STATUS_TRANSITION_RESPONSE,
  PACKAGE_RESERVATION_NOT_FOUND_RESPONSE,
  isInvalidPackageBookingReferenceError,
  isInvalidPackageReservationStatusError,
  type AdminPackageReservationStatusTarget,
} from './admin-package-reservations.types';
import {
  parseAdminPackageReservationStatusUpdate,
  parsePackageBookingReferenceParam,
} from './admin-package-reservations.validation';

/**
 * Lists package reservations for a signed-in administrator, newest first.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * There is no try/catch. A database failure is a server problem and must stay
 * one — it must never be reported as a bad request, and never softened into
 * an empty list, which would read as "no bookings today" while bookings sat
 * in the table. Express 5 turns this rejected async handler into a 500.
 *
 * No query parameters are read yet, so there is nothing to validate and no
 * 400 this endpoint can produce. When filtering arrives it gets its own
 * validation and its own error code, following the room reservation list.
 *
 * Nothing is logged: the booking references and the guests' details are not
 * this handler's to write anywhere.
 */
export async function listAdminPackageReservationsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const { reservations } = await listAdminPackageReservations();

  // `reservations` is nested under `data` rather than being the whole of it,
  // so the pagination sibling this list will need can be added later without
  // changing the shape a caller already reads.
  res.status(200).json({ data: { reservations } });
}

/**
 * Returns one package reservation in full for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session and an unauthenticated request
 * never reaches this function — it cannot learn whether a reservation exists
 * or whether its reference is even well formed.
 *
 * Three outcomes are kept strictly apart. A reference that is not a package
 * booking reference is a malformed request (400). A well-formed reference
 * nobody booked is an answered question (404). Anything else that goes wrong
 * is the server's problem and stays a server error — softening a database
 * failure into "not found" would report a reservation as missing while it sat
 * right there in the table.
 *
 * Nothing is logged: the reference and the guest's details are not this
 * handler's to write anywhere.
 */
export async function getAdminPackageReservationHandler(
  req: Request<{ bookingReference: string }>,
  res: Response,
): Promise<void> {
  let bookingReference: string;

  try {
    bookingReference = parsePackageBookingReferenceParam(req.params.bookingReference);
  } catch (error) {
    if (isInvalidPackageBookingReferenceError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const reservation = await getAdminPackageReservation(bookingReference);

  if (!reservation) {
    res.status(404).json(PACKAGE_RESERVATION_NOT_FOUND_RESPONSE);
    return;
  }

  res.status(200).json({ data: reservation });
}

/**
 * Changes one package reservation's status.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session and an unauthenticated request
 * never reaches this function — it cannot learn whether a reservation exists,
 * whether its reference is well formed, or whether a transition would have
 * been allowed.
 *
 * Four outcomes are kept strictly apart. A reference or body that is not
 * valid input is a malformed request (400). A well-formed reference nobody
 * booked is an answered question (404). A move this reservation cannot make
 * is a conflict with its current state (409). Anything else is the server's
 * problem and stays a server error — a database failure reported as "not
 * found" would be a lie about a reservation sitting right there.
 *
 * Nothing is logged: the reference, the guest and the statuses involved are
 * not this handler's to write anywhere.
 */
export async function updateAdminPackageReservationStatusHandler(
  req: Request<{ bookingReference: string }>,
  res: Response,
): Promise<void> {
  let bookingReference: string;
  let nextStatus: AdminPackageReservationStatusTarget;

  try {
    // Order is deliberate and fixed. The reference says which reservation is
    // being changed, so a request that names nothing valid is refused before
    // its body matters: when both are malformed, the reference wins, and the
    // answer is the same every time.
    bookingReference = parsePackageBookingReferenceParam(req.params.bookingReference);
    nextStatus = parseAdminPackageReservationStatusUpdate(req.body);
  } catch (error) {
    if (isInvalidPackageBookingReferenceError(error) || isInvalidPackageReservationStatusError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await changeAdminPackageReservationStatus(bookingReference, nextStatus);

  if (result.outcome === 'not-found') {
    res.status(404).json(PACKAGE_RESERVATION_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'invalid-transition') {
    res.status(409).json(INVALID_PACKAGE_RESERVATION_STATUS_TRANSITION_RESPONSE);
    return;
  }

  res.status(200).json({ data: result.reservation });
}
