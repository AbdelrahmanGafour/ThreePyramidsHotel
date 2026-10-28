CREATE TABLE admin_users (
  id BIGINT NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT admin_users_email_key UNIQUE (email),
  -- binary comparison: the column collation is case-insensitive
  CONSTRAINT admin_users_email_lowercase_check CHECK (email COLLATE utf8mb4_bin = LOWER(email)),
  CONSTRAINT admin_users_email_trimmed_check CHECK (email = TRIM(email)),
  CONSTRAINT admin_users_email_not_blank_check CHECK (TRIM(email) <> ''),
  CONSTRAINT admin_users_display_name_not_blank_check CHECK (TRIM(display_name) <> ''),
  CONSTRAINT admin_users_password_hash_not_blank_check CHECK (TRIM(password_hash) <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
-- ;;
CREATE TABLE admin_sessions (
  id BIGINT NOT NULL AUTO_INCREMENT,
  admin_user_id BIGINT NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT admin_sessions_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES admin_users (id) ON DELETE CASCADE,
  CONSTRAINT admin_sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT admin_sessions_token_hash_not_blank_check CHECK (TRIM(token_hash) <> ''),
  CONSTRAINT admin_sessions_expires_at_check CHECK (expires_at > created_at),
  KEY admin_sessions_admin_user_id_idx (admin_user_id),
  KEY admin_sessions_expires_at_idx (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
