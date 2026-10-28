CREATE TABLE package_media (
  id BIGINT NOT NULL AUTO_INCREMENT,
  package_id BIGINT NOT NULL,
  media_asset_id BIGINT NOT NULL,
  alt_text TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT package_media_package_id_fkey FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE RESTRICT,
  CONSTRAINT package_media_media_asset_id_fkey FOREIGN KEY (media_asset_id) REFERENCES media_assets (id) ON DELETE RESTRICT,
  CONSTRAINT package_media_package_id_key UNIQUE (package_id),
  CONSTRAINT package_media_media_asset_id_key UNIQUE (media_asset_id),
  CONSTRAINT package_media_alt_text_check CHECK (alt_text IS NULL OR CHAR_LENGTH(alt_text) <= 240)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
