import { Router } from 'express';
import { createReservationHandler } from './reservations.controller';

export const reservationsRouter = Router();

reservationsRouter.post('/', createReservationHandler);
