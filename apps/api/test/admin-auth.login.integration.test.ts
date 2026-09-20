import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

// Runs the real login endpoint over HTTP against a real PostgreSQL database.
// It creates its own admin accounts with unique emails, never touching a
// developer's own account, and removes them afterwards.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');
type PasswordModule = typeof import('../src/modules/admin-auth/admin-auth.password.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let hashPassword: PasswordModule['hashPassword'];

let server: Server;
let baseUrl: string;

const runId = randomUUID().slice(0, 8);
const activeAdmin = {
  email: `itest-admin-${runId}@example.com`,
  displayName: `Integration Admin ${runId}`,
  password: `fixture-password-${runId}`,
};
const inactiveAdmin = {
  email: `itest-admin-inactive-${runId}@example.com`,
  displayName: `Inactive Admin ${runId}`,
  password: `fixture-password-inactive-${runId}`,
};
const fixtureEmails = [activeAdmin.email, inactiveAdmin.email];

/** The stored hash for the active fixture, so concurrent-change tests can restore it. */
let activeAdminHash = '';

async function insertAdmin(admin: typeof activeAdmin, isActive: boolean): Promise<string> {
  const passwordHash = await hashPassword(admin.password);

  await dbPool.query(
    `INSERT INTO admin_users (email, display_name, password_hash, is_active)
     VALUES ($1, $2, $3, $4)`,
    [admin.email, admin.displayName, passwordHash, isActive],
  );

  return passwordHash;
}

/** Sends a body exactly as given, so the JSON parser sees what the test wrote. */
async function postRawLogin(raw: string): Promise<{ status: number; json: any; setCookie: string[] }> {
  const response = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  });

  return {
    status: response.status,
    json: await response.json(),
    setCookie: response.headers.getSetCookie(),
  };
}

async function postLogin(body: unknown): Promise<{ status: number; json: any; setCookie: string[] }> {
  return postRawLogin(JSON.stringify(body));
}

const sessionCountFor = async (email: string): Promise<number> => {
  const { rows } = await dbPool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_user_id
      WHERE u.email = $1`,
    [email],
  );

  return rows[0]?.count ?? 0;
};

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  ({ hashPassword } = await import('../src/modules/admin-auth/admin-auth.password.js'));

  const { createApp } = await import('../src/app.js');
  const app = createApp();

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  activeAdminHash = await insertAdmin(activeAdmin, true);
  await insertAdmin(inactiveAdmin, false);
});

/**
 * Runs a login while the admin row is changed underneath it.
 *
 * A blocking transaction holds the row lock from the start, so login's first
 * (unlocked) read still sees the original account, and its later `FOR UPDATE`
 * can only proceed once the change has committed. The short delay just lets
 * that first read happen before the change lands; scrypt verification, which
 * runs next, is far slower than the wait.
 */
async function loginWhileAdminChanges(change: string, values: unknown[]): Promise<Awaited<ReturnType<typeof postLogin>>> {
  const blocker = await dbPool.connect();

  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM admin_users WHERE email = $1 FOR UPDATE', [activeAdmin.email]);

    const pending = postLogin({ email: activeAdmin.email, password: activeAdmin.password });

    await new Promise((resolve) => setTimeout(resolve, 25));
    await blocker.query(change, values);
    await blocker.query('COMMIT');

    return await pending;
  } finally {
    blocker.release();
  }
}

after(async () => {
  try {
    // Sessions cascade with their account, but delete explicitly so the order
    // is obvious and the verification below is meaningful.
    await dbPool.query(
      `DELETE FROM admin_sessions
        WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = ANY($1::text[]))`,
      [fixtureEmails],
    );
    await dbPool.query('DELETE FROM admin_users WHERE email = ANY($1::text[])', [fixtureEmails]);

    const { rows } = await dbPool.query<{ admins: number; sessions: number }>(
      `SELECT (SELECT COUNT(*) FROM admin_users WHERE email = ANY($1::text[]))::int AS admins,
              (SELECT COUNT(*) FROM admin_sessions s
                 JOIN admin_users u ON u.id = s.admin_user_id
                WHERE u.email = ANY($1::text[]))::int AS sessions`,
      [fixtureEmails],
    );

    assert.deepEqual(rows[0], { admins: 0, sessions: 0 }, 'fixture admins were not fully removed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDatabasePool();
  }
});

describe('POST /api/v1/admin/auth/login', () => {
  it('signs in an active admin and opens exactly one session', async () => {
    const before = Date.now();
    const response = await postLogin({ email: activeAdmin.email, password: activeAdmin.password });
    const after = Date.now();

    assert.equal(response.status, 200);
    // Only safe fields, and nothing internal.
    assert.deepEqual(response.json, {
      data: { administrator: { email: activeAdmin.email, displayName: activeAdmin.displayName } },
    });

    const cookieHeader = response.setCookie.find((value) => value.startsWith('tph_admin_session='));
    assert.ok(cookieHeader, 'expected a tph_admin_session cookie');
    assert.match(cookieHeader, /HttpOnly/i);
    assert.match(cookieHeader, /SameSite=Lax/i);
    assert.match(cookieHeader, /Path=\//i);

    const rawToken = decodeURIComponent(cookieHeader.split(';')[0]!.split('=')[1]!);
    assert.match(rawToken, /^[A-Za-z0-9_-]{43}$/);

    const serialized = JSON.stringify(response.json);
    assert.ok(!serialized.includes(rawToken), 'raw token must not appear in the response body');
    assert.ok(!serialized.includes('password'), 'response must not mention a password');

    const { rows } = await dbPool.query<{
      token_hash: string;
      expires_at: Date;
      revoked_at: Date | null;
      count: string;
    }>(
      `SELECT s.token_hash, s.expires_at, s.revoked_at
         FROM admin_sessions s
         JOIN admin_users u ON u.id = s.admin_user_id
        WHERE u.email = $1`,
      [activeAdmin.email],
    );

    assert.equal(rows.length, 1, 'expected exactly one session row');
    const session = rows[0]!;

    assert.notEqual(session.token_hash, rawToken, 'the raw token must not be stored');
    assert.equal(session.token_hash, createHash('sha256').update(rawToken, 'utf8').digest('hex'));
    assert.equal(session.revoked_at, null);

    // Default TTL is 12 hours; allow for the time the request itself took.
    const twelveHours = 12 * 60 * 60 * 1000;
    assert.ok(
      session.expires_at.getTime() >= before + twelveHours - 5000 &&
        session.expires_at.getTime() <= after + twelveHours + 5000,
      `expires_at ${session.expires_at.toISOString()} outside the expected TTL window`,
    );

    await dbPool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [session.token_hash]);
  });

  it('refuses an unknown email, a wrong password and an inactive account identically', async () => {
    const unknown = await postLogin({
      email: `itest-missing-${runId}@example.com`,
      password: activeAdmin.password,
    });
    const wrongPassword = await postLogin({ email: activeAdmin.email, password: 'not-the-password' });
    const inactive = await postLogin({ email: inactiveAdmin.email, password: inactiveAdmin.password });

    for (const response of [unknown, wrongPassword, inactive]) {
      assert.equal(response.status, 401);
      assert.deepEqual(response.json, {
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      assert.equal(response.setCookie.length, 0, 'a failed login must not set a cookie');
    }

    // Byte-identical responses: nothing distinguishes the three cases.
    assert.equal(JSON.stringify(unknown.json), JSON.stringify(wrongPassword.json));
    assert.equal(JSON.stringify(wrongPassword.json), JSON.stringify(inactive.json));

    assert.equal(await sessionCountFor(activeAdmin.email), 0, 'no session for a failed login');
    assert.equal(await sessionCountFor(inactiveAdmin.email), 0, 'no session for an inactive admin');
  });

  it('rejects malformed JSON with 400 INVALID_JSON', async () => {
    // The body never reaches the login module: the JSON parser refuses it
    // first, which is the Sprint 1 contract for an unreadable body. Top-level
    // scalars belong here too, since express.json() is strict about them.
    const rawBodies = ['{"email":', 'not json at all', '"email=admin"', 'null', '42'];

    for (const raw of rawBodies) {
      const response = await postRawLogin(raw);
      const context = `raw body: ${JSON.stringify(raw)}`;

      assert.equal(response.status, 400, `expected 400 for ${context}`);
      assert.deepEqual(
        response.json,
        { error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' } },
        `expected INVALID_JSON for ${context}`,
      );
      assert.equal(response.setCookie.length, 0, `unexpected cookie for ${context}`);
    }

    assert.equal(await sessionCountFor(activeAdmin.email), 0);
  });

  it('treats an empty request body as an invalid login, not malformed JSON', async () => {
    // An empty body parses to an empty object rather than failing, so it is the
    // login module that refuses it.
    const response = await postRawLogin('');

    assert.equal(response.status, 400);
    assert.deepEqual(response.json, {
      error: { code: 'INVALID_LOGIN', message: 'Invalid login request' },
    });
    assert.equal(response.setCookie.length, 0);
    assert.equal(await sessionCountFor(activeAdmin.email), 0);
  });

  it('rejects valid JSON that is not a login request with 400 INVALID_LOGIN', async () => {
    // Parsed successfully, then refused by the login module itself.
    const bodies = [
      {},
      [],
      { email: activeAdmin.email },
      { password: activeAdmin.password },
      { email: activeAdmin.email, password: '' },
      { email: 'not-an-email', password: activeAdmin.password },
      { email: 42, password: activeAdmin.password },
      [{ email: activeAdmin.email, password: activeAdmin.password }],
    ];

    for (const body of bodies) {
      const response = await postLogin(body);
      const context = `body: ${JSON.stringify(body)}`;

      assert.equal(response.status, 400, `expected 400 for ${context}`);
      assert.deepEqual(
        response.json,
        { error: { code: 'INVALID_LOGIN', message: 'Invalid login request' } },
        `expected INVALID_LOGIN for ${context}`,
      );
      assert.equal(response.setCookie.length, 0, `unexpected cookie for ${context}`);
    }

    assert.equal(await sessionCountFor(activeAdmin.email), 0);
  });

  it('creates no session when the account is deactivated during verification', async () => {
    const response = await loginWhileAdminChanges(
      'UPDATE admin_users SET is_active = false, updated_at = now() WHERE email = $1',
      [activeAdmin.email],
    );

    assert.equal(response.status, 401);
    assert.deepEqual(response.json, {
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
    assert.equal(response.setCookie.length, 0);
    assert.equal(await sessionCountFor(activeAdmin.email), 0);

    await dbPool.query('UPDATE admin_users SET is_active = true WHERE email = $1', [activeAdmin.email]);
  });

  it('creates no session when the password is changed during verification', async () => {
    const replacementHash = await hashPassword(`replacement-password-${runId}`);

    const response = await loginWhileAdminChanges(
      'UPDATE admin_users SET password_hash = $2, updated_at = now() WHERE email = $1',
      [activeAdmin.email, replacementHash],
    );

    assert.equal(response.status, 401);
    assert.deepEqual(response.json, {
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
    assert.equal(response.setCookie.length, 0);
    assert.equal(await sessionCountFor(activeAdmin.email), 0);

    await dbPool.query('UPDATE admin_users SET password_hash = $2 WHERE email = $1', [
      activeAdmin.email,
      activeAdminHash,
    ]);

    // The original password works again once the row is restored.
    const recovered = await postLogin({ email: activeAdmin.email, password: activeAdmin.password });
    assert.equal(recovered.status, 200);
    await dbPool.query(
      `DELETE FROM admin_sessions
        WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = $1)`,
      [activeAdmin.email],
    );
  });

  it('rejects server-controlled fields in the body, even with correct credentials', async () => {
    for (const field of ['id', 'isActive', 'passwordHash', 'token', 'tokenHash', 'expiresAt']) {
      const response = await postLogin({
        email: activeAdmin.email,
        password: activeAdmin.password,
        [field]: 'x',
      });

      assert.equal(response.status, 400, `expected 400 when sending ${field}`);
      assert.deepEqual(response.json, {
        error: { code: 'INVALID_LOGIN', message: 'Invalid login request' },
      });
      assert.equal(response.setCookie.length, 0);
    }

    assert.equal(await sessionCountFor(activeAdmin.email), 0, 'no session from a rejected request');
  });
});
