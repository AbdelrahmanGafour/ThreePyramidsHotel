// ===========================================================================
// DEVELOPMENT ADMIN ACCOUNT - creates or resets one staff login.
//
// Credentials come only from the environment; nothing is hard-coded here, and
// neither the password nor its hash is ever printed. Safe to re-run: an
// existing account with the same email is updated rather than duplicated, and
// its existing sessions are invalidated.
//
// Set the password without leaving it in shell history:
//
//   PowerShell
//     $env:ADMIN_EMAIL = 'admin@example.com'
//     $env:ADMIN_DISPLAY_NAME = 'Hotel manager'
//     $secure = Read-Host "Admin password" -AsSecureString
//     $cred = New-Object System.Management.Automation.PSCredential("admin", $secure)
//     $env:ADMIN_PASSWORD = $cred.GetNetworkCredential().Password
//     npm run admin:create -w apps/api
//     Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
//     Remove-Variable secure, cred -ErrorAction SilentlyContinue
//
//   bash / zsh
//     read -rs -p 'Admin password: ' ADMIN_PASSWORD; echo
//     export ADMIN_EMAIL='admin@example.com' ADMIN_DISPLAY_NAME='Hotel manager' ADMIN_PASSWORD
//     npm run admin:create -w apps/api
//
// Clear the variables afterwards, and avoid typing the password inline.
// ===========================================================================

import { closeDatabasePool, dbPool } from '../pool';
import { hashPassword } from '../../modules/admin-auth/admin-auth.password';
import {
  describeAdminEmailProblem,
  describeAdminPasswordProblem,
  normalizeAdminEmail,
} from '../../modules/admin-auth/admin-auth.policy';

// The email syntax rules and the password policy live in
// admin-auth.policy.ts, shared with the login validator and the account
// settings endpoints. They used to be copied here, which meant three places
// could disagree about what may be stored. Each rule still reports itself, so
// the messages below stay per-rule and operator-facing.

function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

/**
 * Reports the one rule the address breaks, in the shared policy's words.
 *
 * Deliberately modest structural validation, not RFC 5322: it catches
 * malformed addresses, never typos in an otherwise valid one. The rules are
 * the same ones login and account settings apply, because an address this
 * script can store must be one they can accept.
 */
function assertValidEmail(email: string): void {
  const problem = describeAdminEmailProblem(email);

  if (problem) {
    throw new Error(`ADMIN_EMAIL ${problem}`);
  }
}

function assertValidPassword(password: string): void {
  const problem = describeAdminPasswordProblem(password);

  if (problem) {
    throw new Error(`ADMIN_PASSWORD ${problem}`);
  }
}

async function createAdmin(): Promise<void> {
  // Normalized to match the database's lowercase/trimmed email constraints.
  const email = normalizeAdminEmail(requireEnv('ADMIN_EMAIL'));
  const displayName = requireEnv('ADMIN_DISPLAY_NAME').trim();
  // Not trimmed: leading or trailing spaces are part of the password.
  const password = requireEnv('ADMIN_PASSWORD');

  assertValidEmail(email);

  if (displayName.length === 0) {
    throw new Error('ADMIN_DISPLAY_NAME must not be blank');
  }

  assertValidPassword(password);

  const passwordHash = await hashPassword(password);

  const client = await dbPool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    // Read first, so created-vs-updated is a plain observation rather than an
    // inference from a system column.
    const { rows: existingRows } = await client.query<{ id: string }>(
      'SELECT id FROM admin_users WHERE email = $1',
      [email],
    );
    const existed = existingRows.length > 0;

    // ON CONFLICT still covers the rare case of a concurrent insert between the
    // read above and this write.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO admin_users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         password_hash = EXCLUDED.password_hash,
         is_active = true,
         updated_at = now()
       RETURNING id`,
      [email, displayName, passwordHash],
    );

    const row = rows[0];

    if (!row) {
      throw new Error(`Failed to create or update the admin account for ${email}`);
    }

    // Sessions are derived authentication state: a password reset (or
    // reactivating a disabled account) must not leave an old or stolen session
    // usable. Same transaction as the password change, so the two cannot
    // diverge.
    const { rowCount } = await client.query('DELETE FROM admin_sessions WHERE admin_user_id = $1', [
      row.id,
    ]);

    await client.query('COMMIT');
    inTransaction = false;

    console.log(`Admin account ${existed ? 'updated' : 'created'}: ${email} (${displayName})`);
    console.log(`Existing sessions removed: ${rowCount ?? 0}`);
  } catch (error) {
    if (inTransaction) {
      inTransaction = false;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to roll back admin account transaction:', rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

createAdmin()
  .then(async () => {
    await closeDatabasePool();
  })
  .catch(async (error) => {
    console.error('Admin account setup failed:', error instanceof Error ? error.message : error);

    try {
      await closeDatabasePool();
    } catch (closeError) {
      console.error('Failed to close database pool:', closeError);
    }

    process.exit(1);
  });
