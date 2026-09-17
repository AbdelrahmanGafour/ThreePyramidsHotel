/**
 * Room types (what a guest books) and the physical rooms that belong to them
 * (what the backend allocates). Availability is never stored here — it is
 * derived later from physical rooms plus reservations.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable('room_types', {
    id: { type: 'bigserial', primaryKey: true },
    slug: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    short_description: { type: 'text' },
    description: { type: 'text' },
    capacity: { type: 'integer', notNull: true },
    bed_type: { type: 'text' },
    bed_count: { type: 'integer' },
    size_sqm: { type: 'numeric(6,2)' },
    view: { type: 'text' },
    // Base nightly rate in EGP; V1 prices a stay from this single rate.
    base_nightly_rate: { type: 'numeric(12,2)', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    sort_order: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('room_types', 'room_types_slug_key', { unique: 'slug' });
  pgm.addConstraint('room_types', 'room_types_capacity_check', {
    check: 'capacity > 0',
  });
  pgm.addConstraint('room_types', 'room_types_bed_count_check', {
    check: 'bed_count IS NULL OR bed_count > 0',
  });
  pgm.addConstraint('room_types', 'room_types_size_sqm_check', {
    check: 'size_sqm IS NULL OR size_sqm > 0',
  });
  pgm.addConstraint('room_types', 'room_types_base_nightly_rate_check', {
    check: 'base_nightly_rate >= 0',
  });
  pgm.addConstraint('room_types', 'room_types_sort_order_check', {
    check: 'sort_order >= 0',
  });

  pgm.createTable('rooms', {
    id: { type: 'bigserial', primaryKey: true },
    room_type_id: { type: 'bigint', notNull: true },
    room_number: { type: 'text', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('rooms', 'rooms_room_number_key', { unique: 'room_number' });
  // RESTRICT: a room type with physical rooms must not be deleted out from under them.
  pgm.addConstraint('rooms', 'rooms_room_type_id_fkey', {
    foreignKeys: {
      columns: 'room_type_id',
      references: 'room_types(id)',
      onDelete: 'RESTRICT',
    },
  });

  pgm.createIndex('rooms', 'room_type_id', { name: 'rooms_room_type_id_idx' });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Rooms first: they hold the foreign key to room_types.
  pgm.dropTable('rooms');
  pgm.dropTable('room_types');
};
