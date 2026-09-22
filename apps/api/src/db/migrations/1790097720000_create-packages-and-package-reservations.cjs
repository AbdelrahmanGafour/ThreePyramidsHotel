/**
 * Public Packages/Tours catalogue and independent package reservations.
 *
 * Packages are a separate sellable domain from hotel rooms. Nothing in this
 * schema allocates a physical room or participates in hotel availability.
 * Catalogue content is relational so brochure itineraries, notes, variants,
 * and party-size rate tiers can be represented without package-specific JSON.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const PACKAGE_BOOKING_REFERENCE_PATTERN =
  '^TPP-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$';

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Rate tiers use a PostgreSQL exclusion constraint so two ranges for the
  // same variant can never overlap. btree_gist is already shared by the room
  // reservation schema; if it is absent for any reason, make the dependency
  // explicit here too.
  pgm.createExtension('btree_gist', { ifNotExists: true });

  pgm.createTable('packages', {
    id: { type: 'bigserial', primaryKey: true },
    code: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true },
    title: { type: 'text', notNull: true },
    summary: { type: 'text' },
    description: { type: 'text' },
    duration_label: { type: 'text' },
    schedule_label: { type: 'text' },
    // Lowercase English weekday names, only when the brochure is explicit.
    operating_days: { type: 'text[]' },
    is_active: { type: 'boolean', notNull: true, default: true },
    requires_price_confirmation: { type: 'boolean', notNull: true, default: false },
    sort_order: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('packages', 'packages_code_key', { unique: 'code' });
  pgm.addConstraint('packages', 'packages_slug_key', { unique: 'slug' });
  pgm.addConstraint('packages', 'packages_code_not_blank_check', {
    check: "code = btrim(code) AND code <> '' AND code !~ '^[[:space:]]|[[:space:]]$'",
  });
  pgm.addConstraint('packages', 'packages_slug_format_check', {
    check: "slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'",
  });
  pgm.addConstraint('packages', 'packages_title_not_blank_check', {
    check: "title = btrim(title) AND title <> '' AND title !~ '^[[:space:]]|[[:space:]]$'",
  });
  pgm.addConstraint('packages', 'packages_summary_not_blank_check', {
    check: "summary IS NULL OR btrim(summary) <> ''",
  });
  pgm.addConstraint('packages', 'packages_description_not_blank_check', {
    check: "description IS NULL OR btrim(description) <> ''",
  });
  pgm.addConstraint('packages', 'packages_duration_label_not_blank_check', {
    check: "duration_label IS NULL OR btrim(duration_label) <> ''",
  });
  pgm.addConstraint('packages', 'packages_schedule_label_not_blank_check', {
    check: "schedule_label IS NULL OR btrim(schedule_label) <> ''",
  });
  pgm.addConstraint('packages', 'packages_operating_days_check', {
    check: `
      operating_days IS NULL OR CASE
        WHEN array_ndims(operating_days) = 1 AND array_lower(operating_days, 1) = 1 THEN
        array_position(operating_days, NULL) IS NULL
        AND operating_days <@ ARRAY[
          'monday', 'tuesday', 'wednesday', 'thursday',
          'friday', 'saturday', 'sunday'
        ]::text[]
        AND cardinality(operating_days) = (
          ${['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
            .map((day) => `(CASE WHEN '${day}' = ANY(operating_days) THEN 1 ELSE 0 END)`)
            .join(' + ')}
        )
        ELSE false
      END
    `,
  });
  pgm.addConstraint('packages', 'packages_sort_order_check', {
    check: 'sort_order >= 0',
  });
  pgm.createIndex('packages', ['is_active', 'sort_order', 'id'], {
    name: 'packages_public_catalogue_idx',
  });

  pgm.createTable('package_itinerary_sections', {
    id: { type: 'bigserial', primaryKey: true },
    package_id: { type: 'bigint', notNull: true },
    day_number: { type: 'integer' },
    heading: { type: 'text' },
    body: { type: 'text', notNull: true },
    sort_order: { type: 'integer', notNull: true },
  });

  pgm.addConstraint(
    'package_itinerary_sections',
    'package_itinerary_sections_package_id_fkey',
    {
      foreignKeys: {
        columns: 'package_id',
        references: 'packages(id)',
        onDelete: 'CASCADE',
      },
    },
  );
  pgm.addConstraint(
    'package_itinerary_sections',
    'package_itinerary_sections_package_sort_key',
    { unique: ['package_id', 'sort_order'] },
  );
  pgm.addConstraint(
    'package_itinerary_sections',
    'package_itinerary_sections_day_number_check',
    { check: 'day_number IS NULL OR day_number > 0' },
  );
  pgm.addConstraint(
    'package_itinerary_sections',
    'package_itinerary_sections_heading_not_blank_check',
    { check: "heading IS NULL OR btrim(heading) <> ''" },
  );
  pgm.addConstraint(
    'package_itinerary_sections',
    'package_itinerary_sections_body_not_blank_check',
    { check: "btrim(body) <> ''" },
  );
  pgm.addConstraint(
    'package_itinerary_sections',
    'package_itinerary_sections_sort_order_check',
    { check: 'sort_order >= 0' },
  );
  // The package-leading UNIQUE index also covers the FK and ordered reads.

  pgm.createTable('package_content_items', {
    id: { type: 'bigserial', primaryKey: true },
    package_id: { type: 'bigint', notNull: true },
    kind: { type: 'text', notNull: true },
    text: { type: 'text', notNull: true },
    sort_order: { type: 'integer', notNull: true },
  });

  pgm.addConstraint('package_content_items', 'package_content_items_package_id_fkey', {
    foreignKeys: {
      columns: 'package_id',
      references: 'packages(id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('package_content_items', 'package_content_items_kind_check', {
    check: "kind IN ('included', 'excluded', 'note')",
  });
  pgm.addConstraint('package_content_items', 'package_content_items_text_not_blank_check', {
    check: "btrim(text) <> ''",
  });
  pgm.addConstraint('package_content_items', 'package_content_items_sort_order_check', {
    check: 'sort_order >= 0',
  });
  pgm.addConstraint('package_content_items', 'package_content_items_package_kind_sort_key', {
    unique: ['package_id', 'kind', 'sort_order'],
  });
  // The package/kind/sort UNIQUE index covers these lookups already.

  pgm.createTable('package_variants', {
    id: { type: 'bigserial', primaryKey: true },
    package_id: { type: 'bigint', notNull: true },
    key: { type: 'text', notNull: true },
    label: { type: 'text', notNull: true },
    is_default: { type: 'boolean', notNull: true, default: false },
    sort_order: { type: 'integer', notNull: true },
    child_min_age: { type: 'integer' },
    child_max_age: { type: 'integer' },
    child_discount_percent: { type: 'numeric(5,2)' },
  });

  pgm.addConstraint('package_variants', 'package_variants_package_id_fkey', {
    foreignKeys: {
      columns: 'package_id',
      references: 'packages(id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('package_variants', 'package_variants_package_key_key', {
    unique: ['package_id', 'key'],
  });
  pgm.addConstraint('package_variants', 'package_variants_package_sort_key', {
    unique: ['package_id', 'sort_order'],
  });
  // The composite reservation FK below uses this to prove the selected variant
  // belongs to the selected package.
  pgm.addConstraint('package_variants', 'package_variants_id_package_id_key', {
    unique: ['id', 'package_id'],
  });
  pgm.addConstraint('package_variants', 'package_variants_key_format_check', {
    check: "key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'",
  });
  pgm.addConstraint('package_variants', 'package_variants_label_not_blank_check', {
    check: "btrim(label) <> ''",
  });
  pgm.addConstraint('package_variants', 'package_variants_sort_order_check', {
    check: 'sort_order >= 0',
  });
  pgm.addConstraint('package_variants', 'package_variants_child_pricing_metadata_check', {
    check: `
      (
        child_min_age IS NULL
        AND child_max_age IS NULL
        AND child_discount_percent IS NULL
      ) OR (
        child_min_age IS NOT NULL
        AND child_max_age IS NOT NULL
        AND child_discount_percent IS NOT NULL
        AND child_min_age >= 0
        AND child_max_age >= child_min_age
        AND child_discount_percent >= 0
        AND child_discount_percent <= 100
      )
    `,
  });
  pgm.sql(`
    CREATE UNIQUE INDEX "package_variants_one_default_per_package_idx"
      ON "package_variants" (package_id)
      WHERE is_default;
  `);
  // Both package-leading UNIQUE indexes cover the parent FK.

  pgm.createTable('package_rate_tiers', {
    id: { type: 'bigserial', primaryKey: true },
    variant_id: { type: 'bigint', notNull: true },
    min_party_size: { type: 'integer', notNull: true },
    max_party_size: { type: 'integer' },
    // Per-person rate; tier party size is adults + children, including cabin variants.
    adult_unit_rate: { type: 'numeric(12,2)', notNull: true },
    currency: { type: 'text', notNull: true, default: 'EGP' },
  });

  pgm.addConstraint('package_rate_tiers', 'package_rate_tiers_variant_id_fkey', {
    foreignKeys: {
      columns: 'variant_id',
      references: 'package_variants(id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('package_rate_tiers', 'package_rate_tiers_min_party_size_check', {
    check: 'min_party_size > 0',
  });
  pgm.addConstraint('package_rate_tiers', 'package_rate_tiers_max_party_size_check', {
    check: 'max_party_size IS NULL OR max_party_size >= min_party_size',
  });
  pgm.addConstraint('package_rate_tiers', 'package_rate_tiers_adult_unit_rate_check', {
    check: 'adult_unit_rate BETWEEN 0 AND 9999999999.99',
  });
  pgm.addConstraint('package_rate_tiers', 'package_rate_tiers_currency_check', {
    check: "currency = 'EGP'",
  });
  pgm.createIndex('package_rate_tiers', 'variant_id', {
    name: 'package_rate_tiers_variant_id_idx',
  });
  // [min, max] brochure tiers become half-open int8 ranges [min, max + 1).
  // A NULL max becomes an unbounded upper range, representing tiers like 3+.
  // This is package pricing integrity only; it has no room-inventory meaning.
  pgm.sql(`
    ALTER TABLE "package_rate_tiers"
      ADD CONSTRAINT "package_rate_tiers_no_overlap"
      EXCLUDE USING gist (
        variant_id WITH =,
        int8range(
          min_party_size::bigint,
          CASE
            WHEN max_party_size IS NULL THEN NULL
            ELSE max_party_size::bigint + 1
          END,
          '[)'
        ) WITH &&
      );
  `);

  pgm.createTable('package_reservations', {
    id: { type: 'bigserial', primaryKey: true },
    booking_reference: { type: 'text', notNull: true },
    package_id: { type: 'bigint', notNull: true },
    variant_id: { type: 'bigint', notNull: true },
    tour_date: { type: 'date', notNull: true },
    adults: { type: 'integer', notNull: true },
    children: { type: 'integer', notNull: true, default: 0 },
    // Present only when exact child pricing requires ages. It is a reservation
    // input snapshot, never catalogue authority.
    child_ages: { type: 'integer[]' },
    guest_first_name: { type: 'text', notNull: true },
    guest_last_name: { type: 'text', notNull: true },
    guest_email: { type: 'text', notNull: true },
    guest_phone: { type: 'text', notNull: true },
    guest_country: { type: 'text', notNull: true },
    special_requests: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'pending' },
    pricing_status: { type: 'text', notNull: true },
    package_code_snapshot: { type: 'text', notNull: true },
    package_title_snapshot: { type: 'text', notNull: true },
    variant_label_snapshot: { type: 'text', notNull: true },
    currency: { type: 'text', notNull: true, default: 'EGP' },
    adult_unit_rate_snapshot: { type: 'numeric(12,2)', notNull: true },
    child_unit_rate_snapshot: { type: 'numeric(12,2)' },
    // A deterministic quote only. Confirmation-required requests have no total.
    total_amount_snapshot: { type: 'numeric(12,2)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('package_reservations', 'package_reservations_booking_reference_key', {
    unique: 'booking_reference',
  });
  pgm.addConstraint('package_reservations', 'package_reservations_booking_reference_format_check', {
    check: `booking_reference ~ '${PACKAGE_BOOKING_REFERENCE_PATTERN}'`,
  });
  // This composite FK covers variant identity and its package; the variant's
  // package FK provides the remaining parent relationship without duplicate FKs.
  pgm.addConstraint('package_reservations', 'package_reservations_variant_package_fkey', {
    foreignKeys: {
      columns: ['variant_id', 'package_id'],
      references: 'package_variants(id, package_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.addConstraint('package_reservations', 'package_reservations_adults_check', {
    check: 'adults > 0',
  });
  pgm.addConstraint('package_reservations', 'package_reservations_children_check', {
    check: 'children >= 0',
  });
  pgm.addConstraint('package_reservations', 'package_reservations_child_ages_count_check', {
    check: `child_ages IS NULL OR (
      children > 0 AND cardinality(child_ages) = children
      AND array_ndims(child_ages) = 1 AND array_lower(child_ages, 1) = 1
    )`,
  });
  pgm.addConstraint('package_reservations', 'package_reservations_child_ages_nonnegative_check', {
    check: `child_ages IS NULL OR CASE WHEN array_ndims(child_ages) = 1 THEN
      array_position(child_ages, NULL) IS NULL AND 0 <= ALL(child_ages)
      ELSE false END`,
  });
  pgm.addConstraint('package_reservations', 'package_reservations_status_check', {
    check: "status IN ('pending', 'confirmed', 'cancelled')",
  });
  pgm.addConstraint('package_reservations', 'package_reservations_pricing_status_check', {
    check: "pricing_status IN ('quoted', 'requires_confirmation')",
  });
  pgm.addConstraint('package_reservations', 'package_reservations_pricing_total_check', {
    check: `
      (pricing_status = 'quoted' AND total_amount_snapshot IS NOT NULL
        AND (children = 0 OR child_unit_rate_snapshot IS NOT NULL)
        AND total_amount_snapshot = adults::numeric * adult_unit_rate_snapshot
          + CASE WHEN children = 0 THEN 0 ELSE children::numeric * child_unit_rate_snapshot END)
      OR (pricing_status = 'requires_confirmation' AND total_amount_snapshot IS NULL)
    `,
  });
  pgm.addConstraint('package_reservations', 'package_reservations_package_code_snapshot_not_blank_check', {
    check: "btrim(package_code_snapshot) <> ''",
  });
  pgm.addConstraint('package_reservations', 'package_reservations_package_title_snapshot_not_blank_check', {
    check: "btrim(package_title_snapshot) <> ''",
  });
  pgm.addConstraint('package_reservations', 'package_reservations_variant_label_snapshot_not_blank_check', {
    check: "btrim(variant_label_snapshot) <> ''",
  });
  pgm.addConstraint('package_reservations', 'package_reservations_currency_check', {
    check: "currency = 'EGP'",
  });
  pgm.addConstraint('package_reservations', 'package_reservations_adult_unit_rate_snapshot_check', {
    check: 'adult_unit_rate_snapshot BETWEEN 0 AND 9999999999.99',
  });
  pgm.addConstraint('package_reservations', 'package_reservations_child_unit_rate_snapshot_check', {
    check: 'child_unit_rate_snapshot IS NULL OR child_unit_rate_snapshot BETWEEN 0 AND 9999999999.99',
  });
  pgm.addConstraint('package_reservations', 'package_reservations_total_amount_snapshot_check', {
    check: 'total_amount_snapshot IS NULL OR total_amount_snapshot BETWEEN 0 AND 9999999999.99',
  });
  pgm.addConstraint('package_reservations', 'package_reservations_guest_names_not_blank_check', {
    check: `
      guest_first_name ~ '[^[:space:]]' AND char_length(guest_first_name) <= 100
      AND guest_last_name ~ '[^[:space:]]' AND char_length(guest_last_name) <= 100
    `,
  });
  pgm.addConstraint('package_reservations', 'package_reservations_guest_contact_not_blank_check', {
    check: `
      guest_email ~ '[^[:space:]]' AND char_length(guest_email) <= 254
      AND guest_phone ~ '[^[:space:]]' AND char_length(guest_phone) <= 50
      AND guest_country ~ '[^[:space:]]' AND char_length(guest_country) <= 100
    `,
  });
  pgm.addConstraint('package_reservations', 'package_reservations_special_requests_check', {
    check: `
      special_requests IS NULL OR (
        btrim(special_requests) <> ''
        AND char_length(special_requests) <= 2000
      )
    `,
  });
  pgm.createIndex('package_reservations', ['package_id', 'tour_date'], {
    name: 'package_reservations_package_tour_date_idx',
  });
  pgm.createIndex('package_reservations', ['variant_id', 'tour_date'], {
    name: 'package_reservations_variant_tour_date_idx',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTable('package_reservations');
  pgm.dropTable('package_rate_tiers');
  pgm.dropTable('package_variants');
  pgm.dropTable('package_content_items');
  pgm.dropTable('package_itinerary_sections');
  pgm.dropTable('packages');
  // btree_gist is shared database infrastructure and is intentionally retained.
};
