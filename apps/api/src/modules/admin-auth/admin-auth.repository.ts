import type { PoolClient } from 'pg';
import { dbPool } from '../../db/pool';
import type { AdminAccount, AuthenticatedAdminSession } from './admin-auth.types';

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
 *
 * The account id is selected alongside the two public fields and returned
 * BESIDE them rather than inside `administrator`. An account endpoint needs
 * the id to act on the session's own row without taking a target parameter;
 * `administrator` is serialised verbatim as the `/session` body, so the id
 * must stay out of it.
 */
export async function findAdminSessionByTokenHash(
  tokenHash: string,
): Promise<AuthenticatedAdminSession | null> {
  const { rows } = await dbPool.query<{ id: string; email: string; display_name: string }>(
    `SELECT u.id,
            u.email,
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

  return row
    ? {
        adminUserId: row.id,
        administrator: { email: row.email, displayName: row.display_name },
      }
    : null;
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

// ---------------------------------------------------------------------------
// Account settings
//
// Every statement below is addressed by the internal id the session resolved
// to. None of them accepts an email or any other caller-supplied identity, so
// there is no shape in which one administrator's request can reach another's
// row.
// ---------------------------------------------------------------------------

/**
 * Reads one account by internal id, outside any transaction.
 *
 * Deliberately on the pool with no client held: the password verification
 * that follows is slow by design, and the login flow already establishes that
 * such work must not hold a connection or an open transaction.
 */
export async function findAdminById(id: string): Promise<AdminAccount | null> {
  const { rows } = await dbPool.query<AdminAccountRow>(
    `SELECT ${ADMIN_COLUMNS}
       FROM admin_users
      WHERE id = $1`,
    [id],
  );

  const row = rows[0];

  return row ? toAdminAccount(row) : null;
}

/**
 * Writes the new address onto the account the caller already locked.
 *
 * `updated_at` moves only on a real change, so setting an address to the one
 * already stored answers success without disturbing the row. The same
 * `IS DISTINCT FROM` guard the journey and room-type status writes use.
 *
 * Uniqueness is not checked here and must not be: a `23505` on
 * `admin_users_email_key` propagates to the service, which is the only thing
 * entitled to say the address is taken. A SELECT beforehand would widen the
 * window in which that answer changes.
 */
export async function updateAdminEmail(
  client: PoolClient,
  id: string,
  email: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE admin_users
        SET email = $2,
            updated_at = CASE WHEN email IS DISTINCT FROM $2 THEN now() ELSE updated_at END
      WHERE id = $1`,
    [id, email],
  );

  return (rowCount ?? 0) > 0;
}

/**
 * Writes the new password hash onto the account the caller already locked.
 *
 * The hash is derived by the caller before the transaction opens; this
 * statement only stores it. `updated_at` moves unconditionally, because a
 * caller only reaches here once the new password has been proved different
 * from the current one.
 */
export async function updateAdminPasswordHash(
  client: PoolClient,
  id: string,
  passwordHash: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE admin_users
        SET password_hash = $2,
            updated_at = now()
      WHERE id = $1`,
    [id, passwordHash],
  );

  return (rowCount ?? 0) > 0;
}

/**
 * Removes every session belonging to one account, the current one included.
 *
 * A hard delete, like every other invalidation in this module: sessions are
 * derived authentication state, not records worth keeping, and `revoked_at`
 * has never been the mechanism here.
 *
 * Runs inside the caller's transaction, alongside the password write, so a
 * committed new password can never leave an old session usable — the same
 * pairing `admin:create` performs when it resets a password.
 */
export async function deleteAllSessionsForAdmin(
  client: PoolClient,
  adminUserId: string,
): Promise<number> {
  const { rowCount } = await client.query('DELETE FROM admin_sessions WHERE admin_user_id = $1', [
    adminUserId,
  ]);

  return rowCount ?? 0;
}
