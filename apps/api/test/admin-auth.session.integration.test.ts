import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { toNumbers } from './support/core-sql';

// Exercises GET /api/v1/admin/auth/session and the session guard over real HTTP
// against a real MySQL database, using its own admin accounts.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');
type PasswordModule = typeof import('../src/modules/admin-auth/admin-auth.password.js');
type SessionModule = typeof import('../src/modules/admin-auth/admin-auth.session.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let hashPassword: PasswordModule['hashPassword'];
let generateSessionToken: SessionModule['generateSessionToken'];
let hashSessionToken: SessionModule['hashSessionToken'];

let server: Server;
let baseUrl: string;
let sessionCookie = '';

const runId = randomUUID().slice(0, 8);
const activeAdmin = {
  email: `itest-session-${runId}@example.com`,
  displayName: `Session Admin ${runId}`,
  password: `fixture-password-${runId}`,
};
const inactiveAdmin = {
  email: `itest-session-inactive-${runId}@example.com`,
  displayName: `Inactive Session Admin ${runId}`,
  password: `fixture-password-inactive-${runId}`,
};
const fixtureEmails = [activeAdmin.email, inactiveAdmin.email];

const NOT_AUTHENTICATED = {
  error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' },
};

async function insertAdmin(admin: typeof activeAdmin, isActive: boolean): Promise<void> {
  await dbPool.query(
    `INSERT INTO admin_users (email, display_name, password_hash, is_active)
     VALUES ($1, $2, $3, $4)`,
    [admin.email, admin.displayName, await hashPassword(admin.password), isActive],
  );
}

/** Creates a session row directly, so expiry and revocation can be set exactly. */
async function insertSessionFor(
  email: string,
  options: { expiresInSeconds?: number; createdAgoSeconds?: number; revoked?: boolean } = {},
): Promise<string> {
  const rawToken = generateSessionToken();
  const { expiresInSeconds = 3600, createdAgoSeconds = 60, revoked = false } = options;

  await dbPool.query(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at, created_at, revoked_at)
     SELECT id, $2, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL $3 SECOND), DATE_SUB(UTC_TIMESTAMP(3), INTERVAL $4 SECOND), ${revoked ? 'UTC_TIMESTAMP(3)' : 'NULL'}
       FROM admin_users
      WHERE email = $1`,
    [email, hashSessionToken(rawToken), expiresInSeconds, createdAgoSeconds],
  );

  return rawToken;
}

async function getSession(cookie?: string): Promise<{ status: number; json: any; setCookie: string[] }> {
  const response = await fetch(`${baseUrl}/api/v1/admin/auth/session`, {
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });

  return {
    status: response.status,
    json: await response.json(),
    setCookie: response.headers.getSetCookie(),
  };
}

const sessionRowsFor = async (email: string) => {
  const { rows } = await dbPool.query<{ token_hash: string; expires_at: Date }>(
    `SELECT s.token_hash, s.expires_at
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_user_id
      WHERE u.email = $1
      ORDER BY s.id`,
    [email],
  );

  return rows;
};

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  ({ hashPassword } = await import('../src/modules/admin-auth/admin-auth.password.js'));
  ({ generateSessionToken, hashSessionToken } = await import(
    '../src/modules/admin-auth/admin-auth.session.js'
  ));

  const { createApp } = await import('../src/app.js');
  const app = createApp();

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await insertAdmin(activeAdmin, true);
  await insertAdmin(inactiveAdmin, false);

  // The cookie under test comes from a real login, not a hand-made row.
  const loginResponse = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: activeAdmin.email, password: activeAdmin.password }),
  });

  assert.equal(loginResponse.status, 200, 'fixture login failed');
  const setCookie = loginResponse.headers.getSetCookie().find((value) => value.startsWith('tph_admin_session='));
  assert.ok(setCookie, 'fixture login returned no session cookie');
  sessionCookie = setCookie.split(';')[0]!;
});

after(async () => {
  try {
    await dbPool.query(
      `DELETE FROM admin_sessions
        WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email IN ($1))`,
      [fixtureEmails],
    );
    await dbPool.query('DELETE FROM admin_users WHERE email IN ($1)', [fixtureEmails]);

    const { rows } = await dbPool.query<{ admins: number; sessions: number }>(
      `SELECT (SELECT COUNT(*) FROM admin_users WHERE email IN ($1)) AS admins,
              (SELECT COUNT(*) FROM admin_sessions s
                 JOIN admin_users u ON u.id = s.admin_user_id
                WHERE u.email IN ($1)) AS sessions`,
      [fixtureEmails],
    );

    assert.deepEqual(rows[0] && toNumbers(rows[0]), { admins: 0, sessions: 0 }, 'fixture admins were not fully removed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDatabasePool();
  }
});

describe('GET /api/v1/admin/auth/session', () => {
  it('is guarded by requireAdminSession rather than by controller logic', async () => {
    const { adminAuthRouter } = await import('../src/modules/admin-auth/admin-auth.routes.js');
    const layers = (adminAuthRouter as unknown as { stack: any[] }).stack;
    const route = layers.map((layer) => layer.route).find((candidate) => candidate?.path === '/session');

    assert.ok(route, 'expected a /session route');
    const handlers = route.stack.map((layer: any) => layer.handle?.name);

    assert.deepEqual(handlers, ['requireAdminSession', 'adminSessionHandler']);
  });

  it('returns the signed-in administrator for a valid session cookie', async () => {
    const response = await getSession(sessionCookie);

    assert.equal(response.status, 200);
    // Only the safe identity: no id, token, session metadata or timestamps.
    assert.deepEqual(response.json, {
      data: { administrator: { email: activeAdmin.email, displayName: activeAdmin.displayName } },
    });
  });

  it('reads the session without changing or re-issuing it', async () => {
    const before = await sessionRowsFor(activeAdmin.email);
    assert.equal(before.length, 1, 'expected exactly one session from the fixture login');

    const response = await getSession(sessionCookie);
    assert.equal(response.status, 200);
    assert.equal(response.setCookie.length, 0, 'GET /session must not set a cookie');

    const after = await sessionRowsFor(activeAdmin.email);
    assert.equal(after.length, 1, 'GET /session must not create another session row');
    assert.equal(after[0]!.token_hash, before[0]!.token_hash);
    assert.equal(
      after[0]!.expires_at.getTime(),
      before[0]!.expires_at.getTime(),
      'GET /session must not extend expires_at',
    );
  });

  it('refuses a missing, malformed or duplicated cookie identically', async () => {
    const token = sessionCookie.split('=')[1]!;
    const cases: [string, string | undefined][] = [
      ['no cookie header', undefined],
      ['unrelated cookies only', 'theme=dark; locale=en-GB'],
      ['empty value', 'tph_admin_session='],
      ['too short', 'tph_admin_session=not-a-token'],
      ['padded base64', `tph_admin_session=${token.slice(0, 42)}=`],
      ['non-base64url character', `tph_admin_session=${token.slice(0, 42)}+`],
      ['duplicated cookie', `tph_admin_session=${token}; tph_admin_session=${token}`],
      ['duplicated with a second token', `tph_admin_session=${token}; tph_admin_session=${generateSessionToken()}`],
    ];

    for (const [label, cookie] of cases) {
      const response = await getSession(cookie);

      assert.equal(response.status, 401, `expected 401 for ${label}`);
      assert.deepEqual(response.json, NOT_AUTHENTICATED, `expected NOT_AUTHENTICATED for ${label}`);
      assert.equal(response.setCookie.length, 0, `unexpected cookie for ${label}`);
    }
  });

  it('refuses an unknown, expired or revoked session identically', async () => {
    const unknownToken = generateSessionToken();
    const expiredToken = await insertSessionFor(activeAdmin.email, {
      expiresInSeconds: -3600,
      createdAgoSeconds: 7200,
    });
    const revokedToken = await insertSessionFor(activeAdmin.email, { revoked: true });

    for (const [label, token] of [
      ['unknown token', unknownToken],
      ['expired session', expiredToken],
      ['revoked session', revokedToken],
    ] as const) {
      const response = await getSession(`tph_admin_session=${token}`);

      assert.equal(response.status, 401, `expected 401 for ${label}`);
      assert.deepEqual(response.json, NOT_AUTHENTICATED, `expected NOT_AUTHENTICATED for ${label}`);
      assert.equal(response.setCookie.length, 0);
    }

    await dbPool.query('DELETE FROM admin_sessions WHERE token_hash IN ($1)', [
      [hashSessionToken(expiredToken), hashSessionToken(revokedToken)],
    ]);
  });

  it('refuses a live session belonging to an inactive administrator', async () => {
    const token = await insertSessionFor(inactiveAdmin.email);

    const response = await getSession(`tph_admin_session=${token}`);

    assert.equal(response.status, 401);
    assert.deepEqual(response.json, NOT_AUTHENTICATED);
    assert.equal(response.setCookie.length, 0);

    await dbPool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [hashSessionToken(token)]);
  });

  it('refuses the session of an administrator deactivated after signing in', async () => {
    await dbPool.query('UPDATE admin_users SET is_active = false WHERE email = $1', [activeAdmin.email]);

    const response = await getSession(sessionCookie);

    assert.equal(response.status, 401);
    assert.deepEqual(response.json, NOT_AUTHENTICATED);

    await dbPool.query('UPDATE admin_users SET is_active = true WHERE email = $1', [activeAdmin.email]);

    // The same cookie works again once the account is active: the session row
    // itself was never touched.
    const recovered = await getSession(sessionCookie);
    assert.equal(recovered.status, 200);
  });
});
