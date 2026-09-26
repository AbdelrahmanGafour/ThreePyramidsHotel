import {
  findAdminPackageReservationByReference,
  findAdminPackageReservations,
  updateAdminPackageReservationStatus,
  type AdminPackageReservationStatusChange,
} from './admin-package-reservations.repository';
import type {
  AdminPackageReservationDetail,
  AdminPackageReservationList,
  AdminPackageReservationStatusTarget,
} from './admin-package-reservations.types';

/**
 * Reads every package reservation for the administration list, newest first.
 *
 * Thin by design, and deliberately still here: it is the seam where the rules
 * this list will grow belong — status and pricing-status filtering, a
 * "departing today" view, a pagination window — so neither the controller nor
 * the repository has to take on HTTP or SQL concerns to accommodate them.
 *
 * Knows nothing about Express, and returns domain data with no response
 * envelope around it. Authentication happens in the route chain, never here.
 *
 * Read-only: nothing in this module writes, so the public reservation POST
 * path and its commit-uncertainty handling are untouched by it.
 */
export async function listAdminPackageReservations(): Promise<AdminPackageReservationList> {
  return findAdminPackageReservations();
}

/**
 * Reads one package reservation by its booking reference.
 *
 * Thin on purpose, and read-only. The reference arrives already validated and
 * is used exactly as given: normalising it here would mean looking up a value
 * the caller never sent.
 *
 * Returns null only when no reservation has that reference. A stored row that
 * cannot be trusted raises from the repository instead, so a data fault never
 * reaches a caller disguised as a missing booking.
 */
export async function getAdminPackageReservation(
  bookingReference: string,
): Promise<AdminPackageReservationDetail | null> {
  return findAdminPackageReservationByReference(bookingReference);
}

/**
 * Changes one reservation's status, refusing any move the rule disallows.
 *
 * Three things that can happen, as values rather than a mixture of values and
 * thrown errors: a discriminated union means a caller that forgets one fails
 * to compile rather than failing in production. A genuine fault — a lost
 * connection, a row the schema says cannot exist — is none of these three and
 * still throws.
 *
 * Thin on purpose. The rule lives in `admin-package-reservations.status.ts`
 * and is enforced by the conditional UPDATE itself, so there is deliberately
 * no check here that could hold a different opinion from the write.
 */
export async function changeAdminPackageReservationStatus(
  bookingReference: string,
  nextStatus: AdminPackageReservationStatusTarget,
): Promise<AdminPackageReservationStatusChange> {
  return updateAdminPackageReservationStatus(bookingReference, nextStatus);
}
