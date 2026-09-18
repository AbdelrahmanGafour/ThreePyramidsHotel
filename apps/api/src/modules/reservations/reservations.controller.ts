import type { Request, Response } from 'express';
import { createReservation } from './reservations.service';
import {
  isNoAvailabilityError,
  isReservationValidationError,
  isRoomTypeNotFoundError,
} from './reservations.types';

export async function createReservationHandler(req: Request, res: Response): Promise<void> {
  try {
    // The service returns guest-safe data only: no room id, room number,
    // database id or echoed guest contact details.
    const reservation = await createReservation(req.body);

    res.status(201).json({ data: reservation });
  } catch (error) {
    if (isReservationValidationError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    if (isRoomTypeNotFoundError(error)) {
      res.status(404).json({ error: { code: error.code, message: error.message } });
      return;
    }

    // The stay itself is the conflict — the room type exists and the request is
    // valid, but no room is free for those dates.
    if (isNoAvailabilityError(error)) {
      res.status(409).json({ error: { code: error.code, message: error.message } });
      return;
    }

    // Express 5 turns this rejected async handler into a server error.
    throw error;
  }
}
