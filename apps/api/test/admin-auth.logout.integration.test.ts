import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { toNumbers } from './support/core-sql';

// Exercises POST /api/v1/admin/auth/logout over real HTTP against a real
// MySQL database, using its own admin account.
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

const runId = randomUUID().slice(0, 8);
const admin = {
  email: `itest-logout-${runId}@example.com`,
  displayName: `Logout Admin ${runId}`,
  password: `fixture-password-${runId}`,
};

/** Signs in and returns the `name=value` cookie pair for later requests. */
async function loginForCookie(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: admin.password }),
  });

  assert.equal(response.status, 200, 'fixture login failed');
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith('tph_admin_session='));
  assert.ok(setCookie, 'fixture login returned no session cookie');

  return setCookie.split(';')[0]!;
}

async function postLogout(cookie?: string): Promise<{ status: number; body: string; setCookie: string[] }> {
  const response = await fetch(`${baseUrl}/api/v1/admin/auth/logout`, {
    method: 'POST',
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });

  return {
    status: response.status,
    body: await response.text(),
    setCookie: response.headers.getSetCookie(),
  };
}

async function getSessionStatus(cookie: string): Promise<number> {
  const response = await fetch(`${baseUrl}/api/v1/admin/auth/session`, { headers: { Cookie: cookie } });

  return response.status;
}

const sessionHashes = async (): Promise<string[]> => {
  const { rows } = await dbPool.query<{ token_hash: string }>(
    `SELECT s.token_hash
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_user_id
      WHERE u.email = $1
      ORDER BY s.id`,
    [admin.email],
  );

  return rows.map((row) => row.token_hash);
};

const tokenOf = (cookie: string) => cookie.split('=')[1]!;

/** A clearing header: same attributes as when set, with an expiry in the past. */
function assertClearsSessionCookie(setCookie: string[]): void {
  const header = setCookie.find((value) => value.startsWith('tph_admin_session='));

  assert.ok(header, 'expected a tph_admin_session clearing cookie');
  assert.match(header, /^tph_admin_session=;/, 'clearing cookie must carry an empty value');
  assert.match(header, /Expires=Thu, 01 Jan 1970|Max-Age=0/i, 'clearing cookie must expire immediately');
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Lax/i);
  assert.match(header, /Path=\//i);
}

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

  await dbPool.query(
    `INSERT INTO admin_users (email, display_name, password_hash, is_active)
     VALUES ($1, $2, $3, true)`,
    [admin.email, admin.displayName, await hashPassword(admin.password)],
  );
});

after(async () => {
  try {
    await dbPool.query(
      `DELETE FROM admin_sessions
        WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = $1)`,
      [admin.email],
    );
    await dbPool.query('DELETE FROM admin_users WHERE email = $1', [admin.email]);

    const { rows } = await dbPool.query<{ admins: number; sessions: number }>(
      `SELECT (SELECT COUNT(*) FROM admin_users WHERE email = $1) AS admins,
              (SELECT COUNT(*) FROM admin_sessions s
                 JOIN admin_users u ON u.id = s.admin_user_id
                WHERE u.email = $1) AS sessions`,
      [admin.email],
    );

    assert.deepEqual(rows[0] && toNumbers(rows[0]), { admins: 0, sessions: 0 }, 'fixture admin was not fully removed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDatabasePool();
  }
});

describe('POST /api/v1/admin/auth/logout', () => {
  it('ends the presented session and clears the cookie', async () => {
    const cookie = await loginForCookie();
    assert.deepEqual(await sessionHashes(), [hashSessionToken(tokenOf(cookie))]);

    const response = await postLogout(cookie);

    assert.equal(response.status, 204);
    assert.equal(response.body, '', '204 must carry no body');
    assertClearsSessionCookie(response.setCookie);

    assert.deepEqual(await sessionHashes(), [], 'the session row must be gone');
    assert.equal(await getSessionStatus(cookie), 401, 'the old cookie must no longer authenticate');
  });

  it('is idempotent when repeated with the same cookie', async () => {
    const cookie = await loginForCookie();

    assert.equal((await postLogout(cookie)).status, 204);
    const second = await postLogout(cookie);

    assert.equal(second.status, 204);
    assert.equal(second.body, '');
    assertClearsSessionCookie(second.setCookie);
    assert.deepEqual(await sessionHashes(), []);
  });

  it('answers 204 for a missing, malformed or unknown session', async () => {
    const cases: [string, string | undefined][] = [
      ['no cookie header', undefined],
      ['unrelated cookies only', 'theme=dark; locale=en-GB'],
      ['empty value', 'tph_admin_session='],
      ['too short', 'tph_admin_session=not-a-token'],
      ['duplicated cookie', `tph_admin_session=${generateSessionToken()}; tph_admin_session=${generateSessionToken()}`],
      ['unknown canonical token', `tph_admin_session=${generateSessionToken()}`],
    ];

    for (const [label, cookie] of cases) {
      const response = await postLogout(cookie);

      assert.equal(response.status, 204, `expected 204 for ${label}`);
      assert.equal(response.body, '', `expected an empty body for ${label}`);
      assertClearsSessionCookie(response.setCookie);
    }

    assert.deepEqual(await sessionHashes(), [], 'logout must not create a session');
  });

  it('ends only the presented session when the admin has several', async () => {
    const first = await loginForCookie();
    const second = await loginForCookie();
    const third = await loginForCookie();

    const before = await sessionHashes();
    assert.equal(before.length, 3, 'expected three sessions for one admin');

    const response = await postLogout(second);
    assert.equal(response.status, 204);

    const remaining = await sessionHashes();
    assert.equal(remaining.length, 2, 'exactly one session must be removed');
    assert.ok(!remaining.includes(hashSessionToken(tokenOf(second))));
    assert.deepEqual(
      [...remaining].sort(),
      [hashSessionToken(tokenOf(first)), hashSessionToken(tokenOf(third))].sort(),
    );

    // The other sessions keep working.
    assert.equal(await getSessionStatus(first), 200);
    assert.equal(await getSessionStatus(third), 200);
    assert.equal(await getSessionStatus(second), 401);

    await postLogout(first);
    await postLogout(third);
    assert.deepEqual(await sessionHashes(), []);
  });
});
