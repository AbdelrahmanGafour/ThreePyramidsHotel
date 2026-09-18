/**
 * V1 reservations: one reservation = one physical room, with the accepted
 * price snapshotted in EGP. Stays are half-open [check_in, check_out), so
 * same-day turnover is allowed. Double booking is prevented by PostgreSQL
 * itself through an EXCLUDE constraint, not by application code.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // GiST needs btree_gist to compare bigint room_id with `=` alongside the range operator.
  pgm.createExtension('btree_gist', { ifNotExists: true });

  // Referenced by the composite foreign key below so the database can prove an
  // allocated room belongs to the reservation's room type.
  pgm.addConstraint('rooms', 'rooms_id_room_type_id_key', {
    unique: ['id', 'room_type_id'],
  });

  pgm.createTable('reservations', {
    id: { type: 'bigserial', primaryKey: true },
    booking_reference: { type: 'text', notNull: true },
    room_type_id: { type: 'bigint', notNull: true },
    room_id: { type: 'bigint', notNull: true },
    guest_first_name: { type: 'text', notNull: true },
    guest_last_name: { type: 'text', notNull: true },
    guest_email: { type: 'text', notNull: true },
    guest_phone: { type: 'text', notNull: true },
    guest_country: { type: 'text', notNull: true },
    adults: { type: 'integer', notNull: true },
    children: { type: 'integer', notNull: true, default: 0 },
    check_in: { type: 'date', notNull: true },
    check_out: { type: 'date', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    currency: { type: 'text', notNull: true, default: 'EGP' },
    // Accepted price at booking time; later room-type price changes must not alter it.
    nightly_rate_snapshot: { type: 'numeric(12,2)', notNull: true },
    total_amount: { type: 'numeric(12,2)', notNull: true },
    special_requests: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('reservations', 'reservations_booking_reference_key', {
    unique: 'booking_reference',
  });
  pgm.addConstraint('reservations', 'reservations_adults_check', {
    check: 'adults > 0',
  });
  pgm.addConstraint('reservations', 'reservations_children_check', {
    check: 'children >= 0',
  });
  pgm.addConstraint('reservations', 'reservations_status_check', {
    check: "status IN ('pending', 'confirmed', 'cancelled')",
  });
  pgm.addConstraint('reservations', 'reservations_currency_check', {
    check: "currency = 'EGP'",
  });
  pgm.addConstraint('reservations', 'reservations_nightly_rate_snapshot_check', {
    check: 'nightly_rate_snapshot >= 0',
  });
  pgm.addConstraint('reservations', 'reservations_total_amount_check', {
    check: 'total_amount >= 0',
  });
  pgm.addConstraint('reservations', 'reservations_stay_dates_check', {
    check: 'check_out > check_in',
  });

  // Composite FK: the allocated physical room must belong to the stored room
  // type. No separate single-column FKs — this one already covers both.
  pgm.addConstraint('reservations', 'reservations_room_allocation_fkey', {
    foreignKeys: {
      columns: ['room_id', 'room_type_id'],
      references: 'rooms(id, room_type_id)',
      onDelete: 'RESTRICT',
    },
  });

  // Raw SQL keeps the range expression and the partial predicate explicit.
  // Inventory-consuming stays (pending + confirmed) for one physical room may
  // not overlap; '[)' allows 10→12 and 12→14 to share a room. Cancelled
  // reservations fall outside the predicate and release their inventory.
  pgm.sql(`
    ALTER TABLE "reservations"
      ADD CONSTRAINT "reservations_no_overlapping_active_stays"
      EXCLUDE USING gist (
        room_id WITH =,
        daterange(check_in, check_out, '[)') WITH &&
      )
      WHERE (status IN ('pending', 'confirmed'));
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Dropping the table removes its constraints, including the exclusion constraint.
  pgm.dropTable('reservations');
  pgm.dropConstraint('rooms', 'rooms_id_room_type_id_key');
  // btree_gist is intentionally left in place — it may be shared database infrastructure.
};
