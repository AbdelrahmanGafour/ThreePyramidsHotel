import type { PoolClient } from 'pg';
import { dbPool } from '../../db/pool';
import type { AdminAccount, AuthenticatedAdministrator } from './admin-auth.types';

type AdminAccountRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  is_active: boolean;
};

const ADMIN_COLUMNS = `id,
       email,
       display_name,
       password_hash,
       is_active`;

function toAdminAccount(row: AdminAccountRow): AdminAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    isActive: row.is_active,
  };
}

/**
 * All SQL for staff authentication lives here.
 *
 * The lookup runs on the pool, deliberately without a transaction or a
 * checked-out client: password verification that follows is slow by design and
 * must not hold either.
 */
export async function findAdminByEmail(email: string): Promise<AdminAccount | null> {
  const { rows } = await dbPool.query<AdminAccountRow>(
    `SELECT ${ADMIN_COLUMNS}
       FROM admin_users
      WHERE email = $1`,
    [email],
  );

  const row = rows[0];

  return row ? toAdminAccount(row) : null;
}

/**
 * Re-reads the account inside the caller's transaction and locks the row, so
 * the state a session is granted against cannot change between the check and
 * the insert.
 */
export async function lockAdminById(client: PoolClient, id: string): Promise<AdminAccount | null> {
  const { rows } = await client.query<AdminAccountRow>(
    `SELECT ${ADMIN_COLUMNS}
       FROM admin_users
      WHERE id = $1
        FOR UPDATE`,
    [id],
  );

  const row = rows[0];

  return row ? toAdminAccount(row) : null;
}

/**
 * Resolves a session token hash to the administrator it authenticates, in one
 * query. A row counts only if the session is neither revoked nor expired and
 * its account is still active, so authentication cannot succeed on a stale
 * session or a disabled account.
 *
 * Read-only: it never touches expiry, and no transaction is needed.
 */
export async function findAdministratorBySessionTokenHash(
  tokenHash: string,
): Promise<AuthenticatedAdministrator | null> {
  const { rows } = await dbPool.query<{ email: string; display_name: string }>(
    `SELECT u.email,
            u.display_name
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.is_active = true`,
    [tokenHash],
  );

  const row = rows[0];

  return row ? { email: row.email, displayName: row.display_name } : null;
}

/**
 * Invalidates exactly the presented session. A hard delete is right here:
 * sessions are derived authentication state, not records worth keeping.
 *
 * It reports nothing about whether a row existed, so logout cannot be used to
 * probe which tokens are real.
 */
export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
  await dbPool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash]);
}

/** Housekeeping for this one account as it signs in; not a general sweep. */
export async function deleteExpiredSessions(client: PoolClient, adminUserId: string): Promise<void> {
  await client.query('DELETE FROM admin_sessions WHERE admin_user_id = $1 AND expires_at <= now()', [
    adminUserId,
  ]);
}

/** Stores only the token hash: the raw token never reaches PostgreSQL. */
export async function insertSession(
  client: PoolClient,
  input: { adminUserId: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await client.query(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [input.adminUserId, input.tokenHash, input.expiresAt],
  );
}
