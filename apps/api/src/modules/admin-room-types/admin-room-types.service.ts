import { dbPool } from '../../db/pool';
import {
  countActivePhysicalRooms,
  countReservationsAboveCapacity,
  findAdminRoomTypeBySlug,
  insertAdminRoomType,
  listAdminRoomTypes,
  lockAdminRoomTypeBySlug,
  updateAdminRoomType,
  updateAdminRoomTypeActiveState,
  updateAdminRoomTypeCapacity,
} from './admin-room-types.repository';
import type {
  AdminRoomTypeCreate,
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

// ---------------------------------------------------------------------------
// Creation, and the guarded capacity change.
//
// CANONICAL ADMIN LOCK ORDER (shared with admin-rooms):
//
//     booking:          room_types FOR SHARE -> rooms FOR UPDATE SKIP LOCKED
//     admin capacity:   room_types FOR UPDATE
//     admin room edit:  room_types FOR UPDATE    -> rooms FOR UPDATE
//
// No path may lock a room before its room type.
// ---------------------------------------------------------------------------

/** MySQL unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** The unique index behind a room type's public identifier. */
const SLUG_CONSTRAINT = 'room_types_slug_key';

/**
 * True only for a unique violation on one of the named constraints.
 *
 * Both halves matter. A `23505` from some other index is a different problem
 * wearing the same number, and reporting it as "that reference is taken" would
 * send an administrator to change a value that was never the trouble.
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

/**
 * Two things that can happen, as values rather than a mixture of values and
 * thrown errors. A taken slug is an ordinary answer this endpoint gives; a lost
 * connection is not, and still throws.
 */
export type AdminRoomTypeCreateResult =
  | { outcome: 'created'; roomType: AdminRoomTypeDetail }
  | { outcome: 'slug-taken' };

/**
 * Creates one room type, always as a draft.
 *
 * No transaction: it is a single INSERT, and the only thing that can go wrong
 * in a way worth naming is the slug already being in use.
 *
 * That is not pre-checked. `room_types_slug_key` is the authority, and a SELECT
 * beforehand would only widen the window in which the answer changes — two
 * administrators submitting the same slug at once would both see it free and
 * one would still fail at the insert. Asking the constraint is asking the only
 * thing that knows.
 *
 * The repository writes `is_active = false` as a literal, so nothing here has
 * to remember to. No physical room is created.
 */
export async function createAdminRoomType(
  create: AdminRoomTypeCreate,
): Promise<AdminRoomTypeCreateResult> {
  try {
    return { outcome: 'created', roomType: await insertAdminRoomType(create) };
  } catch (error) {
    if (isUniqueViolationOn(error, [SLUG_CONSTRAINT])) {
      return { outcome: 'slug-taken' };
    }

    // Any other database failure is a fault, not an answer.
    throw error;
  }
}

/**
 * Three things that can happen. A caller that forgets one should fail to
 * compile rather than fail in production.
 */
export type AdminRoomTypeCapacityResult =
  | { outcome: 'updated'; roomType: AdminRoomTypeDetail }
  | { outcome: 'not-found' }
  | { outcome: 'capacity-conflict' };

/**
 * Changes one room type's capacity, serialized against every booking and every
 * other capacity change on the same room type.
 *
 * The whole decision happens inside one transaction holding the row's
 * `FOR UPDATE` lock: read the current capacity, count what a lower one would
 * contradict, then write. A booking for the same room type holds
 * `FOR SHARE`, which conflicts, so it either finished before this lock was
 * granted — and is therefore in the count — or waits and re-reads the capacity
 * this transaction committed. Neither order can produce a booking validated
 * against a capacity the hotel no longer offers.
 *
 * Raising capacity, or setting it to what it already is, contradicts nothing
 * and skips the count entirely: no existing party can stop fitting in a room
 * that got larger. A same-value request is allowed and moves `updated_at`; it
 * is not worth a separate no-op contract to avoid that.
 *
 * Lowering it is the only case that can be refused, and the refusal carries a
 * count of nothing — no booking reference, no guest, no date. The fix is a
 * decision about real guests, and this endpoint is not where their details are
 * read out.
 *
 * Nothing here writes `reservations`. The guest counts on stays already booked
 * are what those guests agreed to.
 */
export async function changeAdminRoomTypeCapacity(
  slug: string,
  capacity: number,
): Promise<AdminRoomTypeCapacityResult> {
  const client = await dbPool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const locked = await lockAdminRoomTypeBySlug(client, slug);

    if (!locked) {
      // Nothing was read that matters and nothing was written; the rollback
      // just ends the transaction. The flag is cleared only once it has
      // actually succeeded, so a rollback that throws still reaches the
      // handler below.
      await client.query('ROLLBACK');
      inTransaction = false;

      return { outcome: 'not-found' };
    }

    // Only a reduction can contradict a stay that is already booked.
    if (capacity < locked.capacity) {
      const conflicting = await countReservationsAboveCapacity(client, locked.roomTypeId, capacity);

      if (conflicting > 0) {
        await client.query('ROLLBACK');
        inTransaction = false;

        return { outcome: 'capacity-conflict' };
      }
    }

    const roomType = await updateAdminRoomTypeCapacity(client, locked.roomTypeId, capacity);

    if (!roomType) {
      // The row is held by this transaction's own lock, so it cannot have
      // disappeared. A fault, never a missing room type.
      throw new Error('Room type vanished while its capacity was being updated');
    }

    // Cleared only after COMMIT returns, so a commit that fails is still an
    // open transaction as far as the handler below is concerned.
    await client.query('COMMIT');
    inTransaction = false;

    return { outcome: 'updated', roomType };
  } catch (error) {
    // One rollback path for every failure, including a failed COMMIT.
    if (inTransaction) {
      inTransaction = false;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to roll back room type capacity transaction:', rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

/**
 * Three things that can happen. A caller that forgets one should fail to
 * compile rather than fail in production.
 */
export type AdminRoomTypeStatusResult =
  | { outcome: 'updated'; roomType: AdminRoomTypeDetail }
  | { outcome: 'not-found' }
  | { outcome: 'no-active-rooms' };

/**
 * Publishes or archives one room type, serialized against every booking, every
 * capacity change and every physical-room edit on the same room type.
 *
 * The whole decision happens inside one transaction holding the room type's
 * `FOR UPDATE` lock: read the current state, count the rooms actually in
 * service, then write. That lock is the FIRST of the canonical admin order,
 * the same one the capacity change and the physical-room edit take before
 * anything else, so this path introduces no new ordering and can deadlock
 * against neither. A booking for the same room type holds `FOR SHARE`,
 * which conflicts, so it either finished before this lock was granted or
 * waits and then reads the state this transaction committed.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COUNT IS NOT `room_count`
 *
 * Availability requires `room_types.is_active AND rooms.is_active`. A room
 * type published with rooms that are all out of service is therefore visible
 * on the website and unbookable in every search — the precise outcome that
 * makes creation produce a draft. `room_count` counts every room regardless of
 * `rooms.is_active`, because it answers an inventory question, so using it
 * here would enforce the rule in name only. `countActivePhysicalRooms` asks
 * the question this decision actually turns on, under this transaction's lock.
 * ---------------------------------------------------------------------------
 *
 * Only a real transition into published is guarded. A room type that is
 * already active is not being published by a request that asks for what is
 * already true, and refusing an idempotent PATCH would refuse to leave things
 * exactly as they are — the same reasoning `changeAdminPhysicalRoom` applies
 * to taking a room out of service. A no-op still answers 200 with the current
 * detail, and the write leaves `updated_at` alone, so re-sending a known state
 * never makes the catalogue look edited.
 *
 * Archiving is never refused. It is reversible, it strands nothing, and it is
 * what an administrator reaches for when something is wrong — a system that
 * argues at that moment is a system that keeps a broken room type on sale.
 * Reservations already taken are untouched: this path writes `room_types` and
 * nothing else, so the stays the hotel promised survive the room type leaving
 * the website.
 */
export async function changeAdminRoomTypeStatus(
  slug: string,
  isActive: boolean,
): Promise<AdminRoomTypeStatusResult> {
  const client = await dbPool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const locked = await lockAdminRoomTypeBySlug(client, slug);

    if (!locked) {
      // Nothing was read that matters and nothing was written; the rollback
      // just ends the transaction. The flag is cleared only once it has
      // actually succeeded, so a rollback that throws still reaches the
      // handler below.
      await client.query('ROLLBACK');
      inTransaction = false;

      return { outcome: 'not-found' };
    }

    // Only a real transition into published can put an unbookable room type
    // in front of guests.
    if (isActive && !locked.isActive) {
      const activeRooms = await countActivePhysicalRooms(client, locked.roomTypeId);

      if (activeRooms === 0) {
        await client.query('ROLLBACK');
        inTransaction = false;

        return { outcome: 'no-active-rooms' };
      }
    }

    const roomType = await updateAdminRoomTypeActiveState(client, locked.roomTypeId, isActive);

    if (!roomType) {
      // The row is held by this transaction's own lock, so it cannot have
      // disappeared. A fault, never a missing room type.
      throw new Error('Room type vanished while its status was being updated');
    }

    // Cleared only after COMMIT returns, so a commit that fails is still an
    // open transaction as far as the handler below is concerned.
    await client.query('COMMIT');
    inTransaction = false;

    return { outcome: 'updated', roomType };
  } catch (error) {
    // One rollback path for every failure, including a failed COMMIT.
    if (inTransaction) {
      inTransaction = false;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to roll back room type status transaction:', rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}
