import { dbPool } from '../../db/pool';
import type { RoomTypeAvailability } from './availability.types';

type RoomTypeAvailabilityRow = {
  slug: string;
  name: string;
  capacity: number;
  base_nightly_rate: string;
  available_room_count: string | number;
};

type FindRoomTypeAvailabilityInput = {
  checkIn: string;
  checkOut: string;
  totalGuests: number;
};

/**
 * Counts, per qualifying room type, the active physical rooms that are free for
 * the whole requested stay.
 *
 * The count is produced entirely in MySQL — reservation rows are never
 * pulled into JavaScript. Overlap uses half-open `[)` semantics
 * (`check_in < out AND check_out > in`), the same rule the booking path
 * enforces, so same-day turnover stays allowed.
 */
export async function findRoomTypeAvailability({
  checkIn,
  checkOut,
  totalGuests,
}: FindRoomTypeAvailabilityInput): Promise<RoomTypeAvailability[]> {
  const { rows } = await dbPool.query<RoomTypeAvailabilityRow>(
    `SELECT rt.slug,
            rt.name,
            rt.capacity,
            rt.base_nightly_rate,
            COUNT(r.id) AS available_room_count
       FROM room_types rt
       LEFT JOIN rooms r
         ON r.room_type_id = rt.id
        AND r.is_active = true
        AND NOT EXISTS (
              SELECT 1
                FROM reservations res
               WHERE res.room_id = r.id
                 AND res.status IN ('pending', 'confirmed')
                 AND res.check_in < $2
                 AND res.check_out > $1
            )
      WHERE rt.is_active = true
        AND rt.capacity >= $3
      GROUP BY rt.id
      ORDER BY rt.sort_order ASC, rt.name ASC`,
    [checkIn, checkOut, totalGuests],
  );

  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    capacity: row.capacity,
    baseNightlyRate: row.base_nightly_rate,
    availableRoomCount: Number(row.available_room_count),
  }));
}
