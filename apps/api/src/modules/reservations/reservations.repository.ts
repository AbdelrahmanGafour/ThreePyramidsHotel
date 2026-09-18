import type { PoolClient } from 'pg';
import type { InsertReservationInput, ReservationRoomType } from './reservations.types';

type ReservationRoomTypeRow = {
  id: string;
  slug: string;
  name: string;
  capacity: number;
  base_nightly_rate: string;
};

type RoomIdRow = {
  id: string;
};

type FindAndLockAvailableRoomInput = {
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
};

/**
 * Both helpers take the caller's `PoolClient` so they run inside the caller's
 * transaction — the row lock taken below is only meaningful while that
 * transaction is open. Neither helper begins, commits or rolls back anything.
 */
export async function findActiveRoomTypeBySlug(
  client: PoolClient,
  slug: string,
): Promise<ReservationRoomType | null> {
  const { rows } = await client.query<ReservationRoomTypeRow>(
    `SELECT id,
            slug,
            name,
            capacity,
            base_nightly_rate
       FROM room_types
      WHERE slug = $1
        AND is_active = true`,
    [slug],
  );

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    capacity: row.capacity,
    baseNightlyRate: row.base_nightly_rate,
  };
}

/**
 * Picks one active physical room of this type with no overlapping pending or
 * confirmed reservation, and locks that row for the caller's transaction.
 *
 * `SKIP LOCKED` makes concurrent requests step over rooms another transaction
 * is already holding and take the next free one instead of blocking or racing
 * for the same room. The lock is a concurrency strategy, not a correctness
 * guarantee: `reservations_no_overlapping_active_stays` remains the final
 * protection against overlapping active reservations.
 *
 * Returns only the room id — room numbers stay internal.
 */
export async function findAndLockAvailableRoom(
  client: PoolClient,
  { roomTypeId, checkIn, checkOut }: FindAndLockAvailableRoomInput,
): Promise<{ id: string } | null> {
  const { rows } = await client.query<RoomIdRow>(
    `SELECT r.id
       FROM rooms r
      WHERE r.room_type_id = $1
        AND r.is_active = true
        AND NOT EXISTS (
              SELECT 1
                FROM reservations res
               WHERE res.room_id = r.id
                 AND res.status IN ('pending', 'confirmed')
                 AND daterange(res.check_in, res.check_out, '[)')
                     && daterange($2::date, $3::date, '[)')
            )
      ORDER BY r.room_number ASC, r.id ASC
      LIMIT 1
      FOR UPDATE OF r SKIP LOCKED`,
    [roomTypeId, checkIn, checkOut],
  );

  const row = rows[0];

  return row ? { id: row.id } : null;
}

/**
 * Inserts the pending reservation. `status` and `currency` are written as
 * server-owned literals — never taken from the caller.
 *
 * The conflict target is `booking_reference` specifically, so only a duplicate
 * reference returns no row (leaving the transaction usable for a retry). Any
 * other violation, including the exclusion constraint, still raises.
 */
export async function insertReservation(
  client: PoolClient,
  input: InsertReservationInput,
): Promise<{ id: string } | null> {
  const { rows } = await client.query<RoomIdRow>(
    `INSERT INTO reservations (
       booking_reference,
       room_type_id,
       room_id,
       guest_first_name,
       guest_last_name,
       guest_email,
       guest_phone,
       guest_country,
       adults,
       children,
       check_in,
       check_out,
       status,
       currency,
       nightly_rate_snapshot,
       total_amount,
       special_requests
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::date,
             'pending', 'EGP', $13, $14, $15)
     ON CONFLICT (booking_reference) DO NOTHING
     RETURNING id`,
    [
      input.bookingReference,
      input.roomTypeId,
      input.roomId,
      input.guestFirstName,
      input.guestLastName,
      input.guestEmail,
      input.guestPhone,
      input.guestCountry,
      input.adults,
      input.children,
      input.checkIn,
      input.checkOut,
      input.nightlyRateSnapshot,
      input.totalAmount,
      input.specialRequests,
    ],
  );

  const row = rows[0];

  return row ? { id: row.id } : null;
}
