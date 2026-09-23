import type { PoolClient } from 'pg';
import {
  MEDIA_ASSET_COLUMNS,
  requireMediaChecksum,
  requireMediaInstant,
  requireMediaInternalId,
  requireMediaPositiveInteger,
  requireMediaText,
  requireMediaWholeNumber,
  requireStoredContentType,
} from '../media/media.repository';
import type { MediaOrderDirection } from '../media/media.types';
import type {
  AdminRoomTypeImage,
  ResolvedRoomTypeForMedia,
  RoomTypeImageInsert,
  RoomTypeImageMoveResult,
  ScopedRoomTypeImage,
} from './admin-room-type-media.types';

/**
 * The images one room type shows, in PostgreSQL.
 *
 * Two tables are written: `room_type_images`, which is this module's own, and
 * nothing else. `media_assets` is read and joined here but written only by the
 * media repository, and `room_types` is read and locked but never written.
 *
 * ---------------------------------------------------------------------------
 * CANONICAL ROOM-TYPE MEDIA LOCK ORDER
 *
 *     room_types row  ->  room_type_images rows  ->  media_assets row
 *
 * The room type is the serialization point for every mutation in this
 * feature. A transaction that intends to change anything takes `FOR UPDATE` on
 * the parent first, and only then counts, inserts, reorders, re-covers or
 * deletes. Nothing here locks an image and then reaches upward for its parent.
 *
 * That order is what makes the twelve-image ceiling real rather than hopeful:
 * two uploads that both read a count of eleven would both be allowed, and the
 * thirteenth image would exist. Holding the parent row means the second
 * transaction cannot read the count until the first has committed its insert,
 * so it reads twelve and is refused. The rule itself lives in the service; the
 * lock is what makes the rule enforceable.
 *
 * It also has to agree with the rest of the admin area, which already takes
 * `room_types` before `rooms`. A transaction here that took its locks the
 * other way round could deadlock against an inventory edit or a guest booking.
 * No advisory locks are used, and no reservation or room locking is changed.
 * ---------------------------------------------------------------------------
 *
 * Every function takes the caller's `PoolClient` and participates in whatever
 * transaction the caller opened. Nothing here issues BEGIN, COMMIT or
 * ROLLBACK, nothing acquires a second client, and nothing creates a pool.
 *
 * Nothing here talks to object storage. A deletion removes rows and hands back
 * the key so the caller can remove the object after the commit.
 */

const NON_NEGATIVE_PATTERN = /^\d+$/;

function requireImageText(column: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Unexpected room-type image ${column} from the database: expected a non-empty value`);
  }

  return value;
}

function requireImageBoolean(column: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Unexpected room-type image ${column} from the database: expected a boolean`);
  }

  return value;
}

/** `sort_order` is `integer NOT NULL` with a `>= 0` CHECK. */
function requireSortOrder(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Unexpected room-type image sort_order from the database: expected a non-negative integer');
  }

  return value;
}

/** `alt_text` is nullable by design — a decorative image is a real case. */
function requireNullableText(column: string, value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`Unexpected room-type image ${column} from the database: expected text or null`);
  }

  return value;
}

function requireImageCount(value: unknown): number {
  if (typeof value !== 'string' || !NON_NEGATIVE_PATTERN.test(value)) {
    throw new Error(`Unexpected room-type image count from the database: ${String(value)}`);
  }

  const count = Number(value);

  if (!Number.isSafeInteger(count)) {
    throw new Error(`Room-type image count exceeds exact integer arithmetic: ${value}`);
  }

  return count;
}

// ---------------------------------------------------------------------------
// The room type: resolving it, and locking it
// ---------------------------------------------------------------------------

type ResolvedRoomTypeRow = { id: string; slug: string };

function toResolvedRoomTypeForMedia(row: ResolvedRoomTypeRow): ResolvedRoomTypeForMedia {
  return {
    roomTypeId: requireMediaInternalId('room_type id', row.id),
    slug: requireImageText('room type slug', row.slug),
  };
}

/**
 * The room type a slug names, without taking a lock.
 *
 * For reads. A gallery that is being listed does not need to serialize against
 * anything — the worst a concurrent edit can do is make the list a moment out
 * of date, which is what any list is.
 *
 * The slug is matched exactly and case-sensitively. Nothing is trimmed,
 * lower-cased or otherwise repaired: canonical-slug validation happens before
 * a request reaches persistence, and a value that needs tidying here is not
 * the value the database holds.
 *
 * Returns `null` when there is no such room type. It does not raise, and it
 * has no opinion about what HTTP status that becomes.
 */
export async function findRoomTypeForMedia(
  client: PoolClient,
  slug: string,
): Promise<ResolvedRoomTypeForMedia | null> {
  const { rows } = await client.query<ResolvedRoomTypeRow>(
    `SELECT rt.id, rt.slug
       FROM room_types rt
      WHERE rt.slug = $1`,
    [slug],
  );

  const row = rows[0];

  return row ? toResolvedRoomTypeForMedia(row) : null;
}

/**
 * The same lookup, holding the row for the rest of the caller's transaction.
 *
 * The FIRST lock of the canonical order, and the one every mutation in this
 * feature starts with. `FOR UPDATE` rather than a weaker mode because two
 * concurrent media edits must not interleave at all: the point is not to
 * protect the room type's own columns — none are written — but to make this
 * row the queue that every change to its images waits in.
 *
 * It conflicts with the admin capacity edit and the admin room edit, which
 * take `FOR UPDATE` on the same row, and with the booking path's
 * `FOR KEY SHARE`. That last one is intended: a booking holds a key share for
 * the length of its allocation, and a media edit that waits a few milliseconds
 * behind it costs nothing.
 *
 * Returns `null` when the room type does not exist, in which case no lock was
 * taken and there is nothing to release.
 */
export async function lockRoomTypeForMediaChange(
  client: PoolClient,
  slug: string,
): Promise<ResolvedRoomTypeForMedia | null> {
  const { rows } = await client.query<ResolvedRoomTypeRow>(
    `SELECT rt.id, rt.slug
       FROM room_types rt
      WHERE rt.slug = $1
        FOR UPDATE`,
    [slug],
  );

  const row = rows[0];

  return row ? toResolvedRoomTypeForMedia(row) : null;
}

// ---------------------------------------------------------------------------
// Counting, and where the next image goes
// ---------------------------------------------------------------------------

/**
 * How many images one room type has.
 *
 * RACE-SAFE ONLY AFTER `lockRoomTypeForMediaChange` in the same transaction.
 * Called without that lock it is a snapshot, true when it was read and
 * possibly false by the time anything is decided from it. That is fine for
 * display and useless for enforcement, which is the distinction the ceiling
 * depends on.
 *
 * Counted as text rather than `::int` so a count past `int4` would be refused
 * here rather than raise a cast error inside PostgreSQL.
 */
export async function countRoomTypeImages(client: PoolClient, roomTypeId: string): Promise<number> {
  const { rows } = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM room_type_images rti
      WHERE rti.room_type_id = $1`,
    [roomTypeId],
  );

  const row = rows[0];

  if (!row) {
    throw new Error('Room-type image count returned no row');
  }

  return requireImageCount(row.total);
}

/**
 * The sort order a newly added image should take.
 *
 * `MAX(sort_order) + 1`, not `COUNT(*)`. Those are the same number only while
 * the orders happen to be contiguous, and they are not required to be:
 * duplicates are legal, and a deletion leaves a gap until something compacts
 * it. Deriving the next order from a count would eventually place a new image
 * on top of an existing one — legal to the schema, and wrong to a reader.
 *
 * An empty room type yields 0, because `COALESCE(MAX(...), -1) + 1` is 0.
 *
 * RACE-SAFE ONLY AFTER `lockRoomTypeForMediaChange` in the same transaction,
 * for the same reason as the count: two inserts that both read the same
 * maximum would both claim it.
 */
export async function nextRoomTypeImageSortOrder(client: PoolClient, roomTypeId: string): Promise<number> {
  const { rows } = await client.query<{ next_order: number }>(
    `SELECT COALESCE(MAX(rti.sort_order), -1) + 1 AS next_order
       FROM room_type_images rti
      WHERE rti.room_type_id = $1`,
    [roomTypeId],
  );

  const row = rows[0];

  if (!row) {
    throw new Error('Room-type image sort order returned no row');
  }

  return requireSortOrder(row.next_order);
}

// ---------------------------------------------------------------------------
// Inserting
// ---------------------------------------------------------------------------

/**
 * Attaches one asset to one room type.
 *
 * Every value is the caller's. This function does not decide whether the image
 * is the cover, and it does not derive its sort order — a repository that
 * quietly chose either would be making a product decision inside a statement,
 * and the first image of a room type being its cover is exactly that kind of
 * decision. `nextRoomTypeImageSortOrder` exists for callers that want the
 * usual answer, and is named for what it computes rather than being folded in
 * here.
 *
 * A second cover for the same room type raises SQLSTATE 23505 from the partial
 * unique index and propagates untouched.
 */
export async function insertRoomTypeImage(
  client: PoolClient,
  input: RoomTypeImageInsert,
): Promise<ScopedRoomTypeImage> {
  const { rows } = await client.query<ScopedImageRow>(
    `WITH inserted AS (
       INSERT INTO room_type_images (room_type_id, media_asset_id, alt_text, sort_order, is_cover)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, media_asset_id, sort_order, is_cover
     )
     SELECT inserted.id,
            inserted.media_asset_id,
            inserted.sort_order,
            inserted.is_cover,
            ma.reference,
            ma.storage_key
       FROM inserted
       JOIN media_assets ma ON ma.id = inserted.media_asset_id`,
    [input.roomTypeId, input.mediaAssetId, input.altText, input.sortOrder, input.isCover],
  );

  const row = rows[0];

  if (!row) {
    throw new Error('Room-type image insert returned no row');
  }

  return toScopedRoomTypeImage(row);
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

type RoomTypeImageRow = {
  reference: string;
  storage_key: string;
  content_type: string;
  byte_size: string;
  checksum_sha256: string;
  width: number;
  height: number;
  alt_text: string | null;
  sort_order: number;
  is_cover: boolean;
  created_at: Date;
  updated_at: Date;
};

/**
 * Maps one joined row onto the image contract, field by field.
 *
 * Nothing is spread, and neither internal id is read: the shape that leaves
 * this file is built here, so a key cannot reach a response by later being
 * added to a SELECT.
 *
 * The timestamps are the relation's, not the asset's. An asset is immutable
 * and its `created_at` never moves; what an administrator cares about is when
 * this image was added to this room type and when its placement last changed.
 */
export function toAdminRoomTypeImage(row: RoomTypeImageRow): AdminRoomTypeImage {
  return {
    reference: requireMediaText('reference', row.reference),
    storageKey: requireMediaText('storage_key', row.storage_key),
    contentType: requireStoredContentType(row.content_type),
    byteSize: requireMediaWholeNumber('byte_size', row.byte_size),
    checksumSha256: requireMediaChecksum(row.checksum_sha256),
    width: requireMediaPositiveInteger('width', row.width),
    height: requireMediaPositiveInteger('height', row.height),
    altText: requireNullableText('alt_text', row.alt_text),
    sortOrder: requireSortOrder(row.sort_order),
    isCover: requireImageBoolean('is_cover', row.is_cover),
    createdAt: requireMediaInstant('created_at', row.created_at).toISOString(),
    updatedAt: requireMediaInstant('updated_at', row.updated_at).toISOString(),
  };
}

/**
 * Every image of one room type, in the order a gallery shows them.
 *
 *     is_cover DESC, sort_order ASC, room_type_images.id ASC
 *
 * The cover comes first whatever its sort order, because the cover is a role
 * rather than a position. Making it lead by *moving* it to `sort_order = 0`
 * would rewrite the sequence an administrator arranged every time they changed
 * which image is the cover, and would silently lose that arrangement. So the
 * two are independent: ordering says how the gallery reads, the cover says
 * which one represents the room, and neither is expressed in terms of the
 * other.
 *
 * `id` is the final tie-breaker because duplicate sort orders are legal — no
 * unique constraint forbids them — and a list with a non-deterministic order
 * is a list that moves under the reader.
 *
 * Scoped to one room type by the WHERE clause, so another room type's images
 * cannot appear whatever their ids or orders.
 */
export async function listRoomTypeImages(
  client: PoolClient,
  roomTypeId: string,
): Promise<AdminRoomTypeImage[]> {
  const { rows } = await client.query<RoomTypeImageRow>(
    `SELECT ma.reference,
            ma.storage_key,
            ma.content_type,
            ma.byte_size::text AS byte_size,
            ma.checksum_sha256,
            ma.width,
            ma.height,
            rti.alt_text,
            rti.sort_order,
            rti.is_cover,
            rti.created_at,
            rti.updated_at
       FROM room_type_images rti
       JOIN media_assets ma ON ma.id = rti.media_asset_id
      WHERE rti.room_type_id = $1
      ORDER BY rti.is_cover DESC, rti.sort_order ASC, rti.id ASC`,
    [roomTypeId],
  );

  return rows.map(toAdminRoomTypeImage);
}

// ---------------------------------------------------------------------------
// Finding one image, inside its room type
// ---------------------------------------------------------------------------

type ScopedImageRow = {
  id: string;
  media_asset_id: string;
  reference: string;
  storage_key: string;
  sort_order: number;
  is_cover: boolean;
};

function toScopedRoomTypeImage(row: ScopedImageRow): ScopedRoomTypeImage {
  return {
    imageId: requireMediaInternalId('room_type_images id', row.id),
    mediaAssetId: requireMediaInternalId('media_asset_id', row.media_asset_id),
    reference: requireMediaText('reference', row.reference),
    storageKey: requireMediaText('storage_key', row.storage_key),
    sortOrder: requireSortOrder(row.sort_order),
    isCover: requireImageBoolean('is_cover', row.is_cover),
  };
}

const SCOPED_IMAGE_SELECT = `SELECT rti.id,
            rti.media_asset_id,
            ma.reference,
            ma.storage_key,
            rti.sort_order,
            rti.is_cover
       FROM room_type_images rti
       JOIN media_assets ma ON ma.id = rti.media_asset_id
      WHERE rti.room_type_id = $1
        AND ma.reference = $2`;

/**
 * One image, addressed by the room type it belongs to AND its reference.
 *
 * ------------------------------------------------------------------------
 * THIS IS THE AUTHORIZATION BOUNDARY FOR ROOM-TYPE MEDIA.
 *
 * Both values are in the WHERE clause of one query. There is deliberately no
 * function here that resolves an image by reference alone, because the moment
 * one existed, a caller could resolve an image and then check its owner — and
 * a check that can be forgotten eventually is. A reference belonging to a
 * different room type simply does not match, so it returns `null` by the same
 * path a reference that never existed does.
 *
 * `null` means all three of: no such reference anywhere, a reference whose
 * asset belongs to another room type, and a reference with no relation row.
 * They are deliberately indistinguishable — telling them apart would let a
 * caller enumerate which image references exist under room types that are not
 * theirs.
 * ------------------------------------------------------------------------
 *
 * Unlocked. For reads, and for a caller that only needs to know whether the
 * image is there.
 */
export async function findScopedRoomTypeImage(
  client: PoolClient,
  roomTypeId: string,
  reference: string,
): Promise<ScopedRoomTypeImage | null> {
  const { rows } = await client.query<ScopedImageRow>(SCOPED_IMAGE_SELECT, [roomTypeId, reference]);

  const row = rows[0];

  return row ? toScopedRoomTypeImage(row) : null;
}

/**
 * The same scoped lookup, holding the relation row.
 *
 * The SECOND lock of the canonical order, and it must follow
 * `lockRoomTypeForMediaChange` on the parent in the same transaction.
 *
 * `FOR UPDATE OF rti` locks the relation and deliberately not the asset: the
 * join to `media_assets` is there to read the reference and the key, and
 * locking every asset a query touches would take locks in an order this
 * feature has not declared. The asset row is reached only by the later DELETE,
 * which takes its own lock at that point — still after the parent, still after
 * the relation.
 */
export async function lockScopedRoomTypeImage(
  client: PoolClient,
  roomTypeId: string,
  reference: string,
): Promise<ScopedRoomTypeImage | null> {
  const { rows } = await client.query<ScopedImageRow>(`${SCOPED_IMAGE_SELECT}\n        FOR UPDATE OF rti`, [
    roomTypeId,
    reference,
  ]);

  const row = rows[0];

  return row ? toScopedRoomTypeImage(row) : null;
}

// ---------------------------------------------------------------------------
// Alt text
// ---------------------------------------------------------------------------

/**
 * Replaces one image's alt text.
 *
 * The value arrives already normalized — trimmed, or turned into `null` if it
 * was absent, empty or whitespace. None of that happens here: a repository
 * that also normalized would be the second place the rule is written, and the
 * two would drift.
 *
 * Addressed by `room_type_images.id`, which the caller obtained from a scoped
 * lookup, so ownership was established before this statement was reached. The
 * room type is named again in the WHERE clause anyway — it costs nothing, and
 * it means no statement in this file can affect a row outside the room type it
 * was called for, even if a caller passed an id it got from somewhere else.
 *
 * Returns whether exactly one row changed, so the caller can tell an applied
 * edit from one that addressed a row which is no longer there.
 */
export async function updateRoomTypeImageAltText(
  client: PoolClient,
  roomTypeId: string,
  imageId: string,
  altText: string | null,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE room_type_images
        SET alt_text = $3,
            updated_at = now()
      WHERE id = $2
        AND room_type_id = $1`,
    [roomTypeId, imageId, altText],
  );

  return rowCount === 1;
}

// ---------------------------------------------------------------------------
// The cover
// ---------------------------------------------------------------------------

/**
 * Makes one image the room type's cover, and the only one.
 *
 * Two statements, in this order, inside the caller's transaction:
 *
 *   1. clear the cover flag on every OTHER image of this room type
 *   2. set it on the target, if it is not already set
 *
 * That sequence never holds two covers at once, so
 * `room_type_images_cover_key` — a unique index on `(room_type_id) WHERE
 * is_cover` — is never transiently violated. The obvious single statement,
 * `SET is_cover = (id = $2)`, is avoided deliberately: PostgreSQL gives no
 * guarantee about the order in which it updates rows, so it may set the new
 * cover before clearing the old one and trip the index on a row it is about to
 * fix.
 *
 * `AND id <> $2` in the first statement is what makes this idempotent. Asking
 * for the current cover to become the cover changes nothing and moves no
 * `updated_at`, because a row whose cover state does not change is not a row
 * that was edited.
 *
 * Both statements name the room type, so another room type's cover cannot be
 * cleared or set from here.
 *
 * The caller must already hold the parent lock, and must already have proven
 * the target belongs to this room type — this function will not do it, and
 * `id <> $2` would otherwise clear a cover in exchange for setting nothing.
 */
export async function setRoomTypeImageAsCover(
  client: PoolClient,
  roomTypeId: string,
  imageId: string,
): Promise<boolean> {
  const cleared = await client.query(
    `UPDATE room_type_images
        SET is_cover = false,
            updated_at = now()
      WHERE room_type_id = $1
        AND is_cover
        AND id <> $2`,
    [roomTypeId, imageId],
  );

  const promoted = await client.query(
    `UPDATE room_type_images
        SET is_cover = true,
            updated_at = now()
      WHERE id = $2
        AND room_type_id = $1
        AND NOT is_cover`,
    [roomTypeId, imageId],
  );

  return (cleared.rowCount ?? 0) > 0 || (promoted.rowCount ?? 0) > 0;
}

/**
 * The image that should lead a room type's gallery when the cover is gone.
 *
 * `sort_order ASC, id ASC` — the same order the list uses once the cover is
 * taken out of it, so the replacement is the one a reader would already have
 * seen first. Deterministic rather than arbitrary: two administrators deleting
 * the same cover in either order end up with the same new cover.
 *
 * Returns `null` when the room type has no images left, which is the state
 * where zero covers is correct.
 */
export async function findFirstRoomTypeImageId(
  client: PoolClient,
  roomTypeId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT rti.id
       FROM room_type_images rti
      WHERE rti.room_type_id = $1
      ORDER BY rti.sort_order ASC, rti.id ASC
      LIMIT 1`,
    [roomTypeId],
  );

  const row = rows[0];

  return row ? requireMediaInternalId('room_type_images id', row.id) : null;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

type OrderedImageRow = { id: string; sort_order: number; reference: string };

/**
 * Moves one image one place towards the front or the back of its gallery.
 *
 * Not an increment. `sort_order - 1` would do nothing at all when the
 * neighbour shares the same value, and duplicate sort orders are legal here —
 * nothing forbids them, and a fresh room type can easily hold several. So the
 * move is expressed against the *order*, not against the number:
 *
 *   1. read this room type's relations in `sort_order ASC, id ASC`, locking
 *      them with `FOR UPDATE OF rti`
 *   2. find the target's position in that sequence
 *   3. swap it with the neighbour one place away
 *   4. rewrite the whole sequence to a contiguous 0..N-1
 *
 * Compaction is affordable — a room type holds at most twelve images — and it
 * makes the result independent of whatever the orders were before, including
 * gaps a deletion left and duplicates an insert never resolved. After it, a
 * row's position *is* its sort order, which is why step 4 can safely skip rows
 * whose value already matches: two rows can no longer share one.
 *
 * `updated_at` moves only where `sort_order` actually changes. A row that ends
 * up where it started was not edited.
 *
 * `is_cover` is not read and not written. Which image leads the gallery is a
 * separate question from what order the rest are in, and moving an image must
 * not quietly promote or demote it.
 *
 * Every statement names the room type, so no other room type's ordering can be
 * touched. The parent lock must already be held.
 */
export async function moveRoomTypeImage(
  client: PoolClient,
  roomTypeId: string,
  reference: string,
  direction: MediaOrderDirection,
): Promise<RoomTypeImageMoveResult> {
  const { rows } = await client.query<OrderedImageRow>(
    `SELECT rti.id, rti.sort_order, ma.reference
       FROM room_type_images rti
       JOIN media_assets ma ON ma.id = rti.media_asset_id
      WHERE rti.room_type_id = $1
      ORDER BY rti.sort_order ASC, rti.id ASC
        FOR UPDATE OF rti`,
    [roomTypeId],
  );

  const ordered = rows.map((row) => ({
    id: requireMediaInternalId('room_type_images id', row.id),
    sortOrder: requireSortOrder(row.sort_order),
    reference: requireMediaText('reference', row.reference),
  }));

  const index = ordered.findIndex((image) => image.reference === reference);

  if (index === -1) {
    return { outcome: 'not-found' };
  }

  const destination = direction === 'up' ? index - 1 : index + 1;

  if (destination < 0 || destination >= ordered.length) {
    // The first image cannot move up and the last cannot move down. Asking for
    // it is not a mistake and not a failure — it is a request for something
    // already true.
    return { outcome: 'boundary' };
  }

  const moved = [...ordered];
  const [target] = moved.splice(index, 1);

  moved.splice(destination, 0, target!);

  for (const [position, image] of moved.entries()) {
    if (image.sortOrder === position) {
      continue;
    }

    await client.query(
      `UPDATE room_type_images
          SET sort_order = $3,
              updated_at = now()
        WHERE id = $2
          AND room_type_id = $1`,
      [roomTypeId, image.id, position],
    );
  }

  return { outcome: 'moved' };
}

/**
 * Rewrites a room type's sort orders to a contiguous 0..N-1, keeping the
 * order they already read in.
 *
 * For after a deletion, which leaves a gap. The gap is harmless — the list
 * orders by value and then by id, so it reads correctly either way — but
 * letting gaps accumulate makes the stored numbers steadily less meaningful to
 * anyone looking at them, and makes `MAX + 1` grow without bound.
 *
 * One statement. `ROW_NUMBER()` over the same ordering the gallery uses, and
 * rows whose value is already right are left alone, so `updated_at` moves only
 * where the order did.
 *
 * Returns how many rows were renumbered. The parent lock must already be held.
 */
export async function compactRoomTypeImageOrder(client: PoolClient, roomTypeId: string): Promise<number> {
  const { rowCount } = await client.query(
    `WITH ordered AS (
       SELECT rti.id,
              (ROW_NUMBER() OVER (ORDER BY rti.sort_order ASC, rti.id ASC) - 1)::int AS position
         FROM room_type_images rti
        WHERE rti.room_type_id = $1
     )
     UPDATE room_type_images rti
        SET sort_order = ordered.position,
            updated_at = now()
       FROM ordered
      WHERE rti.id = ordered.id
        AND rti.room_type_id = $1
        AND rti.sort_order <> ordered.position`,
    [roomTypeId],
  );

  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

/**
 * Removes one image's relation to its room type.
 *
 * The asset row survives this and is deleted separately, by the media
 * repository, once nothing references it. Both foreign keys are RESTRICT, so
 * the order is not a preference — PostgreSQL refuses the other one.
 *
 * The room type is named alongside the id for the same reason as everywhere
 * else in this file: a statement that can only affect the room type it was
 * called for cannot be made to affect another by passing the wrong key.
 *
 * Returns whether exactly one relation was removed. It does not promote a new
 * cover and it does not renumber what is left — both are separate decisions
 * with their own functions, and neither belongs inside a DELETE.
 *
 * Nothing is removed from object storage here. This runs inside a transaction
 * that may still roll back, and a deleted R2 object cannot roll back with it.
 */
export async function deleteRoomTypeImageRelation(
  client: PoolClient,
  roomTypeId: string,
  imageId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `DELETE FROM room_type_images
      WHERE id = $2
        AND room_type_id = $1`,
    [roomTypeId, imageId],
  );

  return rowCount === 1;
}
