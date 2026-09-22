import { Router } from 'express';
import { createPackageReservationHandler } from './package-reservations.controller';

export const packageReservationsRouter = Router();
packageReservationsRouter.post('/', createPackageReservationHandler);
