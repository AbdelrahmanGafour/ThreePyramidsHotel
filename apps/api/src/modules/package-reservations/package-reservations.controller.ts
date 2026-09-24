import type { Request, Response } from 'express';
import { createPackageReservation } from './package-reservations.service';
import {
  PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_RESPONSE,
  PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_STATUS,
  PackageReservationError,
  isPackageReservationOutcomeUncertain,
} from './package-reservations.types';

export async function createPackageReservationHandler(req: Request, res: Response): Promise<void> {
  try {
    res.status(201).json({ data: await createPackageReservation(req.body) });
  } catch (error) {
    if (error instanceof PackageReservationError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    // COMMIT was attempted and did not answer. This is neither a success nor
    // a failure, and it must not be reported as one: the fixed body below
    // claims nothing about whether the reservation exists, and the driver
    // error that caused it never leaves this process.
    if (isPackageReservationOutcomeUncertain(error)) {
      res
        .status(PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_STATUS)
        .json(PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_RESPONSE);
      return;
    }
    // Same sanitized public error shape as the catalogue; no raw DB details,
    // constraint names, guest data or internal IDs reach the response.
    res.status(500).json({ error: {
      code: 'PACKAGE_RESERVATION_FAILED', message: 'Package reservation could not be created',
    } });
  }
}
