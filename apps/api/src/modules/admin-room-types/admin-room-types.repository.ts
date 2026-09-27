import type { PoolClient } from 'pg';
import { dbPool } from '../../db/pool';
import type {
  AdminRoomTypeCreate,
  AdminRoomTypeDetail,
  AdminRoomTypeListItem,
  AdminRoomTypeUpdate,
} from './admin-room-types.types';

/**
 * Reads and edits the room-type catalogue for an administrator.
 *
 * The only table this file ever writes to is `room_types`. There is no UPDATE
 * against `reservations` or `rooms` anywhere below, and there never should be:
 * a reservation's `nightly_rate_snapshot` and `total_amount` are the price the
 * guest actually accepted, so changing a room type's rate must be structurally
 * incapable of rewriting them. That is not a rule this module remembers to
 * follow — it is a statement that does not exist here.
 *
 * Physical rooms are read only to be counted. They are never modified, and no
 * room number or id leaves this module.
 */

/**
 * How many physical rooms belong to a room type.
 *
 * Every room, regardless of `rooms.is_active` — this is an inventory fact
 * ("how many rooms does this type have?"), not an availability figure. It says
 * nothing about what is bookable tonight, and must not be read as though it
 * did: availability is derived per-stay from reservations, elsewhere.
 */
const ROOM_COUNT_SQL = '(SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = rt.id)::int';

/**
 * Columns shared by the detail read and the update's returning clause.
 *
 * `numeric` columns are cast to text in SQL so they arrive as the exact
 * decimal strings PostgreSQL holds; read as JavaScript numbers they would
 * already have lost precision by the time anyone looked at them.
 */
const DETAIL_COLUMNS = `rt.slug,
       rt.name,
       rt.short_description,
       rt.description,
       rt.capacity,
       rt.bed_type,
       rt.bed_count,
       rt.size_sqm::text AS size_sqm,
       rt.view,
       rt.base_nightly_rate::text AS base_nightly_rate,
       rt.is_active,
       rt.sort_order,
       rt.created_at,
       rt.updated_at`;

type AdminRoomTypeListRow = {
  slug: string;
  name: string;
  capacity: number;
  base_nightly_rate: string;
  is_active: boolean;
  sort_order: number;
  room_count: number;
  updated_at: Date;
};

type AdminRoomTypeDetailRow = {
  slug: string;
  name: string;
  short_description: string | null;
  description: string | null;
  capacity: number;
  bed_type: string | null;
  bed_count: number | null;
  size_sqm: string | null;
  view: string | null;
  base_nightly_rate: string;
  is_active: boolean;
  sort_order: number;
  room_count: number;
  created_at: Date;
  updated_at: Date;
};

/**
 * The guards below all protect against stored data the schema's own
 * constraints say cannot exist. If one fires it is a data or migration
 * problem, so it raises a server error rather than being softened into a
 * default or a silently coerced value.
 */
function requireText(column: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Unexpected room type ${column} from the database: expected text`);
  }

  return value;
}

function requireNullableText(column: string, value: unknown): string | null {
  return value === null ? null : requireText(column, value);
}

function requireBoolean(column: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Unexpected room type ${column} from the database: expected a boolean`);
  }

  return value;
}

/** A count the schema constrains to whole numbers, with its own floor. */
function requireCount(column: string, value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `Unexpected room type ${column} from the database: expected a whole number of at least ${minimum}`,
    );
  }

  return value;
}

function requireNullableCount(column: string, value: unknown, minimum: number): number | null {
  return value === null ? null : requireCount(column, value, minimum);
}

/**
 * A `numeric` column that was cast to text in SQL. It must arrive as a string:
 * a number here would mean the cast was dropped and precision lost upstream.
 */
function requireDecimal(column: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Unexpected room type ${column} from the database: expected an exact decimal string`);
  }

  return value;
}

function requireNullableDecimal(column: string, value: unknown): string | null {
  return value === null ? null : requireDecimal(column, value);
}

function requireInstant(column: string, value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Unexpected room type ${column} from the database: expected a timestamp`);
  }

  return value;
}

/**
 * Maps one list row, field by field. Nothing is spread: the shape the API
 * promises is built here rather than inherited from whatever the query
 * happened to select.
 */
export function toAdminRoomTypeListItem(row: AdminRoomTypeListRow): AdminRoomTypeListItem {
  return {
    slug: requireText('slug', row.slug),
    name: requireText('name', row.name),
    capacity: requireCount('capacity', row.capacity, 1),
    baseNightlyRate: requireDecimal('base_nightly_rate', row.base_nightly_rate),
    // Not read from the row: V1 prices everything in EGP, and the column's own
    // CHECK is what enforces it.
    currency: 'EGP',
    isActive: requireBoolean('is_active', row.is_active),
    sortOrder: requireCount('sort_order', row.sort_order, 0),
    roomCount: requireCount('room_count', row.room_count, 0),
    updatedAt: requireInstant('updated_at', row.updated_at).toISOString(),
  };
}

export function toAdminRoomTypeDetail(row: AdminRoomTypeDetailRow): AdminRoomTypeDetail {
  return {
    slug: requireText('slug', row.slug),
    name: requireText('name', row.name),
    shortDescription: requireNullableText('short_description', row.short_description),
    description: requireNullableText('description', row.description),
    capacity: requireCount('capacity', row.capacity, 1),
    bedType: requireNullableText('bed_type', row.bed_type),
    bedCount: requireNullableCount('bed_count', row.bed_count, 1),
    sizeSqm: requireNullableDecimal('size_sqm', row.size_sqm),
    view: requireNullableText('view', row.view),
    baseNightlyRate: requireDecimal('base_nightly_rate', row.base_nightly_rate),
    currency: 'EGP',
    isActive: requireBoolean('is_active', row.is_active),
    sortOrder: requireCount('sort_order', row.sort_order, 0),
    roomCount: requireCount('room_count', row.room_count, 0),
    createdAt: requireInstant('created_at', row.created_at).toISOString(),
    updatedAt: requireInstant('updated_at', row.updated_at).toISOString(),
  };
}

/**
 * Every room type, active and inactive alike.
 *
 * Deliberately unfiltered, unlike the public catalogue: an administrator has
 * to be able to see an archived type in order to do anything about it. The
 * LEFT JOIN keeps a type with no physical rooms in the list, counted as zero,
 * because that is precisely the state worth noticing — such a type can never
 * be booked.
 *
 * Ordered by the catalogue's own `sort_order`, then name, then slug. The slug
 * tie-break is there so two types sharing a name and an order still come back
 * in the same sequence every time.
 */
export async function listAdminRoomTypes(): Promise<AdminRoomTypeListItem[]> {
  const { rows } = await dbPool.query<AdminRoomTypeListRow>(
    `SELECT rt.slug,
            rt.name,
            rt.capacity,
            rt.base_nightly_rate::text AS base_nightly_rate,
            rt.is_active,
            rt.sort_order,
            rt.updated_at,
            -- COUNT over the joined rows, so a type with no rooms is 0 rather
            -- than 1: COUNT(*) would count the LEFT JOIN's null row.
            COUNT(r.id)::int AS room_count
       FROM room_types rt
       LEFT JOIN rooms r ON r.room_type_id = rt.id
      GROUP BY rt.id
      ORDER BY rt.sort_order ASC, rt.name ASC, rt.slug ASC`,
  );

  return rows.map(toAdminRoomTypeListItem);
}

/**
 * Reads one room type by its slug.
 *
 * Matched exactly and case-sensitively — no LOWER, UPPER or ILIKE — so the
 * unique index does the work, and the caller has already validated the slug's
 * shape. Active and inactive types alike, for the same reason the list is
 * unfiltered.
 *
 * Returns null only when no room type has that slug. A row that exists but
 * cannot be trusted raises instead: a data fault is a server problem, not a
 * missing room type.
 */
export async function findAdminRoomTypeBySlug(slug: string): Promise<AdminRoomTypeDetail | null> {
  const { rows } = await dbPool.query<AdminRoomTypeDetailRow>(
    `SELECT ${DETAIL_COLUMNS},
            ${ROOM_COUNT_SQL} AS room_count
       FROM room_types rt
      WHERE rt.slug = $1`,
    [slug],
  );

  const row = rows[0];

  // slug is unique, so there is at most one row to find.
  return row ? toAdminRoomTypeDetail(row) : null;
}

/**
 * The only columns this module may write, and the only place a column name is
 * chosen.
 *
 * The SET clause below is assembled from this map, never from the keys of a
 * request body: a caller's key decides *whether* a fragment is emitted, and
 * this map decides what that fragment says. So no request can name a column,
 * and `slug`, `id`, `capacity`, `is_active`, `created_at` and `currency` are
 * unreachable from here by construction rather than by a check.
 */
const UPDATABLE_COLUMNS: Readonly<Record<keyof AdminRoomTypeUpdate, string>> = {
  name: 'name',
  shortDescription: 'short_description',
  description: 'description',
  bedType: 'bed_type',
  bedCount: 'bed_count',
  sizeSqm: 'size_sqm',
  view: 'view',
  baseNightlyRate: 'base_nightly_rate',
  sortOrder: 'sort_order',
};

const UPDATABLE_FIELDS = Object.keys(UPDATABLE_COLUMNS) as (keyof AdminRoomTypeUpdate)[];

/**
 * Applies a partial update and returns the room type as it now stands.
 *
 * Partial in the exact sense the validator produced: a field the caller never
 * mentioned emits no SET fragment and is left alone, while a field set to null
 * emits one carrying null and clears the column. The distinction survives
 * because it is carried by the presence of a key, not by the value.
 *
 * `updated_at` is set here because the schema gives it a DEFAULT and no
 * trigger — nothing else would move it.
 *
 * One statement, not two. The updated row is read straight out of RETURNING,
 * which sees the new values, and the physical-room count comes from a subquery
 * in the same clause. A separate SELECT afterwards could pick up someone
 * else's concurrent edit and report it as the outcome of this one.
 *
 * Deliberately not a data-modifying CTE: an outer query joining back to
 * `room_types` would read the table at the statement's snapshot and hand back
 * the values from *before* the update.
 *
 * Returns null only when no room type has that slug.
 */
export async function updateAdminRoomType(
  slug: string,
  update: AdminRoomTypeUpdate,
): Promise<AdminRoomTypeDetail | null> {
  // $1 is the slug; values start at $2.
  const values: unknown[] = [slug];
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
    throw new Error('Room type update contained no fields to change');
  }

  const { rows } = await dbPool.query<AdminRoomTypeDetailRow>(
    `UPDATE room_types rt
        SET ${assignments.join(',\n            ')},
            updated_at = now()
      WHERE rt.slug = $1
     RETURNING ${DETAIL_COLUMNS},
               ${ROOM_COUNT_SQL} AS room_count`,
    values,
  );

  const row = rows[0];

  return row ? toAdminRoomTypeDetail(row) : null;
}

// ---------------------------------------------------------------------------
// Creation, and the primitives a guarded capacity change is assembled from.
// ---------------------------------------------------------------------------

/**
 * Digits only, at least one, no leading zero: the form a `bigserial` takes on
 * its way out of the pg driver, which returns `int8` as a string rather than
 * risk a value past `Number.MAX_SAFE_INTEGER`.
 */
const INTERNAL_ID_PATTERN = /^[1-9]\d*$/;

/** Digits only, as `COUNT(*)::text` always produces. */
const WHOLE_NUMBER_PATTERN = /^\d+$/;

/**
 * An internal primary key, kept as the string the driver produced.
 *
 * Never converted to a number: `bigint` outruns exact integer arithmetic in
 * JavaScript, and a key that has been through a float is a key that may no
 * longer identify the row it came from. It is carried back into the next query
 * as a parameter, which is the only thing it is for.
 */
function requireInternalId(column: string, value: unknown): string {
  if (typeof value !== 'string' || !INTERNAL_ID_PATTERN.test(value)) {
    throw new Error(`Unexpected room type ${column} from the database: expected an internal identifier`);
  }

  return value;
}

/**
 * Turns a counted bigint into a plain number.
 *
 * Counted as text rather than `::int` so a count past `int4` is refused here
 * instead of raising a cast error inside PostgreSQL, and so the overflow check
 * belongs to this module. Mirrors `parseTotalCount` in the reservations
 * repository, which answers the same question about the same driver.
 */
export function parseReservationConflictCount(value: unknown): number {
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
 * One room type, locked for the caller's transaction.
 *
 * Repository-private. `roomTypeId` is an internal join key and must never
 * reach an HTTP response — it exists so the statements that follow the lock
 * can address the row they locked by primary key rather than by re-resolving
 * the slug, which would be a second chance to resolve it differently.
 */
export type LockedAdminRoomType = {
  roomTypeId: string;
  slug: string;
  capacity: number;
  isActive: boolean;
};

type LockedAdminRoomTypeRow = {
  id: string;
  slug: string;
  capacity: number;
  is_active: boolean;
};

/**
 * Maps a locked row, field by field. Exported for the same reason the other
 * mappers are: it is the pure part of this module, and the only part a test
 * can hold to account without a database.
 */
export function toLockedAdminRoomType(row: LockedAdminRoomTypeRow): LockedAdminRoomType {
  return {
    roomTypeId: requireInternalId('id', row.id),
    slug: requireText('slug', row.slug),
    // capacity > 0 is a CHECK constraint, so anything less is impossible data.
    capacity: requireCount('capacity', row.capacity, 1),
    isActive: requireBoolean('is_active', row.is_active),
  };
}

/**
 * Creates one room type, always as a draft.
 *
 * `is_active` is written as a literal `false`, never as a parameter: creation
 * is the one operation where a caller could publish a room type with no
 * physical rooms behind it, so the value is not something this statement can
 * be told. `AdminRoomTypeCreate` carries no `isActive` field to supply either
 * — the absence is enforced by the type and stated again by the SQL.
 *
 * No physical room is created. A new room type has none, which is precisely
 * why it is not yet bookable, and `room_count` therefore comes back as 0 —
 * asked for through the same subquery the other two detail statements use, so
 * all three produce an identical shape by identical means.
 *
 * `created_at` and `updated_at` are left to their column defaults; nothing
 * here decides what time it is.
 *
 * One statement. Uniqueness is `room_types_slug_key`'s to enforce; a SELECT
 * beforehand would only widen the window in which the answer changes, so a
 * unique violation propagates untouched for the service to classify.
 */
export async function insertAdminRoomType(create: AdminRoomTypeCreate): Promise<AdminRoomTypeDetail> {
  const { rows } = await dbPool.query<AdminRoomTypeDetailRow>(
    `INSERT INTO room_types AS rt (
       slug, name, short_description, description, capacity,
       bed_type, bed_count, size_sqm, view, base_nightly_rate,
       is_active, sort_order
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11)
     RETURNING ${DETAIL_COLUMNS},
               ${ROOM_COUNT_SQL} AS room_count`,
    [
      create.slug,
      create.name,
      create.shortDescription,
      create.description,
      create.capacity,
      create.bedType,
      create.bedCount,
      create.sizeSqm,
      create.view,
      create.baseNightlyRate,
      create.sortOrder,
    ],
  );

  const row = rows[0];

  // An INSERT that returned nothing without raising is not a case this
  // statement has. Treated as a fault, never as a missing room type.
  if (!row) {
    throw new Error('Room type insert returned no row');
  }

  return toAdminRoomTypeDetail(row);
}

/**
 * Locks one room type by slug for the caller's transaction.
 *
 * The first half of a guarded capacity change: hold the row, count what would
 * conflict, then write — all against a capacity that cannot move underneath
 * the decision. Reading without the lock and updating afterwards would let two
 * administrators each count against a value the other was already replacing.
 *
 * Matched exactly and case-sensitively, as everywhere else. No LOWER, no
 * ILIKE: the unique index does the work.
 *
 * Takes the caller's client so it runs inside the caller's transaction — the
 * lock means nothing outside one. It begins, commits and rolls back nothing.
 *
 * This is the FIRST lock in the canonical admin inventory lock order:
 *
 *     room_types row, then rooms row
 */
export async function lockAdminRoomTypeBySlug(
  client: PoolClient,
  slug: string,
): Promise<LockedAdminRoomType | null> {
  const { rows } = await client.query<LockedAdminRoomTypeRow>(
    `SELECT rt.id,
            rt.slug,
            rt.capacity,
            rt.is_active
       FROM room_types rt
      WHERE rt.slug = $1
        FOR UPDATE`,
    [slug],
  );

  const row = rows[0];

  // slug is unique, so there is at most one row to lock.
  return row ? toLockedAdminRoomType(row) : null;
}

/**
 * How many upcoming stays a proposed capacity would contradict.
 *
 * Counted, never listed: the answer to "may I lower this?" is a number, and a
 * refusal is not a place to read guest data out of. No name, no reference and
 * no date leaves this function.
 *
 * What counts, and why:
 *
 *   status IN ('pending','confirmed')  cancelled stays hold no inventory and
 *                                      make no promise to anyone.
 *   check_out > CURRENT_DATE           a stay already checked in but not yet
 *                                      checked out is a promise still being
 *                                      kept; a stay that has ended is history,
 *                                      and lowering capacity cannot unmake it.
 *   adults + children > proposed       the party the hotel already accepted no
 *                                      longer fits what the catalogue claims.
 *
 * Reads `reservations` and writes nothing, deliberately: the fix for a
 * conflict is a decision about real guests, never a quiet edit to the party
 * size someone booked.
 */
export async function countReservationsAboveCapacity(
  client: PoolClient,
  roomTypeId: string,
  proposedCapacity: number,
): Promise<number> {
  const { rows } = await client.query<{ conflicting: string }>(
    `SELECT COUNT(*)::text AS conflicting
       FROM reservations res
      WHERE res.room_type_id = $1
        AND res.status IN ('pending', 'confirmed')
        AND res.check_out > CURRENT_DATE
        -- ::bigint avoids int4 range inference on a large (but JS-safe) capacity.
        AND res.adults + res.children > $2::bigint`,
    [roomTypeId, proposedCapacity],
  );

  const row = rows[0];

  if (!row) {
    throw new Error('Reservation conflict count returned no row');
  }

  return parseReservationConflictCount(row.conflicting);
}

/**
 * Writes the new capacity onto the room type the caller already locked.
 *
 * Addressed by the internal id from that lock rather than by slug: the row is
 * already held, and re-resolving the slug would be a second lookup able to
 * disagree with the first.
 *
 * `capacity` and `updated_at` are the only columns this statement touches. It
 * does not write `reservations` — the guest counts on stays already booked are
 * what those guests agreed to, and no capacity edit may rewrite them.
 *
 * Whether the change is *allowed* is not decided here. The service counts the
 * conflicts under the same lock and refuses if it must.
 */
export async function updateAdminRoomTypeCapacity(
  client: PoolClient,
  roomTypeId: string,
  capacity: number,
): Promise<AdminRoomTypeDetail | null> {
  const { rows } = await client.query<AdminRoomTypeDetailRow>(
    `UPDATE room_types rt
        SET capacity = $2,
            updated_at = now()
      WHERE rt.id = $1
     RETURNING ${DETAIL_COLUMNS},
               ${ROOM_COUNT_SQL} AS room_count`,
    [roomTypeId, capacity],
  );

  const row = rows[0];

  return row ? toAdminRoomTypeDetail(row) : null;
}

/**
 * How many of a room type's physical rooms are actually in service.
 *
 * Deliberately NOT `room_count`. That figure counts every room regardless of
 * `rooms.is_active`, because it answers an inventory question — "how many
 * rooms does this type have?" — and a type whose only two rooms are both out
 * of service still has two. Publishing is a different question, and reading
 * the inventory figure for it would let a room type go live with nothing a
 * guest could ever be allocated.
 *
 * The condition is the admin half of what availability already requires:
 *
 *     room_types.is_active = true  AND  rooms.is_active = true
 *
 * This statement owns the second half. The first is what the caller is about
 * to write.
 *
 * Counted, never listed: the answer to "may this be published?" is a number.
 * No room number and no id leaves this function.
 *
 * Takes the caller's client so it runs inside the caller's transaction, under
 * the room-type lock. Outside one the count would be a guess that another
 * administrator could invalidate before the write landed.
 */
export async function countActivePhysicalRooms(
  client: PoolClient,
  roomTypeId: string,
): Promise<number> {
  const { rows } = await client.query<{ active_rooms: string }>(
    `SELECT COUNT(*)::text AS active_rooms
       FROM rooms r
      WHERE r.room_type_id = $1
        AND r.is_active = true`,
    [roomTypeId],
  );

  const row = rows[0];

  if (!row) {
    throw new Error('Active room count returned no row');
  }

  return parseReservationConflictCount(row.active_rooms);
}

/**
 * Publishes or archives the room type the caller already locked.
 *
 * Addressed by the internal id from that lock rather than by slug, for the
 * same reason the capacity write is: the row is already held, and re-resolving
 * the slug would be a second lookup able to disagree with the first.
 *
 * `is_active` and `updated_at` are the only columns this statement touches.
 * It writes neither `rooms` nor `reservations`: archiving a room type hides it
 * from the website, from availability and from new bookings, and changes
 * nothing about the stays already promised to guests.
 *
 * `updated_at` moves only on a real change. Setting a value to what it already
 * is answers 200 without disturbing the row, so a client that re-sends the
 * state it can already see does not make the catalogue look edited. That is
 * the same `IS DISTINCT FROM` guard the journey status write uses.
 *
 * Whether the change is *allowed* is not decided here. The service counts the
 * active rooms under the same lock and refuses if it must.
 */
export async function updateAdminRoomTypeActiveState(
  client: PoolClient,
  roomTypeId: string,
  isActive: boolean,
): Promise<AdminRoomTypeDetail | null> {
  const { rows } = await client.query<AdminRoomTypeDetailRow>(
    `UPDATE room_types rt
        SET is_active = $2,
            updated_at = CASE
              WHEN rt.is_active IS DISTINCT FROM $2 THEN now()
              ELSE rt.updated_at
            END
      WHERE rt.id = $1
     RETURNING ${DETAIL_COLUMNS},
               ${ROOM_COUNT_SQL} AS room_count`,
    [roomTypeId, isActive],
  );

  const row = rows[0];

  return row ? toAdminRoomTypeDetail(row) : null;
}
