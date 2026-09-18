import { dbPool } from '../../db/pool';
import type { RoomTypeResponse } from './rooms.types';

type RoomTypeRow = {
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

// Listed explicitly (never SELECT *) so internal columns can't leak into responses.
const ROOM_TYPE_COLUMNS = `slug,
       name,
       short_description,
       description,
       capacity,
       bed_type,
       bed_count,
       size_sqm,
       view,
       base_nightly_rate`;

function toRoomTypeResponse(row: RoomTypeRow): RoomTypeResponse {
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
  };
}

export async function findActiveRoomTypes(): Promise<RoomTypeResponse[]> {
  const { rows } = await dbPool.query<RoomTypeRow>(
    `SELECT ${ROOM_TYPE_COLUMNS}
       FROM room_types
      WHERE is_active = true
      ORDER BY sort_order ASC, name ASC`,
  );

  return rows.map(toRoomTypeResponse);
}

export async function findActiveRoomTypeBySlug(slug: string): Promise<RoomTypeResponse | null> {
  const { rows } = await dbPool.query<RoomTypeRow>(
    `SELECT ${ROOM_TYPE_COLUMNS}
       FROM room_types
      WHERE slug = $1
        AND is_active = true`,
    [slug],
  );

  const row = rows[0];

  return row ? toRoomTypeResponse(row) : null;
}
