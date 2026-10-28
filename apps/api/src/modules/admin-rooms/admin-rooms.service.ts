import { dbPool } from '../../db/pool';
import {
  countFutureInventoryReservationsForRoom,
  findAdminPhysicalRoomByNumber,
  insertAdminPhysicalRoom,
  listAdminPhysicalRoomsForType,
  lockAdminPhysicalRoomById,
  lockRoomTypeRowForRoomChange,
  updateAdminPhysicalRoom,
} from './admin-rooms.repository';
import type { AdminPhysicalRoom, AdminPhysicalRoomUpdate } from './admin-rooms.types';

/**
 * Business rules for the hotel's physical rooms.
 *
 * The service owns the connection and the transaction; the repository issues
 * statements on the client it is given. That split is the same one reservation
 * creation and the reservation status change already use.
 *
 * ---------------------------------------------------------------------------
 * CANONICAL ADMIN LOCK ORDER
 *
 *     booking:          room_types FOR SHARE -> rooms FOR UPDATE SKIP LOCKED
 *     admin capacity:   room_types FOR UPDATE
 *     admin room edit:  room_types FOR UPDATE    -> rooms FOR UPDATE
 *
 * Every path locks the room type before the room. No path may introduce the
 * reverse: the booking transaction holds them in this order, so an admin
 * transaction taking them the other way round would deadlock against a guest
 * mid-booking.
 * ---------------------------------------------------------------------------
 *
 * Nothing in this file writes `reservations`. A room is never taken out of
 * service in a way that strands a stay — the operation is refused instead,
 * because this system has no way to move a booking to another room.
 */

/** MySQL unique_violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Both indexes that make a room number unique: the exact one from the original
 * schema, and the case-insensitive one added later. A clash on either is the
 * same answer to an administrator — some room already has that number — so
 * both map to one conflict.
 */
const ROOM_NUMBER_CONSTRAINTS = ['rooms_room_number_key', 'rooms_room_number_lower_key'] as const;

/**
 * True only for a unique violation on one of the named constraints.
 *
 * Both halves matter. A `23505` from some other index is a different problem
 * wearing the same number, and reporting it as "that room number is taken"
 * would send an administrator to change a value that was never the trouble.
 */
function isUniqueViolationOn(error: unknown, constraints: readonly string[]): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return (
    candidate.code === UNIQUE_VIOLATION &&
    typeof candidate.constraint === 'string' &&
    constraints.includes(candidate.constraint)
  );
}

export type AdminPhysicalRoomListResult =
  | { outcome: 'listed'; rooms: AdminPhysicalRoom[] }
  | { outcome: 'room-type-not-found' };

/**
 * Every physical room of one room type.
 *
 * The repository distinguishes the two cases a bare array cannot: `null` means
 * no such room type, `[]` means one that exists and has no rooms yet. The
 * first is a 404, the second is a success — a room type waiting for inventory
 * is a real and expected state, and reporting it as missing would be wrong.
 *
 * Inactive rooms are included. An administrator has to see a room that is out
 * of service in order to do anything about it.
 */
export async function listAdminPhysicalRooms(slug: string): Promise<AdminPhysicalRoomListResult> {
  const rooms = await listAdminPhysicalRoomsForType(slug);

  if (rooms === null) {
    return { outcome: 'room-type-not-found' };
  }

  return { outcome: 'listed', rooms };
}

export type AdminPhysicalRoomCreateResult =
  | { outcome: 'created'; room: AdminPhysicalRoom }
  | { outcome: 'room-type-not-found' }
  | { outcome: 'room-number-taken' };

/**
 * Adds one physical room to an existing room type.
 *
 * No transaction: the repository resolves the room type inside the INSERT, so
 * there is no window between checking that it exists and inserting against it.
 *
 * The room type may be active or archived. Adding inventory to an archived
 * type is a reasonable thing to do — the rooms are ready for when it is
 * offered again — and it changes nothing publicly, because an archived type is
 * filtered out of the catalogue and out of availability regardless. Nothing
 * here activates a room type.
 *
 * The new room is active, by the column's own default: a room is added because
 * the hotel has it.
 *
 * Uniqueness is not pre-checked. Both indexes are the authority, and asking
 * them is asking the only thing that knows.
 */
export async function addAdminPhysicalRoom(
  slug: string,
  roomNumber: string,
): Promise<AdminPhysicalRoomCreateResult> {
  try {
    const room = await insertAdminPhysicalRoom(slug, roomNumber);

    if (!room) {
      // No room type matched the slug, so the INSERT ... SELECT wrote nothing.
      return { outcome: 'room-type-not-found' };
    }

    return { outcome: 'created', room };
  } catch (error) {
    if (isUniqueViolationOn(error, ROOM_NUMBER_CONSTRAINTS)) {
      return { outcome: 'room-number-taken' };
    }

    throw error;
  }
}

export type AdminPhysicalRoomUpdateResult =
  | { outcome: 'updated'; room: AdminPhysicalRoom }
  | { outcome: 'not-found' }
  | { outcome: 'room-number-taken' }
  | { outcome: 'has-future-reservations' };

/**
 * Renames a physical room, changes whether it is in service, or both.
 *
 * Two phases, because the row that must be locked first is the parent, and the
 * parent's identity is not in the URL.
 *
 * PHASE 1, unlocked: resolve the room number to internal keys. Everything it
 * returns is provisional — by the time the locks are held the room may have
 * been renamed by another administrator, which is what the re-check in phase 2
 * is for. It is not an identity check and is never treated as one.
 *
 * PHASE 2, one transaction: lock the room type, then the room, then verify,
 * then decide, then write. The room lock is the same row the booking path takes
 * `FOR UPDATE OF r` on while allocating, which is what makes deactivation safe
 * without touching the booking code — if this transaction holds it the
 * allocator skips past to another room, and if the allocator holds it this
 * waits and then counts a reservation that by then exists.
 *
 * A conflict at any point rolls the whole transaction back, so a combined
 * rename-and-deactivate either applies entirely or not at all.
 */
export async function changeAdminPhysicalRoom(
  routeRoomNumber: string,
  update: AdminPhysicalRoomUpdate,
): Promise<AdminPhysicalRoomUpdateResult> {
  // PHASE 1 — provisional, outside any transaction.
  const resolved = await findAdminPhysicalRoomByNumber(routeRoomNumber);

  if (!resolved) {
    return { outcome: 'not-found' };
  }

  // PHASE 2 — one transaction, locks in the canonical order.
  const client = await dbPool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    // Parent first. Always.
    const parentLocked = await lockRoomTypeRowForRoomChange(client, resolved.roomTypeId);

    if (!parentLocked) {
      // Effectively unreachable: `rooms_room_type_id_fkey` is ON DELETE
      // RESTRICT, so a room type with rooms cannot be removed. If it happened
      // anyway the room went with it, which is a missing room, not a fault.
      await client.query('ROLLBACK');
      inTransaction = false;

      return { outcome: 'not-found' };
    }

    const locked = await lockAdminPhysicalRoomById(client, resolved.roomId);

    if (!locked) {
      await client.query('ROLLBACK');
      inTransaction = false;

      return { outcome: 'not-found' };
    }

    // The stale-URL check, and the reason the lock returns the current number.
    // Another administrator may have renamed this room between phase 1 and the
    // lock; editing it now would change a different resource than the URL
    // named. Exact and case-sensitive, like every other identity comparison.
    if (locked.roomNumber !== routeRoomNumber) {
      await client.query('ROLLBACK');
      inTransaction = false;

      return { outcome: 'not-found' };
    }

    // Defensive. Nothing in this system moves a room between types — the
    // composite foreign key from `reservations` forbids it for any room with
    // history, and no statement anywhere writes `rooms.room_type_id`. A
    // mismatch is therefore a broken invariant, not something a caller did,
    // and it must not be written through.
    if (locked.roomTypeId !== resolved.roomTypeId) {
      throw new Error('Physical room changed room type between resolution and lock');
    }

    // Only a real transition into "out of service" can strand a stay. Asked
    // only then: a room that is already inactive is not being taken out of
    // anything, and re-asking would refuse an idempotent PATCH for no reason.
    if (update.isActive === false && locked.isActive) {
      const upcoming = await countFutureInventoryReservationsForRoom(client, locked.roomId);

      if (upcoming > 0) {
        await client.query('ROLLBACK');
        inTransaction = false;

        return { outcome: 'has-future-reservations' };
      }
    }

    let room: AdminPhysicalRoom | null;

    try {
      room = await updateAdminPhysicalRoom(client, locked.roomId, update);
    } catch (error) {
      if (isUniqueViolationOn(error, ROOM_NUMBER_CONSTRAINTS)) {
        // The whole transaction goes, so a rename that clashed cannot leave a
        // deactivation from the same request applied.
        await client.query('ROLLBACK');
        inTransaction = false;

        return { outcome: 'room-number-taken' };
      }

      throw error;
    }

    if (!room) {
      // The row is held by this transaction's own lock, so it cannot have
      // disappeared.
      throw new Error('Physical room vanished while it was being updated');
    }

    await client.query('COMMIT');
    inTransaction = false;

    return { outcome: 'updated', room };
  } catch (error) {
    // One rollback path for every failure, including a failed COMMIT.
    if (inTransaction) {
      inTransaction = false;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to roll back physical room transaction:', rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}
