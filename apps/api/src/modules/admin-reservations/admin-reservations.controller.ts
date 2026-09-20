import type { Request, Response } from 'express';
import { getAdminReservation, listAdminReservations } from './admin-reservations.service';
import {
  RESERVATION_NOT_FOUND_RESPONSE,
  isInvalidBookingReferenceError,
  isInvalidPaginationError,
  type AdminReservationListQuery,
} from './admin-reservations.types';
import {
  parseAdminReservationListQuery,
  parseBookingReferenceParam,
} from './admin-reservations.validation';

/**
 * Lists reservations for a signed-in administrator, newest first.
 *
 * The caller is already authenticated: `requireAdminSession` guards this route,
 * so nothing here re-checks a session.
 *
 * The pagination window echoed back is the validated one, not the raw query, so
 * a client always sees exactly which window produced these rows.
 */
export async function listAdminReservationsHandler(req: Request, res: Response): Promise<void> {
  let query: AdminReservationListQuery;

  try {
    query = parseAdminReservationListQuery(req.query);
  } catch (error) {
    if (isInvalidPaginationError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: a database failure is a server
  // problem, and must never be reported as a bad request or softened into an
  // empty list. Express 5 turns this rejected async handler into a 500.
  const { reservations, total } = await listAdminReservations(query);

  res.status(200).json({
    data: {
      reservations,
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total,
      },
    },
  });
}

/**
 * Returns one reservation in full for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this route,
 * so nothing here re-checks a session.
 *
 * Three outcomes are kept strictly apart. A reference that is not a booking
 * reference is a malformed request (400). A well-formed reference nobody booked
 * is an answered question (404). Anything else that goes wrong is the server's
 * problem and must stay a server error — softening a database failure into
 * "not found" would report a reservation as missing when it is sitting there.
 *
 * Nothing is logged: the reference and the guest's details are not this
 * handler's to write anywhere.
 */
export async function getAdminReservationHandler(
  req: Request<{ bookingReference: string }>,
  res: Response,
): Promise<void> {
  let bookingReference: string;

  try {
    bookingReference = parseBookingReferenceParam(req.params.bookingReference);
  } catch (error) {
    if (isInvalidBookingReferenceError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const reservation = await getAdminReservation(bookingReference);

  if (!reservation) {
    res.status(404).json(RESERVATION_NOT_FOUND_RESPONSE);
    return;
  }

  res.status(200).json({ data: reservation });
}
