import type { Request, Response } from 'express';
import { getAvailability } from './availability.service';
import { isAvailabilityQueryError } from './availability.types';

export async function getAvailabilityHandler(req: Request, res: Response): Promise<void> {
  try {
    const availability = await getAvailability(req.query);

    res.status(200).json(availability);
  } catch (error) {
    // Only a bad query becomes a 400. Database failures and invalid stored
    // monetary data are server problems and must not be disguised as one.
    if (isAvailabilityQueryError(error)) {
      res.status(400).json({
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    // Express 5 turns this rejected async handler into a server error.
    throw error;
  }
}
