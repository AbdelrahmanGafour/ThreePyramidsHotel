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

// V1 policy: length plus at least one digit. No case or symbol rules, which
// push people towards shorter, more predictable passwords.
const MIN_PASSWORD_LENGTH = 9;
const DIGIT_PATTERN = /[0-9]/;

const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;
const DOMAIN_LABEL_PATTERN = /^[A-Za-z0-9-]+$/;

function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

/**
 * Deliberately modest structural validation, not RFC 5322: it catches
 * malformed addresses, never typos in an otherwise valid one.
 */
function assertValidEmail(email: string): void {
  if (email.length > MAX_EMAIL_LENGTH) {
    throw new Error(`ADMIN_EMAIL must be ${MAX_EMAIL_LENGTH} characters or fewer`);
  }
  if (/\s/.test(email)) {
    throw new Error('ADMIN_EMAIL must not contain spaces');
  }

  const parts = email.split('@');

  if (parts.length !== 2) {
    throw new Error('ADMIN_EMAIL must contain exactly one @');
  }

  const [localPart = '', domain = ''] = parts;

  if (localPart.length === 0) {
    throw new Error('ADMIN_EMAIL must have something before the @');
  }
  if (localPart.length > MAX_LOCAL_PART_LENGTH) {
    throw new Error(`ADMIN_EMAIL must have ${MAX_LOCAL_PART_LENGTH} characters or fewer before the @`);
  }
  if (domain.length === 0) {
    throw new Error('ADMIN_EMAIL must have a domain after the @');
  }
  if (!domain.includes('.')) {
    throw new Error('ADMIN_EMAIL domain must contain a dot, for example example.com');
  }
  if (domain.startsWith('.') || domain.endsWith('.')) {
    throw new Error('ADMIN_EMAIL domain must not start or end with a dot');
  }

  for (const label of domain.split('.')) {
    if (label.length === 0) {
      throw new Error('ADMIN_EMAIL domain must not contain an empty part');
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      throw new Error('ADMIN_EMAIL domain parts must not start or end with a hyphen');
    }
    if (!DOMAIN_LABEL_PATTERN.test(label)) {
      throw new Error('ADMIN_EMAIL domain may contain only letters, digits and hyphens');
    }
  }
}

function assertValidPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!DIGIT_PATTERN.test(password)) {
    throw new Error('ADMIN_PASSWORD must contain at least one digit (0-9)');
  }
}

async function createAdmin(): Promise<void> {
  // Normalized to match the database's lowercase/trimmed email constraints.
  const email = requireEnv('ADMIN_EMAIL').trim().toLowerCase();
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
