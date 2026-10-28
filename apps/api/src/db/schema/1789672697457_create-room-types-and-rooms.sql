-- Room types and the physical rooms that belong to them.
-- Statements are separated by a line containing only: -- ;;
CREATE TABLE room_types (
  id BIGINT NOT NULL AUTO_INCREMENT,
  slug VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  short_description TEXT NULL,
  description TEXT NULL,
  capacity INT NOT NULL,
  bed_type TEXT NULL,
  bed_count INT NULL,
  size_sqm DECIMAL(6,2) NULL,
  `view` TEXT NULL,
  base_nightly_rate DECIMAL(12,2) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT room_types_slug_key UNIQUE (slug),
  CONSTRAINT room_types_capacity_check CHECK (capacity > 0),
  CONSTRAINT room_types_bed_count_check CHECK (bed_count IS NULL OR bed_count > 0),
  CONSTRAINT room_types_size_sqm_check CHECK (size_sqm IS NULL OR size_sqm > 0),
  CONSTRAINT room_types_base_nightly_rate_check CHECK (base_nightly_rate >= 0),
  CONSTRAINT room_types_sort_order_check CHECK (sort_order >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
-- ;;
CREATE TABLE rooms (
  id BIGINT NOT NULL AUTO_INCREMENT,
  room_type_id BIGINT NOT NULL,
  room_number VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT rooms_room_number_key UNIQUE (room_number),
  CONSTRAINT rooms_room_type_id_fkey FOREIGN KEY (room_type_id) REFERENCES room_types (id) ON DELETE RESTRICT,
  KEY rooms_room_type_id_idx (room_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
