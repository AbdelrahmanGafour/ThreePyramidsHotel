import { findAdminReservationPage, type AdminReservationListPage } from './admin-reservations.repository';
import type { AdminReservationListQuery } from './admin-reservations.types';

/**
 * Reads one page of reservations for the administration list.
 *
 * Thin by design, and deliberately still here: it is the seam where later
 * reservation rules belong — status filtering, an operational "arriving today"
 * view — so neither the controller nor the repository has to grow HTTP or SQL
 * concerns to accommodate them.
 *
 * Knows nothing about Express: it takes a window the validator already
 * approved, and returns domain data with no response envelope around it.
 * Authentication happens in the route chain, never here.
 */
export async function listAdminReservations(
  query: AdminReservationListQuery,
): Promise<AdminReservationListPage> {
  return findAdminReservationPage(query);
}
