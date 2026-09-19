/**
 * Staff accounts and their server-side sessions.
 *
 * V1 has one staff permission level, so there is no role or permission column.
 * `password_hash` stays algorithm-agnostic: the encoded string carries its own
 * parameters, so the planned scrypt implementation can change later without a
 * schema change. Sessions store only SHA-256(token); the raw token exists only
 * in the guest's HttpOnly cookie, and a session stays revocable server-side.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable('admin_users', {
    id: { type: 'bigserial', primaryKey: true },
    email: { type: 'text', notNull: true },
    display_name: { type: 'text', notNull: true },
    password_hash: { type: 'text', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('admin_users', 'admin_users_email_key', { unique: 'email' });
  // Stored lowercase and untrimmed-free, so uniqueness cannot be defeated by
  // casing or stray whitespace.
  pgm.addConstraint('admin_users', 'admin_users_email_lowercase_check', {
    check: 'email = lower(email)',
  });
  pgm.addConstraint('admin_users', 'admin_users_email_trimmed_check', {
    check: 'email = btrim(email)',
  });
  pgm.addConstraint('admin_users', 'admin_users_email_not_blank_check', {
    check: "btrim(email) <> ''",
  });
  pgm.addConstraint('admin_users', 'admin_users_display_name_not_blank_check', {
    check: "btrim(display_name) <> ''",
  });
  pgm.addConstraint('admin_users', 'admin_users_password_hash_not_blank_check', {
    check: "btrim(password_hash) <> ''",
  });

  pgm.createTable('admin_sessions', {
    id: { type: 'bigserial', primaryKey: true },
    admin_user_id: { type: 'bigint', notNull: true },
    token_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // CASCADE: a session is derived state and must not outlive its account.
  pgm.addConstraint('admin_sessions', 'admin_sessions_admin_user_id_fkey', {
    foreignKeys: {
      columns: 'admin_user_id',
      references: 'admin_users(id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('admin_sessions', 'admin_sessions_token_hash_key', { unique: 'token_hash' });
  pgm.addConstraint('admin_sessions', 'admin_sessions_token_hash_not_blank_check', {
    check: "btrim(token_hash) <> ''",
  });
  pgm.addConstraint('admin_sessions', 'admin_sessions_expires_at_check', {
    check: 'expires_at > created_at',
  });

  pgm.createIndex('admin_sessions', 'admin_user_id', { name: 'admin_sessions_admin_user_id_idx' });
  // Supports expiry sweeps and expired-session lookups.
  pgm.createIndex('admin_sessions', 'expires_at', { name: 'admin_sessions_expires_at_idx' });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Sessions first: they hold the foreign key to admin_users.
  pgm.dropTable('admin_sessions');
  pgm.dropTable('admin_users');
};
