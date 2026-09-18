import { dbPool } from '../../db/pool';
import type { RoomTypeAvailability } from './availability.types';

type RoomTypeAvailabilityRow = {
  slug: string;
  name: string;
  capacity: number;
  base_nightly_rate: string;
  available_room_count: number;
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
 * The count is produced entirely in PostgreSQL — reservation rows are never
 * pulled into JavaScript. Overlap uses the same half-open `[)` range semantics
 * as the `reservations_no_overlapping_active_stays` exclusion constraint, so
 * availability and the database's own double-booking guard agree, and same-day
 * turnover stays allowed.
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
            -- ::int so pg returns a JavaScript number rather than a numeric string.
            COUNT(r.id)::int AS available_room_count
       FROM room_types rt
       -- LEFT JOIN keeps qualifying room types with no free room: they group to a count of 0.
       LEFT JOIN rooms r
         ON r.room_type_id = rt.id
        AND r.is_active = true
        AND NOT EXISTS (
              SELECT 1
                FROM reservations res
               WHERE res.room_id = r.id
                 AND res.status IN ('pending', 'confirmed')
                 AND daterange(res.check_in, res.check_out, '[)')
                     && daterange($1::date, $2::date, '[)')
            )
      WHERE rt.is_active = true
        -- ::bigint avoids int4 range inference on large (but JS-safe) guest counts.
        AND rt.capacity >= $3::bigint
      GROUP BY rt.id
      ORDER BY rt.sort_order ASC, rt.name ASC`,
    [checkIn, checkOut, totalGuests],
  );

  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    capacity: row.capacity,
    baseNightlyRate: row.base_nightly_rate,
    availableRoomCount: row.available_room_count,
  }));
}
