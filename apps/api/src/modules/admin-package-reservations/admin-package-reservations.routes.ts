import { Router } from 'express';
import { requireAdminSession } from '../admin-auth/admin-auth.middleware';
import {
  getAdminPackageReservationHandler,
  listAdminPackageReservationsHandler,
  updateAdminPackageReservationStatusHandler,
} from './admin-package-reservations.controller';

export const adminPackageReservationsRouter = Router();

// The guard sits in the route chain rather than inside the handler, so the
// protection is visible at the route itself and a future route added here
// cannot quietly be left unguarded. It is written per route rather than
// hoisted to router.use(), so every route states its own protection and none
// can be read as inheriting it by accident.
//
// Package reservations are created through the guest-facing endpoint, which
// this module does not touch. The only thing an administrator may change here
// is a reservation's status.
//
// Registration order is most-specific first. Express matches on segment
// count, so `/:bookingReference` cannot swallow `/:bookingReference/status` —
// the two-segment path is simply a different shape. The order is therefore
// for a reader rather than for the matcher, and is stated so it stays that
// way: a later optional-segment pattern would make it load-bearing.
adminPackageReservationsRouter.get('/', requireAdminSession, listAdminPackageReservationsHandler);

// One route for every status change, naming the field it changes. Separate
// /confirm and /cancel endpoints would put the transition vocabulary in the
// URL and need a new route each time that vocabulary grows.
adminPackageReservationsRouter.patch(
  '/:bookingReference/status',
  requireAdminSession,
  updateAdminPackageReservationStatusHandler,
);
adminPackageReservationsRouter.get(
  '/:bookingReference',
  requireAdminSession,
  getAdminPackageReservationHandler,
);
