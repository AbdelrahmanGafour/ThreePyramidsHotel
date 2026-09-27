/**
 * The one image a journey may have.
 *
 * `package_media` is the explicit join between a package and the media asset
 * it shows, exactly as `room_type_images` joins a room type to the assets it
 * shows. The T03-B migration that created `media_assets` said package media
 * would arrive this way — its own table against the same assets, keeping real
 * foreign keys, real indexes and real checks on both sides — rather than as a
 * polymorphic `entity_type + entity_id` table or as image columns bolted onto
 * `packages`.
 *
 * ---------------------------------------------------------------------------
 * EXACTLY ONE, AND THE SCHEMA SAYS SO
 *
 * `UNIQUE (package_id)` is the whole of the one-image rule. The service will
 * check it under the package row lock so an administrator gets a clear refusal
 * rather than a raw 23505, but the constraint is what makes the rule true even
 * if a future code path forgets to take that lock.
 *
 * Because of it, there is nothing for a `sort_order` to order and nothing for
 * an `is_cover` to distinguish, so neither column exists. Adding them later,
 * if a gallery is ever wanted, is an additive migration plus dropping one
 * unique constraint; carrying them now would be two columns whose only
 * possible values are 0 and true.
 *
 * `UNIQUE (media_asset_id)` mirrors `room_type_images_media_asset_id_key`: one
 * asset, one placement. Every upload mints its own asset, so an asset shared
 * between two owners would mean two rows able to delete each other's bytes.
 *
 * ---------------------------------------------------------------------------
 * RESTRICT ON BOTH SIDES, AND WHY THAT IS NOT THE SAME DECISION AS ROOM TYPES
 *
 * `room_type_images` could take RESTRICT on both keys freely: there is no
 * room-type hard delete for it to obstruct. Journeys DO have one —
 * `deleteAdminPackage` runs a single `DELETE FROM packages` and lets four
 * child tables cascade — so RESTRICT here is a deliberate, visible obstacle.
 * Deleting a journey that still has an image will be refused by
 * `package_media_package_id_fkey` until that path is taught to remove the
 * relation and the asset inside the same transaction, and to delete the
 * object from storage only after the commit.
 *
 * CASCADE would have been the quiet alternative and is the wrong one: it would
 * drop the relation and leave the `media_assets` row behind with no owner and
 * no column naming one, so nothing could ever find the object it describes.
 * A loud refusal now is worth more than a silent leak later.
 *
 * ---------------------------------------------------------------------------
 * Additive throughout. No existing table, column, constraint, index or row is
 * touched — `media_assets` in particular is left exactly as it was, and
 * nothing here knows about `seed_managed`, which media ownership is
 * deliberately orthogonal to. The table starts empty.
 *
 * Nothing here knows which bucket or which provider holds the bytes, and
 * there is no column for one: that is deployment configuration, and a URL is
 * composed when it is read.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * The longest alt text accepted, matching `room_type_images_alt_text_check`
 * and the application's `MAX_ALT_TEXT_LENGTH`. One number, three places, and
 * this is the one PostgreSQL enforces.
 */
const ALT_TEXT_MAX_LENGTH = 240;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable('package_media', {
    id: { type: 'bigserial', primaryKey: true },
    package_id: { type: 'bigint', notNull: true },
    media_asset_id: { type: 'bigint', notNull: true },
    // Nullable because a decorative image is a real case, the same way it is
    // for a room type. Emptiness is resolved once, in the application, which
    // stores NULL rather than an empty string.
    alt_text: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // Unlike `media_assets`, this row IS mutable: replacing a journey's image
    // repoints `media_asset_id` at a new asset rather than creating a second
    // relation, so the row has a meaningful last-changed time.
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('package_media', 'package_media_package_id_fkey', {
    foreignKeys: {
      columns: 'package_id',
      references: 'packages(id)',
      onDelete: 'RESTRICT',
    },
  });

  pgm.addConstraint('package_media', 'package_media_media_asset_id_fkey', {
    foreignKeys: {
      columns: 'media_asset_id',
      references: 'media_assets(id)',
      onDelete: 'RESTRICT',
    },
  });

  // Exactly one image per journey. A unique constraint rather than a partial
  // index because the rule has no exception to carve out: every row in this
  // table is the image of its package.
  pgm.addConstraint('package_media', 'package_media_package_id_key', {
    unique: 'package_id',
  });

  pgm.addConstraint('package_media', 'package_media_media_asset_id_key', {
    unique: 'media_asset_id',
  });

  pgm.addConstraint('package_media', 'package_media_alt_text_check', {
    check: `alt_text IS NULL OR length(alt_text) <= ${ALT_TEXT_MAX_LENGTH}`,
  });

  // No further index. Both unique constraints are backed by unique indexes
  // PostgreSQL creates itself, and `package_id` — the only column anything
  // looks a row up by — is the leading and only column of one of them.
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // This table only. It holds the foreign keys, so nothing older has to be
  // touched or named to remove it, and both `packages` and `media_assets`
  // survive untouched.
  pgm.dropTable('package_media');
};
