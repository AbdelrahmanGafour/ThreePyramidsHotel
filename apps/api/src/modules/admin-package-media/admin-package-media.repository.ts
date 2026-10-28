import type { PoolClient } from '../../db/pool';
import type { AdminPackageImage } from './admin-package-media.types';

// Persistence for `package_media`, and nothing else.
//
// Every function takes the caller's `PoolClient` and runs inside whatever
// transaction the caller opened. Nothing here begins, commits or rolls back,
// and nothing acquires a client of its own.
//
// Deliberately absent, because none of it is persistence: generating a media
// reference, building a storage key, decoding or normalizing an image,
// putting or deleting an object in R2, and composing a public URL. Every one
// of those already lives somewhere, and a repository that also did them
// would be the second place each rule is written.
//
// `media_assets` is not written here either. It is shared with room-type
// images and has its own repository; this file only ever joins to it and
// names its id.

const INTERNAL_ID_PATTERN = /^[1-9]\d*$/;

/**
 * Guards against stored data this schema's own constraints say cannot exist.
 * If one fires it is a data or migration problem, so it raises rather than
 * being softened into a default.
 */
function requirePackageMediaText(column: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Unexpected package media ${column} from the database: expected a non-empty value`);
  }

  return value;
}

function requirePackageMediaId(column: string, value: unknown): string {
  if (typeof value !== 'string' || !INTERNAL_ID_PATTERN.test(value)) {
    throw new Error(`Unexpected package media ${column} from the database: expected an internal identifier`);
  }

  return value;
}

function requirePackageMediaPositiveInteger(column: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Unexpected package media ${column} from the database: expected a positive integer`);
  }

  return value;
}

/** A journey, identified for a media change. Internal ids never leave a service. */
export type LockedPackage = { packageId: string };

/**
 * Locks the journey row, and returns its internal id.
 *
 * THE serialization point for every journey media mutation, and the first
 * statement of every one of them. Two uploads, an upload and a delete, a
 * replacement and a hard delete — all of them queue here, which is what
 * makes the `package_media` read that follows an answer rather than a guess.
 *
 * `FOR UPDATE` on `packages`, exactly as `deleteAdminPackage` and every other
 * admin journey write already takes it. There is no second lock ordering in
 * this system and this file does not introduce one.
 */
export async function lockPackageForMediaChange(
  client: PoolClient,
  slug: string,
): Promise<LockedPackage | null> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM packages WHERE slug = $1 FOR UPDATE',
    [slug],
  );

  const row = rows[0];

  return row ? { packageId: requirePackageMediaId('id', row.id) } : null;
}

/**
 * The journey's current image, as the transaction that will change it needs
 * to know it.
 *
 * Read only under the lock above. `storageKey` is the object the caller will
 * remove after the commit; `mediaAssetId` is the row that has to go with the
 * relation; `altText` is what a replacement must preserve.
 */
export type ExistingPackageImage = {
  mediaAssetId: string;
  reference: string;
  storageKey: string;
  altText: string | null;
};

export async function findPackageImageForUpdate(
  client: PoolClient,
  packageId: string,
): Promise<ExistingPackageImage | null> {
  const { rows } = await client.query<{
    media_asset_id: string;
    reference: string;
    storage_key: string;
    alt_text: string | null;
  }>(
    `SELECT pm.media_asset_id,
            ma.reference,
            ma.storage_key,
            pm.alt_text
       FROM package_media pm
       JOIN media_assets ma ON ma.id = pm.media_asset_id
      WHERE pm.package_id = $1`,
    [packageId],
  );

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    mediaAssetId: requirePackageMediaId('media_asset_id', row.media_asset_id),
    reference: requirePackageMediaText('reference', row.reference),
    storageKey: requirePackageMediaText('storage_key', row.storage_key),
    altText: row.alt_text,
  };
}

/**
 * Places one asset as a journey's image.
 *
 * `alt_text` is always NULL: the upload carries bytes and a content type, and
 * nothing else. A description is written afterwards, through its own route.
 *
 * A second row for the same journey raises SQLSTATE 23505 from
 * `package_media_package_id_key` and propagates untouched. The service checks
 * first, under the lock, so reaching that is a bug rather than a race — and
 * the constraint is what makes it a loud one.
 */
export async function insertPackageMedia(
  client: PoolClient,
  input: { packageId: string; mediaAssetId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO package_media (package_id, media_asset_id, alt_text)
     VALUES ($1, $2, NULL)`,
    [input.packageId, input.mediaAssetId],
  );
}

/**
 * Points the journey's existing relation at a different asset.
 *
 * The whole of a replacement's write, and the reason a replacement needs no
 * delete-then-insert: the row keeps its identity, its `created_at` and — the
 * part that matters to an administrator — its `alt_text`, which is
 * deliberately not in the SET list. Replacing the picture does not discard
 * the description somebody wrote for it.
 *
 * Must be called only after the new asset row exists: the foreign key is
 * checked immediately, not deferred.
 */
export async function repointPackageMedia(
  client: PoolClient,
  input: { packageId: string; mediaAssetId: string },
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE package_media
        SET media_asset_id = $2,
            updated_at = now()
      WHERE package_id = $1`,
    [input.packageId, input.mediaAssetId],
  );

  return (rowCount ?? 0) > 0;
}

/**
 * Writes the journey image's description, and nothing else.
 *
 * `media_asset_id` is deliberately not in the SET list: describing a picture
 * must not be able to change which picture it is. `updated_at` moves,
 * because the row really did change.
 *
 * `altText` arrives already normalized by the shared `normalizeAltText` —
 * trimmed, or `null` for absent, empty and whitespace-only alike. This
 * function stores what it is handed and judges none of it; the column's own
 * CHECK is the backstop, not the rule.
 */
export async function updatePackageMediaAltText(
  client: PoolClient,
  input: { packageId: string; altText: string | null },
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE package_media
        SET alt_text = $2,
            updated_at = now()
      WHERE package_id = $1`,
    [input.packageId, input.altText],
  );

  return (rowCount ?? 0) > 0;
}

/**
 * Removes the journey's image relation.
 *
 * The asset row it pointed at is deleted separately, by the shared media
 * repository, and only after this — `package_media_media_asset_id_fkey` is
 * RESTRICT, so the other order is refused by PostgreSQL rather than by
 * discipline.
 */
export async function deletePackageMedia(client: PoolClient, packageId: string): Promise<boolean> {
  const { rowCount } = await client.query('DELETE FROM package_media WHERE package_id = $1', [
    packageId,
  ]);

  return (rowCount ?? 0) > 0;
}

/**
 * The journey's image as the admin layer will see it, read back inside the
 * transaction that wrote it.
 *
 * Read back rather than assembled from what was just inserted: what is
 * returned is what is stored, including anything a constraint or a default
 * decided. The dimensions come from `media_assets`, which the normalization
 * pipeline measured on the stored object.
 */
export async function findAdminPackageImage(
  client: PoolClient,
  packageId: string,
): Promise<AdminPackageImage | null> {
  const { rows } = await client.query<{
    reference: string;
    alt_text: string | null;
    width: number;
    height: number;
  }>(
    `SELECT ma.reference,
            pm.alt_text,
            ma.width,
            ma.height
       FROM package_media pm
       JOIN media_assets ma ON ma.id = pm.media_asset_id
      WHERE pm.package_id = $1`,
    [packageId],
  );

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    reference: requirePackageMediaText('reference', row.reference),
    altText: row.alt_text,
    width: requirePackageMediaPositiveInteger('width', row.width),
    height: requirePackageMediaPositiveInteger('height', row.height),
  };
}
