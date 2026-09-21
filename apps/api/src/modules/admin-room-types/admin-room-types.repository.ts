import { dbPool } from '../../db/pool';
import type {
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
