-- Packages, itinerary, content, variants, rate tiers and package reservations.
-- Not expressible in MySQL and therefore enforced by the application:
--   * package_rate_tiers_no_overlap (EXCLUDE USING gist on party-size ranges)
-- Emulated with a generated column: package_variants_one_default_per_package_idx.
CREATE TABLE packages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  code VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NULL,
  description TEXT NULL,
  duration_label TEXT NULL,
  schedule_label TEXT NULL,
  operating_days JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  requires_price_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT packages_code_key UNIQUE (code),
  CONSTRAINT packages_slug_key UNIQUE (slug),
  CONSTRAINT packages_code_not_blank_check CHECK (code = TRIM(code) AND code <> '' AND NOT REGEXP_LIKE(code, '^[[:space:]]|[[:space:]]$')),
  CONSTRAINT packages_slug_format_check CHECK (REGEXP_LIKE(slug, '^[a-z0-9]+(-[a-z0-9]+)*$', 'c')),
  CONSTRAINT packages_title_not_blank_check CHECK (title = TRIM(title) AND title <> '' AND NOT REGEXP_LIKE(title, '^[[:space:]]|[[:space:]]$')),
  CONSTRAINT packages_summary_not_blank_check CHECK (summary IS NULL OR TRIM(summary) <> ''),
  CONSTRAINT packages_description_not_blank_check CHECK (description IS NULL OR TRIM(description) <> ''),
  CONSTRAINT packages_duration_label_not_blank_check CHECK (duration_label IS NULL OR TRIM(duration_label) <> ''),
  CONSTRAINT packages_schedule_label_not_blank_check CHECK (schedule_label IS NULL OR TRIM(schedule_label) <> ''),
  CONSTRAINT packages_operating_days_check CHECK (
    operating_days IS NULL OR JSON_SCHEMA_VALID(
      '{"type":"array","uniqueItems":true,"items":{"enum":["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]}}',
      operating_days
    )
  ),
  CONSTRAINT packages_sort_order_check CHECK (sort_order >= 0),
  KEY packages_public_catalogue_idx (is_active, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
-- ;;
CREATE TABLE package_itinerary_sections (
  id BIGINT NOT NULL AUTO_INCREMENT,
  package_id BIGINT NOT NULL,
  day_number INT NULL,
  heading TEXT NULL,
  body TEXT NOT NULL,
  sort_order INT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT package_itinerary_sections_package_id_fkey FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE,
  CONSTRAINT package_itinerary_sections_package_sort_key UNIQUE (package_id, sort_order),
  CONSTRAINT package_itinerary_sections_day_number_check CHECK (day_number IS NULL OR day_number > 0),
  CONSTRAINT package_itinerary_sections_heading_not_blank_check CHECK (heading IS NULL OR TRIM(heading) <> ''),
  CONSTRAINT package_itinerary_sections_body_not_blank_check CHECK (TRIM(body) <> ''),
  CONSTRAINT package_itinerary_sections_sort_order_check CHECK (sort_order >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
-- ;;
CREATE TABLE package_content_items (
  id BIGINT NOT NULL AUTO_INCREMENT,
  package_id BIGINT NOT NULL,
  kind VARCHAR(32) NOT NULL,
  `text` TEXT NOT NULL,
  sort_order INT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT package_content_items_package_id_fkey FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE,
  CONSTRAINT package_content_items_kind_check CHECK (kind IN ('included', 'excluded', 'note')),
  CONSTRAINT package_content_items_text_not_blank_check CHECK (TRIM(`text`) <> ''),
  CONSTRAINT package_content_items_sort_order_check CHECK (sort_order >= 0),
  CONSTRAINT package_content_items_package_kind_sort_key UNIQUE (package_id, kind, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
-- ;;
-- default_package_id is NULL unless the row is the default variant, emulating
-- the PostgreSQL partial unique index (WHERE is_default).
CREATE TABLE package_variants (
  id BIGINT NOT NULL AUTO_INCREMENT,
  package_id BIGINT NOT NULL,
  `key` VARCHAR(255) NOT NULL,
  label TEXT NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL,
  child_min_age INT NULL,
  child_max_age INT NULL,
  child_discount_percent DECIMAL(5,2) NULL,
  default_package_id BIGINT GENERATED ALWAYS AS (IF(is_default, package_id, NULL)) VIRTUAL INVISIBLE,
  PRIMARY KEY (id),
  CONSTRAINT package_variants_package_id_fkey FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE,
  CONSTRAINT package_variants_package_key_key UNIQUE (package_id, `key`),
  CONSTRAINT package_variants_package_sort_key UNIQUE (package_id, sort_order),
  CONSTRAINT package_variants_id_package_id_key UNIQUE (id, package_id),
  CONSTRAINT package_variants_key_format_check CHECK (REGEXP_LIKE(`key`, '^[a-z0-9]+(-[a-z0-9]+)*$', 'c')),
  CONSTRAINT package_variants_label_not_blank_check CHECK (TRIM(label) <> ''),
  CONSTRAINT package_variants_sort_order_check CHECK (sort_order >= 0),
  CONSTRAINT package_variants_child_pricing_metadata_check CHECK (
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
  ),
  UNIQUE KEY package_variants_one_default_per_package_idx (default_package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
-- ;;
CREATE TABLE package_rate_tiers (
  id BIGINT NOT NULL AUTO_INCREMENT,
  variant_id BIGINT NOT NULL,
  min_party_size INT NOT NULL,
  max_party_size INT NULL,
  adult_unit_rate DECIMAL(12,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  PRIMARY KEY (id),
  CONSTRAINT package_rate_tiers_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES package_variants (id) ON DELETE CASCADE,
  CONSTRAINT package_rate_tiers_min_party_size_check CHECK (min_party_size > 0),
  CONSTRAINT package_rate_tiers_max_party_size_check CHECK (max_party_size IS NULL OR max_party_size >= min_party_size),
  CONSTRAINT package_rate_tiers_adult_unit_rate_check CHECK (adult_unit_rate BETWEEN 0 AND 9999999999.99),
  CONSTRAINT package_rate_tiers_currency_check CHECK (currency = 'USD'),
  KEY package_rate_tiers_variant_id_idx (variant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
-- ;;
CREATE TABLE package_reservations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_reference VARCHAR(64) NOT NULL,
  package_id BIGINT NOT NULL,
  variant_id BIGINT NOT NULL,
  tour_date DATE NOT NULL,
  adults INT NOT NULL,
  children INT NOT NULL DEFAULT 0,
  child_ages JSON NULL,
  guest_first_name TEXT NOT NULL,
  guest_last_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT NOT NULL,
  guest_country TEXT NOT NULL,
  special_requests TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  pricing_status VARCHAR(32) NOT NULL,
  package_code_snapshot TEXT NOT NULL,
  package_title_snapshot TEXT NOT NULL,
  variant_label_snapshot TEXT NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  adult_unit_rate_snapshot DECIMAL(12,2) NOT NULL,
  child_unit_rate_snapshot DECIMAL(12,2) NULL,
  total_amount_snapshot DECIMAL(12,2) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT package_reservations_booking_reference_key UNIQUE (booking_reference),
  CONSTRAINT package_reservations_booking_reference_format_check CHECK (REGEXP_LIKE(booking_reference, '^TPP-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$', 'c')),
  CONSTRAINT package_reservations_variant_package_fkey FOREIGN KEY (variant_id, package_id) REFERENCES package_variants (id, package_id) ON DELETE RESTRICT,
  CONSTRAINT package_reservations_adults_check CHECK (adults > 0),
  CONSTRAINT package_reservations_children_check CHECK (children >= 0),
  CONSTRAINT package_reservations_child_ages_count_check CHECK (
    child_ages IS NULL OR (
      children > 0 AND JSON_TYPE(child_ages) = 'ARRAY' AND JSON_LENGTH(child_ages) = children
    )
  ),
  CONSTRAINT package_reservations_child_ages_nonnegative_check CHECK (
    child_ages IS NULL OR JSON_SCHEMA_VALID(
      '{"type":"array","items":{"type":"integer","minimum":0}}',
      child_ages
    )
  ),
  CONSTRAINT package_reservations_status_check CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  CONSTRAINT package_reservations_pricing_status_check CHECK (pricing_status IN ('quoted', 'requires_confirmation')),
  CONSTRAINT package_reservations_pricing_total_check CHECK (
    (pricing_status = 'quoted' AND total_amount_snapshot IS NOT NULL
      AND (children = 0 OR child_unit_rate_snapshot IS NOT NULL)
      AND total_amount_snapshot = adults * adult_unit_rate_snapshot
        + CASE WHEN children = 0 THEN 0 ELSE children * child_unit_rate_snapshot END)
    OR (pricing_status = 'requires_confirmation' AND total_amount_snapshot IS NULL)
  ),
  CONSTRAINT package_reservations_package_code_snapshot_not_blank_check CHECK (TRIM(package_code_snapshot) <> ''),
  CONSTRAINT package_reservations_package_title_snapshot_not_blank_check CHECK (TRIM(package_title_snapshot) <> ''),
  CONSTRAINT package_reservations_variant_label_snapshot_not_blank_check CHECK (TRIM(variant_label_snapshot) <> ''),
  CONSTRAINT package_reservations_currency_check CHECK (currency = 'USD'),
  CONSTRAINT package_reservations_adult_unit_rate_snapshot_check CHECK (adult_unit_rate_snapshot BETWEEN 0 AND 9999999999.99),
  CONSTRAINT package_reservations_child_unit_rate_snapshot_check CHECK (child_unit_rate_snapshot IS NULL OR child_unit_rate_snapshot BETWEEN 0 AND 9999999999.99),
  CONSTRAINT package_reservations_total_amount_snapshot_check CHECK (total_amount_snapshot IS NULL OR total_amount_snapshot BETWEEN 0 AND 9999999999.99),
  CONSTRAINT package_reservations_guest_names_not_blank_check CHECK (
    REGEXP_LIKE(guest_first_name, '[^[:space:]]') AND CHAR_LENGTH(guest_first_name) <= 100
    AND REGEXP_LIKE(guest_last_name, '[^[:space:]]') AND CHAR_LENGTH(guest_last_name) <= 100
  ),
  CONSTRAINT package_reservations_guest_contact_not_blank_check CHECK (
    REGEXP_LIKE(guest_email, '[^[:space:]]') AND CHAR_LENGTH(guest_email) <= 254
    AND REGEXP_LIKE(guest_phone, '[^[:space:]]') AND CHAR_LENGTH(guest_phone) <= 50
    AND REGEXP_LIKE(guest_country, '[^[:space:]]') AND CHAR_LENGTH(guest_country) <= 100
  ),
  CONSTRAINT package_reservations_special_requests_check CHECK (
    special_requests IS NULL OR (
      TRIM(special_requests) <> '' AND CHAR_LENGTH(special_requests) <= 2000
    )
  ),
  KEY package_reservations_package_tour_date_idx (package_id, tour_date),
  KEY package_reservations_variant_tour_date_idx (variant_id, tour_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
