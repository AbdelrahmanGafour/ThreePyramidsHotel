import type { Request, Response } from 'express';
import { createPackageReservation } from './package-reservations.service';
import { PackageReservationError } from './package-reservations.types';

export async function createPackageReservationHandler(req: Request, res: Response): Promise<void> {
  try {
    res.status(201).json({ data: await createPackageReservation(req.body) });
  } catch (error) {
    if (error instanceof PackageReservationError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    // Same sanitized public error shape as the catalogue; no raw DB details,
    // constraint names, guest data or internal IDs reach the response.
    res.status(500).json({ error: {
      code: 'PACKAGE_RESERVATION_FAILED', message: 'Package reservation could not be created',
    } });
  }
}
