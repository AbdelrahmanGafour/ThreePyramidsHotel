import type { PoolClient } from '../../db/pool';
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
 * transaction — the row locks they take are only meaningful while that
 * transaction is open. Neither helper begins, commits or rolls back anything.
 */

/**
 * Finds the active room type a booking is for, and holds it.
 *
 * `FOR KEY SHARE` is the first lock of the canonical order:
 *
 *     room_types row  ->  rooms row
 *
 * It is the weakest row lock PostgreSQL offers, and it is chosen for exactly
 * what it does and does not conflict with:
 *
 *   FOR UPDATE          conflicts. This is how an administrator takes the row
 *                       before changing capacity, so a booking and a capacity
 *                       change can never overlap.
 *   FOR KEY SHARE       compatible. Any number of bookings hold it at once,
 *                       each going on to lock a *different* physical room.
 *   FOR NO KEY UPDATE   compatible. An ordinary UPDATE that leaves `id` and
 *                       `slug` alone takes this — which is every field of the
 *                       T01 partial update. Editing a description or a rate
 *                       therefore does not queue behind in-flight bookings.
 *
 * That last line is why this is not `FOR SHARE`. `FOR SHARE` would conflict
 * with `FOR NO KEY UPDATE` and make every descriptive edit wait for bookings,
 * buying nothing: the serialisation that matters comes from the administrator's
 * explicit `FOR UPDATE`, which `FOR KEY SHARE` already blocks on.
 *
 * Without any lock here, an admin transaction could lower capacity and commit
 * in the window between this read and the reservation INSERT, leaving a booking
 * validated against a capacity the hotel no longer offers — the exact party
 * size the admin operation exists to refuse. Instead the two wait for each
 * other:
 *
 *   - a capacity change waits for every in-flight booking on this room type;
 *   - a booking waits for an in-flight capacity change, and under READ
 *     COMMITTED the locking SELECT then re-reads the current row version, so
 *     the capacity check in the service runs against the value that was just
 *     committed.
 *
 * Held until the reservation transaction commits or rolls back, which is what
 * makes the guarantee reach as far as the INSERT.
 *
 * Deliberately not on the public catalogue or availability reads: those answer
 * a question and end, and taking a lock there would have bookings and
 * administrators queue behind anonymous page views.
 */
export async function findActiveRoomTypeBySlug(
  client: PoolClient,
  slug: string,
): Promise<ReservationRoomType | null> {
  const { rows } = await client.query<ReservationRoomTypeRow>(
    `SELECT rt.id,
            rt.slug,
            rt.name,
            rt.capacity,
            rt.base_nightly_rate
       FROM room_types rt
      WHERE rt.slug = $1
        AND rt.is_active = true
        FOR KEY SHARE OF rt`,
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
