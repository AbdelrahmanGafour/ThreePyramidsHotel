import { Router } from 'express';
import { requireAdminSession } from '../admin-auth/admin-auth.middleware';
import {
  getAdminReservationHandler,
  listAdminReservationsHandler,
  updateAdminReservationStatusHandler,
} from './admin-reservations.controller';

export const adminReservationsRouter = Router();

// The guard sits in the route chain rather than inside the handler, so the
// protection is visible at the route itself and a future route added here
// cannot quietly be left unguarded.
//
// Reservations are created through the guest-facing endpoint; the only thing
// an administrator may change here is a booking's status.
adminReservationsRouter.get('/', requireAdminSession, listAdminReservationsHandler);
// The guard is repeated rather than hoisted to router.use(), so each route
// states its own protection and none can be read as inheriting it by accident.
adminReservationsRouter.get('/:bookingReference', requireAdminSession, getAdminReservationHandler);
// One route for every status change, naming the field it changes. Separate
// /confirm and /cancel endpoints would put the transition vocabulary in the URL
// and need a new route each time that vocabulary grows.
//
// The guard comes first here too, so authentication is settled before the
// reference, the body or the reservation's existence is ever considered.
adminReservationsRouter.patch(
  '/:bookingReference/status',
  requireAdminSession,
  updateAdminReservationStatusHandler,
);
