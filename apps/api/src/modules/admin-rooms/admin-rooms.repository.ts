import type { PoolClient } from '../../db/pool';
import { dbPool } from '../../db/pool';
import type { AdminPhysicalRoom, AdminPhysicalRoomUpdate } from './admin-rooms.types';

/**
 * Reads and edits the hotel's physical rooms.
 *
 * The only table this file writes to is `rooms`, and the only columns it
 * writes are `room_number`, `is_active` and `updated_at`. `room_type_id` is
 * never written: moving a room between types is not a V1 operation, and the
 * composite foreign key `(room_id, room_type_id)` from `reservations` would
 * refuse it outright for any room with booking history. That is not a rule
 * this module remembers to follow — it is a statement that does not exist
 * here.
 *
 * `reservations` is read, only ever counted, and never written. A room going
 * out of service must not be able to move, cancel or rewrite a stay; the
 * service refuses the operation instead.
 *
 * Nothing is deleted. `room_types` is read to resolve and to lock, never
 * written.
 *
 * Room numbers are matched exactly and case-sensitively — no LOWER, no LIKE.
 * The column's collation is case-insensitive, so exact lookups add a BINARY
 * comparison. Case-insensitive *uniqueness* is a different question, and
 * MySQL owns it through the unique indexes; identity is the exact string.
 *
 * ---------------------------------------------------------------------------
 * CANONICAL ADMIN INVENTORY LOCK ORDER
 *
 *     room_types row, then rooms row
 *
 * Every transaction in the admin inventory area takes its locks in that order
 * and no other. The booking path already does the same — it reads the room
 * type before taking `FOR UPDATE OF r` on a room — so an admin transaction
 * that followed the reverse order could deadlock against a guest booking.
 * ---------------------------------------------------------------------------
 */

/** Columns behind the physical-room contract. No `id`, no `room_type_id`. */
const ROOM_COLUMNS = `r.room_number,
       r.is_active,
       r.created_at,
       r.updated_at`;

type AdminPhysicalRoomRow = {
  room_number: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

/**
 * The same row as a LEFT JOIN produces it: every column null when the room
 * type has no rooms at all.
 */
type MaybeEmptyRoomRow = { [K in keyof AdminPhysicalRoomRow]: AdminPhysicalRoomRow[K] | null };

/**
 * True for a join row that is a real room rather than the empty side of the
 * LEFT JOIN. The mapper re-proves every field regardless, so this narrows the
 * type without being the thing that guarantees it.
 */
function isPopulatedRoomRow(row: MaybeEmptyRoomRow): row is AdminPhysicalRoomRow {
  return row.room_number !== null;
}

type ResolvedRoomRow = {
  id: string;
  room_type_id: string;
  room_number: string;
  is_active: boolean;
};

/**
 * Digits only, at least one, no leading zero: the form a `bigserial` takes on
 * its way out of the mysql2 adapter, which returns BIGINT as a string rather
 * than risk a value past `Number.MAX_SAFE_INTEGER`.
 */
const INTERNAL_ID_PATTERN = /^[1-9]\d*$/;

/** Digits only, as the adapter returns for COUNT(*). */
const WHOLE_NUMBER_PATTERN = /^\d+$/;

/**
 * The guards below all protect against stored data the schema's own
 * constraints say cannot exist. If one fires it is a data or migration
 * problem, so it raises a server error rather than being softened into a
 * default or a silently coerced value.
 */
function requireText(column: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Unexpected room ${column} from the database: expected text`);
  }

  return value;
}

/** `room_number` is NOT NULL and no code path stores an empty one. */
function requireNonEmptyText(column: string, value: unknown): string {
  const text = requireText(column, value);

  if (text.length === 0) {
    throw new Error(`Unexpected room ${column} from the database: expected a non-empty value`);
  }

  return text;
}

function requireBoolean(column: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Unexpected room ${column} from the database: expected a boolean`);
  }

  return value;
}

function requireInstant(column: string, value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Unexpected room ${column} from the database: expected a timestamp`);
  }

  return value;
}

/**
 * An internal primary key, kept as the string the driver produced.
 *
 * Never converted to a number: `bigint` outruns exact integer arithmetic in
 * JavaScript, and a key that has been through a float is a key that may no
 * longer identify the row it came from. It is carried back into the next query
 * as a parameter, which is the only thing it is for — it must never reach an
 * HTTP response.
 */
function requireInternalId(column: string, value: unknown): string {
  if (typeof value !== 'string' || !INTERNAL_ID_PATTERN.test(value)) {
    throw new Error(`Unexpected room ${column} from the database: expected an internal identifier`);
  }

  return value;
}

/**
 * Turns a counted bigint into a plain number.
 *
 * Counted as a string so a count past exact integer range is refused here.
 */
export function parseRoomReservationCount(value: unknown): number {
  if (typeof value !== 'string' || !WHOLE_NUMBER_PATTERN.test(value)) {
    throw new Error(`Unexpected reservation count from the database: ${String(value)}`);
  }

  const count = Number(value);

  if (!Number.isSafeInteger(count)) {
    throw new Error(`Reservation count exceeds exact integer arithmetic: ${value}`);
  }

  return count;
}

/**
 * Maps one row onto the physical-room contract, field by field.
 *
 * Nothing is spread: the shape the API promises is built here rather than
 * inherited from whatever the query happened to select, so an `id` cannot
 * reach a response by being added to a SELECT later. The room number is
 * carried through exactly as stored — never re-cased, never re-trimmed.
 */
export function toAdminPhysicalRoom(row: AdminPhysicalRoomRow): AdminPhysicalRoom {
  return {
    roomNumber: requireNonEmptyText('room_number', row.room_number),
    isActive: requireBoolean('is_active', row.is_active),
    createdAt: requireInstant('created_at', row.created_at).toISOString(),
    updatedAt: requireInstant('updated_at', row.updated_at).toISOString(),
  };
}

/**
 * One physical room resolved to the keys the next statement needs.
 *
 * Repository-private. `roomId` and `roomTypeId` are internal join keys and
 * must never reach an HTTP response. `roomNumber` comes back so the caller can
 * check the room it locked is still the room the URL named.
 */
export type ResolvedAdminPhysicalRoom = {
  roomId: string;
  roomTypeId: string;
  roomNumber: string;
  isActive: boolean;
};

/**
 * Maps a resolved/locked row, field by field. Exported for the same reason the
 * other mappers are: it is the pure part of this module, and the only part a
 * test can hold to account without a database.
 */
export function toResolvedAdminPhysicalRoom(row: ResolvedRoomRow): ResolvedAdminPhysicalRoom {
  return {
    roomId: requireInternalId('id', row.id),
    roomTypeId: requireInternalId('room_type_id', row.room_type_id),
    roomNumber: requireNonEmptyText('room_number', row.room_number),
    isActive: requireBoolean('is_active', row.is_active),
  };
}

/**
 * Every physical room of one room type, together with whether that room type
 * exists at all.
 *
 * The two facts travel together on purpose. A caller handed a bare `[]` cannot
 * tell a room type with no rooms yet from a slug nobody has used, and those
 * need different answers — one is a room type waiting for inventory, the other
 * is a 404. Returning `null` for "no such room type" and a list otherwise
 * makes the distinction impossible to drop by accident, and costs one query
 * rather than two.
 *
 * Chosen over a separate existence check because two statements would leave a
 * window in which the room type is created or the rooms change between them,
 * and over a `roomTypeExists` flag because a nullable result is checked by the
 * type system rather than by remembering to read a boolean.
 *
 * Active and inactive rooms alike: an administrator has to see a room that is
 * out of service in order to do anything about it.
 *
 * Ordered `room_number ASC, id ASC`, matching the allocator's own ordering in
 * `findAndLockAvailableRoom`, so the list an administrator reads is the order
 * rooms are actually handed out in.
 */
export async function listAdminPhysicalRoomsForType(
  slug: string,
): Promise<AdminPhysicalRoom[] | null> {
  // The join's columns are all nullable in the no-rooms case, and the row type
  // says so rather than asserting it away.
  const { rows } = await dbPool.query<MaybeEmptyRoomRow>(
    `SELECT ${ROOM_COLUMNS}
       FROM room_types rt
       LEFT JOIN rooms r ON r.room_type_id = rt.id
      WHERE rt.slug = $1
      ORDER BY r.room_number ASC, r.id ASC`,
    [slug],
  );

  // No row at all means the room type does not exist. One row with a null
  // room number means it exists with no rooms.
  if (rows.length === 0) {
    return null;
  }

  // A single row whose room number is null is the room type with no rooms.
  // Every other row is a real room and is mapped strictly.
  return rows.filter(isPopulatedRoomRow).map(toAdminPhysicalRoom);
}

/**
 * Adds one physical room to an existing room type.
 *
 * A single statement: the room type is resolved inside the INSERT, so there is
 * no window between checking that it exists and inserting against it. If the
 * slug matches nothing the SELECT yields no rows, the INSERT writes nothing,
 * and this returns null — a room is never created under a room type that is
 * not there.
 *
 * `is_active` is left to its column default of true. A room is added because
 * the hotel has it; one that should not be bookable yet is one that should not
 * have been added yet, and deactivating it afterwards is a separate,
 * guarded operation.
 *
 * The room number is stored exactly as validated — trimmed, case preserved.
 * Uniqueness is the database's: `rooms_room_number_key` for the exact value and
 * `rooms_room_number_lower_key` for the case-insensitive one. Neither is
 * pre-checked here, because a SELECT beforehand would only widen the window in
 * which the answer changes; the unique violation propagates untouched so the
 * service can map SQLSTATE 23505 onto ROOM_NUMBER_TAKEN.
 */
export async function insertAdminPhysicalRoom(
  slug: string,
  roomNumber: string,
): Promise<AdminPhysicalRoom | null> {
  const inserted = await dbPool.query(
    `INSERT INTO rooms (room_type_id, room_number)
     SELECT rt.id, $2
       FROM room_types rt
      WHERE rt.slug = $1`,
    [slug, roomNumber],
  );

  if (!inserted.insertId) {
    return null;
  }

  // No RETURNING in MySQL: read the new row back by its generated key.
  const { rows } = await dbPool.query<AdminPhysicalRoomRow>(
    `SELECT ${ROOM_COLUMNS}
       FROM rooms r
      WHERE r.id = $1`,
    [inserted.insertId],
  );

  const row = rows[0];

  return row ? toAdminPhysicalRoom(row) : null;
}

/**
 * Resolves a room number to the internal keys a locking sequence needs.
 *
 * Unlocked and outside any transaction: its only job is to learn which
 * `room_types` row must be locked first. Everything it returns is treated as
 * provisional — by the time the locks are held the room may have been renamed
 * or moved by another administrator, which is what the verification after the
 * lock is for.
 *
 * Matched exactly: the route identifier is the stored value or it is nothing.
 */
export async function findAdminPhysicalRoomByNumber(
  roomNumber: string,
): Promise<ResolvedAdminPhysicalRoom | null> {
  const { rows } = await dbPool.query<ResolvedRoomRow>(
    `SELECT r.id,
            r.room_type_id,
            r.room_number,
            r.is_active
       FROM rooms r
      WHERE r.room_number = $1
        AND BINARY r.room_number = BINARY $1`,
    [roomNumber],
  );

  const row = rows[0];

  // room_number is unique, so there is at most one row.
  return row ? toResolvedAdminPhysicalRoom(row) : null;
}

/**
 * Locks the room type a physical room belongs to.
 *
 * The FIRST lock of the canonical order. It is taken by internal id, from the
 * unlocked resolution above, so the parent is held before the child and before
 * anything is decided.
 *
 * It is here rather than in the room-types repository because it is a step of
 * the rooms lock sequence, and the order is easier to keep right when the
 * whole sequence reads in one file. It only locks; it never writes
 * `room_types`.
 *
 * Returns nothing but whether the row was there. The caller does not need its
 * contents — it needs the lock.
 */
export async function lockRoomTypeRowForRoomChange(
  client: PoolClient,
  roomTypeId: string,
): Promise<boolean> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT rt.id
       FROM room_types rt
      WHERE rt.id = $1
        FOR UPDATE`,
    [roomTypeId],
  );

  return rows.length > 0;
}

/**
 * Locks one physical room for the caller's transaction, by internal id.
 *
 * The SECOND lock of the canonical order, and the same row the booking path
 * takes `FOR UPDATE OF r` on while allocating. That shared row is what makes
 * deactivation safe without touching the booking code: if this transaction
 * holds it, the allocator's `SKIP LOCKED` steps past and picks another room;
 * if the allocator holds it, this waits and then counts a reservation that by
 * then exists.
 *
 * It returns the room's *current* number so the caller can confirm the row it
 * locked is still the one the route named. Another administrator may have
 * renamed it between the unlocked resolution and this lock, and continuing
 * would edit a different resource than the URL asked for.
 */
export async function lockAdminPhysicalRoomById(
  client: PoolClient,
  roomId: string,
): Promise<ResolvedAdminPhysicalRoom | null> {
  const { rows } = await client.query<ResolvedRoomRow>(
    `SELECT r.id,
            r.room_type_id,
            r.room_number,
            r.is_active
       FROM rooms r
      WHERE r.id = $1
        FOR UPDATE`,
    [roomId],
  );

  const row = rows[0];

  return row ? toResolvedAdminPhysicalRoom(row) : null;
}

/**
 * How many upcoming stays are allocated to one physical room.
 *
 * Counted, never listed: the answer to "may I take this room out of service?"
 * is a number. No guest name, no booking reference and no date leaves this
 * function.
 *
 * What counts, and why:
 *
 *   status IN ('pending','confirmed')  cancelled stays hold no inventory; they
 *                                      released the room by changing what the
 *                                      overlap check looks at.
 *   check_out > UTC_DATE()             deliberately not `check_in >=
 *                                      UTC_DATE()`. A guest who checked in
 *                                      yesterday and leaves tomorrow is in the
 *                                      room right now, which is the strongest
 *                                      possible reason not to close it. Only a
 *                                      stay that has already ended is past.
 *
 * Reads `reservations` and writes nothing. There is no way in this system to
 * move a stay to another room, so a room with upcoming stays is one the
 * service must refuse to deactivate rather than strand.
 */
export async function countFutureInventoryReservationsForRoom(
  client: PoolClient,
  roomId: string,
): Promise<number> {
  const { rows } = await client.query<{ upcoming: string }>(
    `SELECT COUNT(*) AS upcoming
       FROM reservations res
      WHERE res.room_id = $1
        AND res.status IN ('pending', 'confirmed')
        AND res.check_out > UTC_DATE()`,
    [roomId],
  );

  const row = rows[0];

  if (!row) {
    throw new Error('Room reservation count returned no row');
  }

  return parseRoomReservationCount(row.upcoming);
}

/**
 * The only columns this module may write, and the only place a column name is
 * chosen.
 *
 * The SET clause below is assembled from this map, never from the keys of a
 * request body: a caller's key decides *whether* a fragment is emitted, and
 * this map decides what that fragment says. So no request can name a column,
 * and `id`, `room_type_id` and `created_at` are unreachable from here by
 * construction rather than by a check.
 */
const UPDATABLE_COLUMNS: Readonly<Record<keyof AdminPhysicalRoomUpdate, string>> = {
  roomNumber: 'room_number',
  isActive: 'is_active',
};

const UPDATABLE_FIELDS = Object.keys(UPDATABLE_COLUMNS) as (keyof AdminPhysicalRoomUpdate)[];

/**
 * Applies a partial update to the room the caller already locked.
 *
 * Addressed by internal id, not by room number: the row is held, and the
 * number may be the very thing being changed. A rename and a deactivation in
 * one request therefore become one statement, and the number the URL named is
 * never used to find the row a second time.
 *
 * Partial in the exact sense the validator produced: a field the caller never
 * mentioned emits no SET fragment and is left alone. `room_number` is stored
 * exactly as given — no LOWER, no re-casing; the case-insensitive unique index
 * constrains which numbers may coexist, not how any one of them is written.
 *
 * `updated_at` is set here because the schema gives it a DEFAULT and no
 * trigger, so nothing else would move it. `id`, `room_type_id` and
 * `created_at` are not in `UPDATABLE_COLUMNS` and cannot be written.
 *
 * A duplicate number raises from MySQL and propagates untouched, so the
 * service can map SQLSTATE 23505 onto ROOM_NUMBER_TAKEN — including the
 * case-insensitive index, which is the whole reason the constraint exists.
 */
export async function updateAdminPhysicalRoom(
  client: PoolClient,
  roomId: string,
  update: AdminPhysicalRoomUpdate,
): Promise<AdminPhysicalRoom | null> {
  // $1 is the room id; values start at $2.
  const values: unknown[] = [roomId];
  const assignments: string[] = [];

  for (const field of UPDATABLE_FIELDS) {
    if (!(field in update)) {
      continue;
    }

    values.push(update[field]);
    assignments.push(`${UPDATABLE_COLUMNS[field]} = $${values.length}`);
  }

  if (assignments.length === 0) {
    // Unreachable: the validator refuses a body that changes nothing. Guarded
    // anyway, because an UPDATE with an empty SET clause is a syntax error.
    throw new Error('Physical room update contained no fields to change');
  }

  await client.query(
    `UPDATE rooms r
        SET ${assignments.join(',\n            ')},
            updated_at = UTC_TIMESTAMP(3)
      WHERE r.id = $1`,
    values,
  );

  // No RETURNING in MySQL: the caller holds this row's lock, so re-reading it
  // inside the same transaction returns exactly what was just written.
  const { rows } = await client.query<AdminPhysicalRoomRow>(
    `SELECT ${ROOM_COLUMNS}
       FROM rooms r
      WHERE r.id = $1`,
    [roomId],
  );

  const row = rows[0];

  return row ? toAdminPhysicalRoom(row) : null;
}
