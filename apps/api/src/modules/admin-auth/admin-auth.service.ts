import { dbPool } from '../../db/pool';
import { verifyPassword } from './admin-auth.password';
import {
  deleteExpiredSessions,
  deleteSessionByTokenHash,
  findAdminByEmail,
  insertSession,
  lockAdminById,
} from './admin-auth.repository';
import {
  generateSessionToken,
  getSessionTtlMs,
  hashSessionToken,
  readSessionCookie,
} from './admin-auth.session';
import { parseAdminLoginInput } from './admin-auth.validation';
import { InvalidCredentialsError, type AdminLoginResult } from './admin-auth.types';

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
