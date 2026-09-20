import type { Request, Response } from 'express';
import { listAdminReservations } from './admin-reservations.service';
import { isInvalidPaginationError, type AdminReservationListQuery } from './admin-reservations.types';
import { parseAdminReservationListQuery } from './admin-reservations.validation';

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
