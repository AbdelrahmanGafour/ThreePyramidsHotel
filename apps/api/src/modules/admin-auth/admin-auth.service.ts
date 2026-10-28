import type { PoolClient } from '../../db/pool';
import { dbPool } from '../../db/pool';
import { hashPassword, verifyPassword } from './admin-auth.password';
import {
  deleteAllSessionsForAdmin,
  deleteExpiredSessions,
  deleteSessionByTokenHash,
  findAdminByEmail,
  findAdminById,
  insertSession,
  lockAdminById,
  updateAdminEmail,
  updateAdminPasswordHash,
} from './admin-auth.repository';
import {
  generateSessionToken,
  getSessionTtlMs,
  hashSessionToken,
  readSessionCookie,
} from './admin-auth.session';
import {
  parseAdminEmailChangeInput,
  parseAdminLoginInput,
  parseAdminPasswordChangeInput,
} from './admin-auth.validation';
import {
  AdminEmailInUseError,
  AdminPasswordUnchangedError,
  InvalidCredentialsError,
  type AdminAccount,
  type AdminLoginResult,
  type AuthenticatedAdministrator,
} from './admin-auth.types';

/**
 * A fixed, valid encoded hash of a password nobody knows: it was derived once,
 * offline, from random bytes that were never recorded, so no plaintext for it
 * exists anywhere. An unknown email is verified against this, so the request
 * still pays for exactly one real scrypt derivation, which reduces the timing
 * distinction between an unknown email and a wrong password.
 *
 * This is practical enumeration resistance, not a claim of constant-time
 * authentication: the rest of the request still varies.
 */
export const DUMMY_PASSWORD_HASH =
  'scrypt$N=16384,r=8,p=1$xLiKhCo8nKu9iS5BThDiEg==$dnuDQDwJIEguyAfk42lH6+2ZCUFuaq/J93ee+Il8M3dxROFjdfivWqs/myC3kn8I0BUd3WQXEFtBDZcMFcn1hA==';

/**
 * Verifies staff credentials and opens a session.
 *
 * Deliberately two phases. Password verification is slow by design, so it runs
 * with no transaction and no checked-out client; only once the credentials look
 * valid does a short transaction open, re-read the account under a row lock and
 * insert the session. An account disabled, deleted or given a new password in
 * between therefore never receives a session.
 *
 * Every failure - unknown email, wrong password, inactive account, and either
 * concurrent change - raises the same error, so a caller cannot tell them apart.
 */
export async function login(body: unknown): Promise<AdminLoginResult> {
  const input = parseAdminLoginInput(body);

  // Phase one: no transaction, no held client.
  const admin = await findAdminByEmail(input.email);
  const encodedHash = admin?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordMatches = await verifyPassword(input.password, encodedHash);

  if (!admin || !admin.isActive || !passwordMatches) {
    throw new InvalidCredentialsError();
  }

  const rawToken = generateSessionToken();
  // One TTL for both the stored expiry and the cookie. The expiry itself is
  // calculated inside the transaction, so waiting for a connection or a row
  // lock is not charged against the session's lifetime.
  const sessionTtlMs = getSessionTtlMs();

  // Phase two: short transaction, no expensive work inside it.
  const client = await dbPool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const current = await lockAdminById(client, admin.id);

    // The account must still exist, still be active, and still carry the very
    // hash that was just verified.
    if (!current || !current.isActive || current.passwordHash !== admin.passwordHash) {
      throw new InvalidCredentialsError();
    }

    await deleteExpiredSessions(client, current.id);

    // Measured here, immediately before the insert, so the full TTL starts when
    // the session actually exists and stays clear of the row's created_at.
    const expiresAt = new Date(Date.now() + sessionTtlMs);

    await insertSession(client, {
      adminUserId: current.id,
      tokenHash: hashSessionToken(rawToken),
      expiresAt,
    });

    await client.query('COMMIT');
    inTransaction = false;

    return {
      administrator: { email: current.email, displayName: current.displayName },
      rawToken,
      sessionTtlMs,
    };
  } catch (error) {
    if (inTransaction) {
      inTransaction = false;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to roll back admin login transaction:', rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

/**
 * Invalidates the session presented by the caller, if there is one.
 *
 * Idempotent by design: a missing, malformed, unknown, expired or already
 * deleted session is simply nothing to do, and never an error. Only the
 * presented session is affected - the administrator's other sessions stay
 * valid.
 *
 * A database failure propagates, so the caller must not clear the browser
 * cookie until this resolves.
 */
export async function logout(cookieHeader: string | undefined): Promise<void> {
  const token = readSessionCookie(cookieHeader);

  if (!token) {
    return;
  }

  await deleteSessionByTokenHash(hashSessionToken(token));
}

// ---------------------------------------------------------------------------
// Account settings — an administrator changing their own email or password
//
// Both follow the same two phases login established, and for the same reason:
// scrypt is slow on purpose, so no derivation may happen while a connection
// is checked out or a transaction is open.
//
//   Phase one, no transaction and no held client
//     read the account by the id the session resolved to
//     verify currentPassword against the stored hash
//     (password change) refuse a new password equal to the current one
//     (password change) derive the new hash
//
//   Phase two, one short transaction
//     BEGIN
//     SELECT ... FOR UPDATE on the same row
//     re-check: still there, still active, still the very hash just verified
//     write
//     (password change) delete every session for the account
//     COMMIT
//
// The re-check is what makes phase one safe to run unlocked. If anything
// about the account changed while the derivation ran — deactivated, deleted,
// or given a different password by another session — the request fails with
// the same `InvalidCredentialsError` a wrong password produces, because from
// the caller's side the credential it presented is no longer current.
//
// Nothing below logs, and no password or hash appears in any thrown message.
// ---------------------------------------------------------------------------

/** PostgreSQL unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** The one index that decides whether an address is free. */
const ADMIN_EMAIL_CONSTRAINT = 'admin_users_email_key';

/**
 * True only for a unique violation on the email index.
 *
 * Both halves matter. A `23505` from any other constraint is a different
 * problem wearing the same number, and reporting it as "that email is taken"
 * would send an administrator to change a value that was never the trouble.
 */
function isEmailInUseViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return candidate.code === UNIQUE_VIOLATION && candidate.constraint === ADMIN_EMAIL_CONSTRAINT;
}

/**
 * Phase one for both operations: load the account and prove the caller knows
 * its current password.
 *
 * No transaction and no held client, because `verifyPassword` runs here.
 *
 * A missing or inactive account raises the same error a wrong password does.
 * The session middleware already refused both, so reaching either here means
 * the account changed mid-request — which is not a distinction the caller is
 * entitled to.
 */
async function verifyCurrentPassword(
  adminUserId: string,
  currentPassword: string,
): Promise<AdminAccount> {
  const admin = await findAdminById(adminUserId);

  if (!admin || !admin.isActive) {
    throw new InvalidCredentialsError();
  }

  if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
    throw new InvalidCredentialsError();
  }

  return admin;
}

/**
 * Phase two, shared: re-read the row under `FOR UPDATE` inside the caller's
 * transaction and confirm it is still exactly the account phase one verified.
 *
 * `verifiedPasswordHash` is compared as a whole string. It is the strongest
 * available statement that nothing changed: a new password produces a new
 * salt and therefore a different encoding even for the same plaintext.
 */
async function relockVerifiedAdmin(
  client: PoolClient,
  adminUserId: string,
  verifiedPasswordHash: string,
): Promise<void> {
  const current = await lockAdminById(client, adminUserId);

  if (!current || !current.isActive || current.passwordHash !== verifiedPasswordHash) {
    throw new InvalidCredentialsError();
  }
}

/**
 * Changes the signed-in administrator's own email.
 *
 * `adminUserId` comes from the verified session, never from the body: there
 * is no field in `AdminEmailChangeInput` naming an account, so this cannot be
 * pointed at somebody else's row.
 *
 * Sessions are deliberately left alone. The credential that authenticates did
 * not change, the current password was just proved, and signing an
 * administrator out of every device for a contact-detail edit would be
 * punishment without a security gain.
 *
 * Setting the address to the one already stored is a success that writes
 * nothing observable: the statement's own `IS DISTINCT FROM` guard leaves
 * `updated_at` where it was.
 */
export async function changeAdminEmail(
  adminUserId: string,
  body: unknown,
): Promise<AuthenticatedAdministrator> {
  const input = parseAdminEmailChangeInput(body);

  // Phase one: no transaction, no held client.
  const admin = await verifyCurrentPassword(adminUserId, input.currentPassword);

  // Phase two: short transaction, no expensive work inside it.
  const client = await dbPool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    await relockVerifiedAdmin(client, adminUserId, admin.passwordHash);

    try {
      const written = await updateAdminEmail(client, adminUserId, input.email);

      if (!written) {
        // The row is held by this transaction's own lock, so it cannot have
        // disappeared. A fault, never a missing account.
        throw new Error('Admin account vanished while its email was being updated');
      }
    } catch (error) {
      if (isEmailInUseViolation(error)) {
        // Another account holds it. The unique index is the only thing that
        // can say so, and it just did.
        throw new AdminEmailInUseError();
      }

      throw error;
    }

    await client.query('COMMIT');
    inTransaction = false;

    return { email: input.email, displayName: admin.displayName };
  } catch (error) {
    if (inTransaction) {
      inTransaction = false;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to roll back admin email change transaction:', rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

/**
 * Changes the signed-in administrator's own password and ends every session
 * the account has, including the one making the request.
 *
 * Revoking all of them is the point, and it is the rule `admin:create`
 * already follows when it resets a password: a session that was open before
 * the change — or stolen before it — must not survive it. The delete and the
 * hash write share one transaction, so the two can never diverge.
 *
 * A new password equal to the current one is refused before any hashing. It
 * is a conflict rather than a validation failure: the value is perfectly
 * legal, it simply changes nothing, and answering "changed" while destroying
 * every session would be a lie with consequences.
 */
export async function changeAdminPassword(adminUserId: string, body: unknown): Promise<void> {
  const input = parseAdminPasswordChangeInput(body);

  // Phase one: no transaction, no held client. Three slow operations live
  // here — the current-password verification, the same-password check and the
  // new derivation — and none of them may hold a connection.
  const admin = await verifyCurrentPassword(adminUserId, input.currentPassword);

  if (await verifyPassword(input.newPassword, admin.passwordHash)) {
    throw new AdminPasswordUnchangedError();
  }

  const newPasswordHash = await hashPassword(input.newPassword);

  // Phase two: short transaction, no expensive work inside it.
  const client = await dbPool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    await relockVerifiedAdmin(client, adminUserId, admin.passwordHash);

    const written = await updateAdminPasswordHash(client, adminUserId, newPasswordHash);

    if (!written) {
      // The row is held by this transaction's own lock, so it cannot have
      // disappeared. A fault, never a missing account.
      throw new Error('Admin account vanished while its password was being updated');
    }

    // Before COMMIT, in the same transaction as the hash: a committed new
    // password with old sessions still live is the one outcome this must be
    // structurally incapable of producing.
    await deleteAllSessionsForAdmin(client, adminUserId);

    await client.query('COMMIT');
    inTransaction = false;
  } catch (error) {
    if (inTransaction) {
      inTransaction = false;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to roll back admin password change transaction:', rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}
