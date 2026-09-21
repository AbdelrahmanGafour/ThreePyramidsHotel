import {
  findAdminRoomTypeBySlug,
  listAdminRoomTypes,
  updateAdminRoomType,
} from './admin-room-types.repository';
import type {
  AdminRoomTypeDetail,
  AdminRoomTypeListItem,
  AdminRoomTypeUpdate,
} from './admin-room-types.types';

/**
 * Room-type reads and edits for an administrator.
 *
 * Thin by design. The slug arrives already validated and is used exactly as
 * given; the update body arrives already validated and is passed through
 * unchanged. Re-checking either here would be a second opinion able to
 * disagree with the first.
 *
 * Nothing in this layer touches capacity, `isActive`, physical rooms or
 * reservations, and no price is calculated: the only pricing decision this
 * feature makes is what a room type costs from now on, which is a stored
 * value, not a computation.
 */

/** Every room type, active and inactive, in the catalogue's own order. */
export async function getAdminRoomTypes(): Promise<AdminRoomTypeListItem[]> {
  return listAdminRoomTypes();
}

/**
 * Reads one room type by slug.
 *
 * Returns null only when no room type has that slug — the same single meaning
 * `getAdminReservation` gives it. A stored row that cannot be trusted raises
 * from the repository instead, so a data fault never reaches a caller
 * disguised as a missing room type.
 */
export async function getAdminRoomType(slug: string): Promise<AdminRoomTypeDetail | null> {
  return findAdminRoomTypeBySlug(slug);
}

/**
 * Applies a partial update and returns the room type as it now stands.
 *
 * The returned detail is the row after the write, read in the same statement
 * that performed it.
 *
 * Returns null only when no room type has that slug.
 */
export async function changeAdminRoomType(
  slug: string,
  update: AdminRoomTypeUpdate,
): Promise<AdminRoomTypeDetail | null> {
  return updateAdminRoomType(slug, update);
}
