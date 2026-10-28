CREATE TABLE media_assets (
  id BIGINT NOT NULL AUTO_INCREMENT,
  reference CHAR(36) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  content_type VARCHAR(64) NOT NULL,
  byte_size BIGINT NOT NULL,
  checksum_sha256 VARCHAR(64) NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT media_assets_reference_key UNIQUE (reference),
  CONSTRAINT media_assets_storage_key_key UNIQUE (storage_key),
  CONSTRAINT media_assets_content_type_check CHECK (content_type = 'image/webp'),
  CONSTRAINT media_assets_byte_size_check CHECK (byte_size > 0),
  CONSTRAINT media_assets_checksum_sha256_length_check CHECK (CHAR_LENGTH(checksum_sha256) = 64),
  CONSTRAINT media_assets_checksum_sha256_format_check CHECK (REGEXP_LIKE(checksum_sha256, '^[0-9a-f]+$', 'c')),
  CONSTRAINT media_assets_width_check CHECK (width > 0),
  CONSTRAINT media_assets_height_check CHECK (height > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
-- ;;
-- cover_room_type_id emulates PostgreSQL's partial unique index (WHERE is_cover):
-- it is NULL unless the row is the cover, and NULLs never collide.
CREATE TABLE room_type_images (
  id BIGINT NOT NULL AUTO_INCREMENT,
  room_type_id BIGINT NOT NULL,
  media_asset_id BIGINT NOT NULL,
  alt_text TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_cover TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  cover_room_type_id BIGINT GENERATED ALWAYS AS (IF(is_cover, room_type_id, NULL)) STORED INVISIBLE,
  PRIMARY KEY (id),
  CONSTRAINT room_type_images_room_type_id_fkey FOREIGN KEY (room_type_id) REFERENCES room_types (id) ON DELETE RESTRICT,
  CONSTRAINT room_type_images_media_asset_id_fkey FOREIGN KEY (media_asset_id) REFERENCES media_assets (id) ON DELETE RESTRICT,
  CONSTRAINT room_type_images_alt_text_check CHECK (alt_text IS NULL OR CHAR_LENGTH(alt_text) <= 240),
  CONSTRAINT room_type_images_sort_order_check CHECK (sort_order >= 0),
  CONSTRAINT room_type_images_media_asset_id_key UNIQUE (media_asset_id),
  UNIQUE KEY room_type_images_cover_key (cover_room_type_id),
  KEY room_type_images_room_type_id_sort_order_id_idx (room_type_id, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
