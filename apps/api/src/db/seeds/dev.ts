// ═══════════════════════════════════════════════════════════════════════════
// DEVELOPMENT-ONLY SEED — TEMPORARY PLACEHOLDER DATA.
// None of this is real hotel content: the room types, rates, sizes, views and
// room numbers below exist only so the API can be developed and reviewed
// against a populated database. Replace every value with real hotel data
// before this is used anywhere but local development.
//
// Safe to re-run: room types are upserted by slug and physical rooms are only
// inserted when their room number does not already exist. Nothing is deleted,
// and reservations are never touched.
//
// Dev-seed compatibility: the room concepts below were originally seeded
// under `demo-standard`/`demo-deluxe`/`demo-suite` before being renamed to
// the canonical `room-concept-0N` slugs (see `legacySlug` on each entry).
// A database still holding a row under the old slug has that row RENAMED in
// place (same id, so every room/reservation FK into it stays valid) rather
// than a second row being inserted for the same inventory — see
// `seed-reconciliation.ts` for the decision logic, and `resolveRoomTypeId`
// below for the actual queries.
// ═══════════════════════════════════════════════════════════════════════════

import type { PoolClient } from '../pool';
import { closeDatabasePool, dbPool } from '../pool';
import { decideSeedReconciliation } from './seed-reconciliation';

type DemoRoomType = {
  slug: string;
  /** The pre-rename slug this concept was originally seeded under, if any. */
  legacySlug?: string;
  name: string;
  shortDescription: string;
  description: string;
  capacity: number;
  bedType: string;
  bedCount: number;
  sizeSqm: number;
  view: string;
  baseNightlyRate: number;
  sortOrder: number;
  roomNumbers: string[];
};

// Slugs and provisional facts below are aligned with the frontend's existing
// room concepts (apps/web/features/rooms/data/roomsData.ts) so both sides
// refer to the same development room identities, with no translation layer
// between them. These remain PROVISIONAL DEVELOPMENT CONTENT, not confirmed
// hotel facts: `description` duplicates the frontend's editorial description
// (there is no second approved backend-owned long-description source yet),
// and `baseNightlyRate`/`roomNumbers` are unchanged, backend-only development
// placeholders — never derived from the frontend's demo USD prices.
/** DEMO — placeholder room types and their placeholder physical rooms. */
const DEMO_ROOM_TYPES: DemoRoomType[] = [
  {
    slug: 'room-concept-01',
    legacySlug: 'demo-standard',
    name: 'Room concept 01',
    shortDescription: 'Linen, warm stone, and a shaded outlook arranged for quiet mornings.',
    description: 'Linen, warm stone, and a shaded outlook arranged for quiet mornings.',
    capacity: 2,
    bedType: 'Queen bed',
    bedCount: 1,
    sizeSqm: 30,
    view: 'Courtyard view',
    baseNightlyRate: 1000,
    sortOrder: 1,
    roomNumbers: ['D-101', 'D-102'],
  },
  {
    slug: 'room-concept-02',
    legacySlug: 'demo-deluxe',
    name: 'Room concept 02',
    shortDescription: 'An upper-floor suite with softened evening light and a private place to pause.',
    description: 'An upper-floor suite with softened evening light and a private place to pause.',
    capacity: 2,
    bedType: 'King bed',
    bedCount: 1,
    sizeSqm: 42,
    view: 'Terrace & plateau view',
    baseNightlyRate: 1500,
    sortOrder: 2,
    roomNumbers: ['D-201', 'D-202'],
  },
  {
    slug: 'room-concept-03',
    legacySlug: 'demo-suite',
    name: 'Room concept 03',
    shortDescription: 'A composed family room with stone texture, low light, and room to settle.',
    description: 'A composed family room with stone texture, low light, and room to settle.',
    capacity: 3,
    bedType: 'Queen bed + daybed',
    bedCount: 2,
    sizeSqm: 38,
    view: 'Courtyard view',
    baseNightlyRate: 2000,
    sortOrder: 3,
    roomNumbers: ['D-301', 'D-302'],
  },
];

/**
 * Resolves the id to seed physical rooms against for one room-type concept,
 * reconciling it with a legacy demo-* row first when one exists.
 *
 * - Neither the canonical nor the legacy slug exists: plain insert.
 * - The canonical slug already exists (fresh or previously migrated):
 *   idempotent upsert-by-slug, same as before.
 * - Only the legacy slug exists: the EXISTING row is renamed/updated to the
 *   canonical slug/content in place — same id, so `rooms.room_type_id` and
 *   `reservations.room_type_id` referencing it stay exactly as they were.
 * - Both exist: `decideSeedReconciliation` throws `AmbiguousSeedStateError`
 *   rather than guessing which one owns the live rooms.
 */
async function resolveRoomTypeId(client: PoolClient, roomType: DemoRoomType): Promise<string> {
  const legacySlug = roomType.legacySlug;

  const { rows: canonicalRows } = await client.query<{ id: string }>('SELECT id FROM room_types WHERE slug = $1', [
    roomType.slug,
  ]);
  const legacyRows = legacySlug
    ? (await client.query<{ id: string }>('SELECT id FROM room_types WHERE slug = $1', [legacySlug])).rows
    : [];

  const action = decideSeedReconciliation({
    canonicalSlug: roomType.slug,
    legacySlug: legacySlug ?? '',
    canonicalExists: canonicalRows.length > 0,
    legacyExists: legacyRows.length > 0,
  });

  if (action === 'migrate-legacy') {
    // `is_active` deliberately left out, same reasoning as the upsert below.
    const { rows } = await client.query<{ id: string }>(
      `UPDATE room_types SET
         slug = $2, name = $3, short_description = $4, description = $5, capacity = $6,
         bed_type = $7, bed_count = $8, size_sqm = $9, view = $10, base_nightly_rate = $11,
         sort_order = $12, updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [
        legacyRows[0]!.id,
        roomType.slug,
        roomType.name,
        roomType.shortDescription,
        roomType.description,
        roomType.capacity,
        roomType.bedType,
        roomType.bedCount,
        roomType.sizeSqm,
        roomType.view,
        roomType.baseNightlyRate,
        roomType.sortOrder,
      ],
    );

    const roomTypeId = rows[0]?.id;
    if (!roomTypeId) {
      throw new Error(`Failed to migrate legacy room type '${legacySlug}' to '${roomType.slug}'`);
    }
    return roomTypeId;
  }

  // `is_active` is deliberately left out of the update so re-seeding never
  // reactivates a room type someone deactivated on purpose.
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO room_types (
       slug, name, short_description, description, capacity,
       bed_type, bed_count, size_sqm, view, base_nightly_rate, sort_order
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       short_description = EXCLUDED.short_description,
       description = EXCLUDED.description,
       capacity = EXCLUDED.capacity,
       bed_type = EXCLUDED.bed_type,
       bed_count = EXCLUDED.bed_count,
       size_sqm = EXCLUDED.size_sqm,
       view = EXCLUDED.view,
       base_nightly_rate = EXCLUDED.base_nightly_rate,
       sort_order = EXCLUDED.sort_order,
       updated_at = now()
     RETURNING id`,
    [
      roomType.slug,
      roomType.name,
      roomType.shortDescription,
      roomType.description,
      roomType.capacity,
      roomType.bedType,
      roomType.bedCount,
      roomType.sizeSqm,
      roomType.view,
      roomType.baseNightlyRate,
      roomType.sortOrder,
    ],
  );

  const roomTypeId = rows[0]?.id;
  if (!roomTypeId) {
    throw new Error(`Failed to upsert demo room type: ${roomType.slug}`);
  }
  return roomTypeId;
}

async function seed(): Promise<void> {
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');

    for (const roomType of DEMO_ROOM_TYPES) {
      const roomTypeId = await resolveRoomTypeId(client, roomType);

      for (const roomNumber of roomType.roomNumbers) {
        // An existing room number is left exactly as it is — this never
        // reassigns a physical room to a different room type.
        await client.query(
          `INSERT INTO rooms (room_type_id, room_number)
           VALUES ($1, $2)
           ON CONFLICT (room_number) DO NOTHING`,
          [roomTypeId, roomNumber],
        );

        // DO NOTHING hides the case where this room number already belongs to
        // a different room type, which would leave the seed quietly
        // inconsistent. Verify the allocation instead of reassigning it.
        const { rows: roomRows } = await client.query<{ room_type_id: string }>(
          `SELECT room_type_id FROM rooms WHERE room_number = $1`,
          [roomNumber],
        );

        const existingRoom = roomRows[0];
        if (!existingRoom) {
          throw new Error(`Development seed conflict: room ${roomNumber} could not be found after insert`);
        }
        if (existingRoom.room_type_id !== roomTypeId) {
          throw new Error(`Development seed conflict: room ${roomNumber} already belongs to another room type`);
        }
      }
    }

    await client.query('COMMIT');
    console.log(
      `Development seed applied: ${DEMO_ROOM_TYPES.length} placeholder room types, ` +
        `${DEMO_ROOM_TYPES.reduce((total, roomType) => total + roomType.roomNumbers.length, 0)} placeholder rooms.`,
    );
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to roll back development seed:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .then(async () => {
    await closeDatabasePool();
  })
  .catch(async (error) => {
    console.error('Development seed failed:', error);

    try {
      await closeDatabasePool();
    } catch (closeError) {
      console.error('Failed to close database pool:', closeError);
    }

    process.exit(1);
  });
