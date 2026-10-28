import type { QueryResult, QueryResultRow } from '../../db/pool';
import { dbPool } from '../../db/pool';
import type { PublicRoomTypeImageRecord, RoomTypeRecord } from './rooms.types';

type RoomTypeRow = {
  // Read only to attach images below, and dropped by `toRoomTypeRecord`.
  // `room_types.id` is a bigint, which `pg` hands back as a string; it is
  // used purely as a grouping key and never parsed, compared numerically, or
  // put in a response.
  id: string;
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
};

type RoomTypeImageRow = {
  room_type_id: string;
  reference: string;
  alt_text: string | null;
  width: number;
  height: number;
  is_cover: boolean;
};

/**
 * What this module needs from a database handle, and nothing more.
 *
 * Deliberately not `PoolClient`: these are public, read-only, single-statement
 * queries with no transaction, so requiring a client would mean borrowing one
 * from the pool and handing back the responsibility of releasing it for no
 * gain. The admin media path, which genuinely is transactional, keeps its own
 * `PoolClient` signatures untouched.
 */
type Queryable = {
  query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

let queryable: Queryable = dbPool;

/**
 * Swaps the database handle for a test double. Mirrors the seam in
 * `package-reservations.service.ts`. Passing null restores the real pool.
 */
export function __setQueryableForTests(handle: Queryable | null): void {
  queryable = handle ?? dbPool;
}

// Listed explicitly (never SELECT *) so internal columns can't leak into responses.
const ROOM_TYPE_COLUMNS = `id,
       slug,
       name,
       short_description,
       description,
       capacity,
       bed_type,
       bed_count,
       size_sqm,
       view,
       base_nightly_rate`;

/**
 * The gallery order, reused exactly as the admin media repository defines it:
 *
 *     is_cover DESC, sort_order ASC, room_type_images.id ASC
 *
 * The cover leads whatever its sort order, because being the cover is a role
 * rather than a position. `id` is the final tie-breaker because duplicate
 * sort orders are legal — no unique constraint forbids them — and a gallery
 * with a non-deterministic order is one that moves under the reader.
 *
 * `room_type_id` is deliberately NOT prepended. This clause is the one the
 * admin path already uses, and it stays identical here so the public gallery
 * and the admin panel can never disagree about what order the images are in.
 * Rows for different room types may therefore interleave, which costs
 * nothing: `groupImagesByRoomTypeId` keys them into a Map, and a Map preserves
 * the relative order of the rows appended to each key.
 */
const ROOM_TYPE_IMAGE_ORDER = 'ORDER BY rti.is_cover DESC, rti.sort_order ASC, rti.id ASC';

function toRoomTypeRecord(row: RoomTypeRow, images: PublicRoomTypeImageRecord[]): RoomTypeRecord {
  return {
    slug: row.slug,
    name: row.name,
    shortDescription: row.short_description,
    description: row.description,
    capacity: row.capacity,
    bedType: row.bed_type,
    bedCount: row.bed_count,
    sizeSqm: row.size_sqm,
    view: row.view,
    baseNightlyRate: row.base_nightly_rate,
    currency: 'EGP',
    images,
  };
}

/**
 * Built field by field, never spread: the columns this row type carries are
 * already narrower than the tables behind it, and constructing the record
 * explicitly means a column added to the SELECT later cannot reach a response
 * just by existing.
 */
function toImageRecord(row: RoomTypeImageRow): PublicRoomTypeImageRecord {
  return {
    reference: row.reference,
    altText: row.alt_text,
    width: row.width,
    height: row.height,
    isCover: row.is_cover,
  };
}

function groupImagesByRoomTypeId(rows: RoomTypeImageRow[]): Map<string, PublicRoomTypeImageRecord[]> {
  const grouped = new Map<string, PublicRoomTypeImageRecord[]>();

  for (const row of rows) {
    const existing = grouped.get(row.room_type_id);

    if (existing) {
      existing.push(toImageRecord(row));
    } else {
      grouped.set(row.room_type_id, [toImageRecord(row)]);
    }
  }

  return grouped;
}

/**
 * Every image of every given room type, in ONE query.
 *
 * `IN ($1)` rather than a query per room type: the list endpoint
 * must cost two queries whether it returns three rooms or thirty. The
 * `(room_type_id, sort_order, id)` index the T03-B migration creates is what
 * makes that one query cheap.
 *
 * An empty id list short-circuits without querying at all — `ANY('{}')`
 * would be a correct but pointless round trip.
 */
async function findImagesByRoomTypeIds(
  roomTypeIds: string[],
): Promise<Map<string, PublicRoomTypeImageRecord[]>> {
  if (roomTypeIds.length === 0) {
    return new Map();
  }

  const { rows } = await queryable.query<RoomTypeImageRow>(
    `SELECT rti.room_type_id,
            ma.reference,
            rti.alt_text,
            ma.width,
            ma.height,
            rti.is_cover
       FROM room_type_images rti
       JOIN media_assets ma ON ma.id = rti.media_asset_id
      WHERE rti.room_type_id IN ($1)
      ${ROOM_TYPE_IMAGE_ORDER}`,
    [roomTypeIds],
  );

  return groupImagesByRoomTypeId(rows);
}

export async function findActiveRoomTypes(): Promise<RoomTypeRecord[]> {
  const { rows } = await queryable.query<RoomTypeRow>(
    `SELECT ${ROOM_TYPE_COLUMNS}
       FROM room_types
      WHERE is_active = true
      ORDER BY sort_order ASC, name ASC`,
  );

  // Two queries total, never one per room. With no rooms there is nothing to
  // ask about, so it stays at one.
  const imagesByRoomTypeId = await findImagesByRoomTypeIds(rows.map((row) => row.id));

  return rows.map((row) => toRoomTypeRecord(row, imagesByRoomTypeId.get(row.id) ?? []));
}

export async function findActiveRoomTypeBySlug(slug: string): Promise<RoomTypeRecord | null> {
  const { rows } = await queryable.query<RoomTypeRow>(
    `SELECT ${ROOM_TYPE_COLUMNS}
       FROM room_types
      WHERE slug = $1
        AND is_active = true`,
    [slug],
  );

  const row = rows[0];

  if (!row) {
    return null;
  }

  const imagesByRoomTypeId = await findImagesByRoomTypeIds([row.id]);

  return toRoomTypeRecord(row, imagesByRoomTypeId.get(row.id) ?? []);
}
