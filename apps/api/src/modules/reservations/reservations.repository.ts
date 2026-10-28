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
 * `FOR SHARE` is the first lock of the canonical order:
 *
 *     room_types row  ->  rooms row
 *
 * MySQL has no FOR KEY SHARE, so this is the weakest shared row lock InnoDB
 * offers. Any number of bookings hold it at once (each going on to lock a
 * *different* physical room); an administrator's FOR UPDATE (or any UPDATE of
 * the row) conflicts, so a booking and a capacity change can never overlap.
 * Unlike PostgreSQL, a descriptive UPDATE also queues behind in-flight
 * bookings; that is brief and accepted.
 *
 * Without any lock here, an admin transaction could lower capacity and commit
 * in the window between this read and the reservation INSERT, leaving a booking
 * validated against a capacity the hotel no longer offers — the exact party
 * size the admin operation exists to refuse. Instead the two wait for each
 * other:
 *
 *   - a capacity change waits for every in-flight booking on this room type;
 *   - a booking waits for an in-flight capacity change, and under READ
 *     COMMITTED (set by the service before BEGIN) the locking SELECT then re-reads the current row version, so
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
        FOR SHARE OF rt`,
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
 * guarantee: MySQL has no exclusion constraint, so `insertReservation`
 * re-checks overlap under the room row lock before writing.
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
                 AND res.check_in < $3
                 AND res.check_out > $2
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
 * MySQL has no exclusion constraint, so before writing, overlapping active
 * stays for the (already row-locked) room are checked with a locking read,
 * which sees the latest committed rows under READ COMMITTED. A hit raises an
 * error with SQLSTATE `23P01`, which the service reports as no availability.
 *
 * Only a duplicate `booking_reference` returns null (a failed statement leaves
 * the transaction usable for a retry). Any other violation raises.
 */
export async function insertReservation(
  client: PoolClient,
  input: InsertReservationInput,
): Promise<{ id: string } | null> {
  const overlap = await client.query<RoomIdRow>(
    `SELECT id
       FROM reservations
      WHERE room_id = $1
        AND status IN ('pending', 'confirmed')
        AND check_in < $3
        AND check_out > $2
      LIMIT 1
        FOR UPDATE`,
    [input.roomId, input.checkIn, input.checkOut],
  );

  if (overlap.rows.length > 0) {
    throw Object.assign(
      new Error('Overlapping active stay (reservations_no_overlapping_active_stays)'),
      { code: '23P01', constraint: 'reservations_no_overlapping_active_stays' },
    );
  }

  try {
    const result = await client.query(
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               'pending', 'EGP', $13, $14, $15)`,
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

    return result.insertId ? { id: result.insertId } : null;
  } catch (error) {
    const e = error as { code?: unknown; constraint?: unknown };
    if (e.code === '23505' && e.constraint === 'reservations_booking_reference_key') {
      return null;
    }
    throw error;
  }
}
