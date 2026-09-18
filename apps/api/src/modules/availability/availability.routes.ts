import { Router } from 'express';
import { getAvailabilityHandler } from './availability.controller';

export const availabilityRouter = Router();

availabilityRouter.get('/', getAvailabilityHandler);
