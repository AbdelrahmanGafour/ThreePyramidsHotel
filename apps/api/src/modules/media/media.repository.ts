import type { PoolClient } from '../../db/pool';
import { STORED_CONTENT_TYPE, type StoredContentType } from './media.types';

/**
 * Persistence for `media_assets`, and nothing else.
 *
 * Shared on purpose: room-type images come first and package images will
 * follow, and both describe the same stored objects. What differs between them
 * is which table joins an asset to an owner, not what an asset is.
 *
 * This file writes one table and reads one table. It does not know what an
 * asset is attached to, and it never joins to find out.
 *
 * Deliberately absent, because none of it is persistence: generating a
 * reference, building a storage key, decoding or normalizing an image,
 * uploading or deleting an object in R2, and composing a public URL. Every one
 * of those already lives somewhere, and a repository that also did them would
 * be the second place each rule is written.
 *
 * Every function takes the caller's `PoolClient` and runs inside whatever
 * transaction the caller opened. Nothing here begins, commits or rolls back,
 * and nothing acquires a client of its own.
 */

const INTERNAL_ID_PATTERN = /^[1-9]\d*$/;

/** Digits only, as a bigint rendered as text always is. */
const WHOLE_NUMBER_PATTERN = /^\d+$/;

/** As `media_assets_checksum_sha256_*_check` already guarantees. */
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The guards below protect against stored data that this schema's own
 * constraints say cannot exist. If one fires it is a data or migration
 * problem, so it raises rather than being softened into a default or a
 * silently coerced value.
 */
export function requireMediaText(column: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Unexpected media asset ${column} from the database: expected a non-empty value`);
  }

  return value;
}

export function requireMediaInstant(column: string, value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Unexpected media asset ${column} from the database: expected a timestamp`);
  }

  return value;
}

/**
 * An internal primary key, kept as the string the driver produced.
 *
 * Never converted to a number: `bigint` outruns exact integer arithmetic in
 * JavaScript, and a key that has been through a float may no longer identify
 * the row it came from. It exists to be carried back into the next query as a
 * parameter, and it must never reach an HTTP response — the public identity of
 * an image is its `reference` UUID.
 */
export function requireMediaInternalId(column: string, value: unknown): string {
  if (typeof value !== 'string' || !INTERNAL_ID_PATTERN.test(value)) {
    throw new Error(`Unexpected media asset ${column} from the database: expected an internal identifier`);
  }

  return value;
}

/**
 * A bigint counted or measured in the database, as a plain number.
 *
 * Read as text rather than `::int` so a value past `int4` is refused here
 * instead of raising a cast error inside PostgreSQL, and checked for exactness
 * so it can never arrive as an approximation.
 */
export function requireMediaWholeNumber(column: string, value: unknown): number {
  if (typeof value !== 'string' || !WHOLE_NUMBER_PATTERN.test(value)) {
    throw new Error(`Unexpected media asset ${column} from the database: expected a whole number`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Media asset ${column} exceeds exact integer arithmetic: ${value}`);
  }

  return parsed;
}

export function requireMediaPositiveInteger(column: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Unexpected media asset ${column} from the database: expected a positive integer`);
  }

  return value;
}

export function requireMediaChecksum(value: unknown): string {
  if (typeof value !== 'string' || !CHECKSUM_PATTERN.test(value)) {
    throw new Error('Unexpected media asset checksum from the database: expected 64 lowercase hex characters');
  }

  return value;
}

/**
 * The stored content type, re-proved rather than trusted.
 *
 * The column's CHECK admits only this one value, so this can only fail if the
 * constraint were dropped. Returning the branded constant rather than the
 * string from the row is what lets a `StoredContentType` leave a repository at
 * all without a cast appearing somewhere less visible.
 */
export function requireStoredContentType(value: unknown): StoredContentType {
  if (value !== STORED_CONTENT_TYPE) {
    throw new Error('Unexpected media asset content type from the database: expected the stored WebP type');
  }

  return STORED_CONTENT_TYPE;
}

/**
 * One stored object's metadata, exactly as the normalization pipeline
 * measured it.
 *
 * Every field is about the stored WebP: the digest is of the bytes that were
 * uploaded, and the dimensions are the stored image's after orientation and
 * resizing. The repository takes these as given — it does not compute, derive
 * or check any of them beyond what the columns already enforce.
 */
export type MediaAssetInsert = {
  reference: string;
  storageKey: string;
  contentType: StoredContentType;
  byteSize: number;
  checksumSha256: string;
  width: number;
  height: number;
};

/** An inserted asset, plus the internal id its owner row needs to reference it. */
export type MediaAssetRecord = MediaAssetInsert & {
  /** `media_assets.id`. Internal: it is a query parameter, never a response field. */
  mediaAssetId: string;
  createdAt: Date;
};

type MediaAssetRow = {
  id: string;
  reference: string;
  storage_key: string;
  content_type: string;
  byte_size: string;
  checksum_sha256: string;
  width: number;
  height: number;
  created_at: Date;
};

/**
 * Maps one row onto the asset record, field by field.
 *
 * Nothing is spread: what leaves this file is built here rather than inherited
 * from whatever the query happened to select, so a column added to the SELECT
 * later cannot reach a caller by accident.
 */
export function toMediaAssetRecord(row: MediaAssetRow): MediaAssetRecord {
  return {
    mediaAssetId: requireMediaInternalId('id', row.id),
    reference: requireMediaText('reference', row.reference),
    storageKey: requireMediaText('storage_key', row.storage_key),
    contentType: requireStoredContentType(row.content_type),
    byteSize: requireMediaWholeNumber('byte_size', row.byte_size),
    checksumSha256: requireMediaChecksum(row.checksum_sha256),
    width: requireMediaPositiveInteger('width', row.width),
    height: requireMediaPositiveInteger('height', row.height),
    createdAt: requireMediaInstant('created_at', row.created_at),
  };
}

/** The asset columns, selected the same way wherever an asset is read. */
export const MEDIA_ASSET_COLUMNS = `ma.id,
       ma.reference,
       ma.storage_key,
       ma.content_type,
       CAST(ma.byte_size AS CHAR) AS byte_size,
       ma.checksum_sha256,
       ma.width,
       ma.height,
       ma.created_at`;

/**
 * Records one stored object.
 *
 * Written before the owning relation row, because that relation's foreign key
 * requires this row to exist. Both belong in one transaction: an asset with no
 * owner is a row nothing can ever reach.
 *
 * `reference` and `storage_key` are supplied by the caller and stored
 * verbatim. This function does not generate either — the reference has to
 * exist in the application before the object is written to storage, which is
 * the only moment the key and the row can be made to agree.
 *
 * A duplicate reference or storage key raises SQLSTATE 23505 from PostgreSQL
 * and propagates untouched. That is not a condition to swallow: two rows
 * claiming the same object would mean two images sharing bytes that either
 * could later delete.
 */
export async function insertMediaAsset(
  client: PoolClient,
  input: MediaAssetInsert,
): Promise<MediaAssetRecord> {
  const inserted = await client.query(
    `INSERT INTO media_assets
       (reference, storage_key, content_type, byte_size, checksum_sha256, width, height)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.reference,
      input.storageKey,
      input.contentType,
      input.byteSize,
      input.checksumSha256,
      input.width,
      input.height,
    ],
  );

  if (!inserted.insertId) {
    throw new Error('Media asset insert returned no row');
  }

  const { rows } = await client.query<MediaAssetRow>(
    `SELECT ${MEDIA_ASSET_COLUMNS} FROM media_assets ma WHERE ma.id = $1`,
    [inserted.insertId],
  );

  const row = rows[0];

  if (!row) {
    throw new Error('Media asset insert returned no row');
  }

  return toMediaAssetRecord(row);
}

/**
 * Removes one stored object's metadata, by internal id.
 *
 * Only ever called after the relation that referenced it is gone: both foreign
 * keys are `ON DELETE RESTRICT`, so MySQL refuses this while any owner
 * row still points at the asset. That refusal is left to propagate rather than
 * caught — an asset that cannot be deleted because something still shows it is
 * exactly the situation a RESTRICT exists to make loud.
 *
 * Deleting the object itself from storage is not done here and must not be:
 * this runs inside a transaction that may still roll back, and an object
 * removed from R2 cannot be rolled back with it. The caller keeps the
 * `storageKey` and removes the object after the commit.
 */
export async function deleteMediaAssetById(client: PoolClient, mediaAssetId: string): Promise<boolean> {
  const { rowCount } = await client.query(`DELETE FROM media_assets WHERE id = $1`, [mediaAssetId]);

  return (rowCount ?? 0) > 0;
}
