import { Router } from 'express';
import { requireAdminSession } from '../admin-auth/admin-auth.middleware';
import { listAdminReservationsHandler } from './admin-reservations.controller';

export const adminReservationsRouter = Router();

// The guard sits in the route chain rather than inside the handler, so the
// protection is visible at the route itself and a future route added here
// cannot quietly be left unguarded.
//
// Read-only: reservations are created through the guest-facing endpoint, and
// changing one is a later ticket.
adminReservationsRouter.get('/', requireAdminSession, listAdminReservationsHandler);
