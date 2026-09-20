/**
 * Supports the admin reservations list's one fixed order: newest first, with
 * `id` breaking ties so paging is deterministic when two reservations share a
 * created_at. The index column order and direction match that ORDER BY exactly,
 * so PostgreSQL can walk it instead of sorting the whole table for every page.
 *
 * Only this ordering is indexed. Status, stay dates and guest search have no
 * endpoint yet, and an index with no query behind it is cost without benefit.
 *
 * No reservation column or constraint is touched.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const INDEX_NAME = 'reservations_created_at_id_idx';

const INDEX_COLUMNS = [
  { name: 'created_at', sort: 'DESC' },
  { name: 'id', sort: 'DESC' },
];

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createIndex('reservations', INDEX_COLUMNS, { name: INDEX_NAME });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropIndex('reservations', INDEX_COLUMNS, { name: INDEX_NAME });
};
