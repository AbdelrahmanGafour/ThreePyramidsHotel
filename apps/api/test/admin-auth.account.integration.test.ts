import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { toNumbers } from './support/core-sql';

// Exercises the two account-settings endpoints over real HTTP against real
// MySQL, using this suite's own admin accounts.
//
// The things that only a real database can answer live here: that the unique
// index is what refuses a taken address, that `updated_at` genuinely does not
// move on a no-op, that a changed password really does log every session out,
// and that the new credential works at the login endpoint while the old one
// stops working.
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

/** The account every test changes. Reset in `beforeEach`. */
const subject = {
  email: `itest-account-${runId}@example.com`,
  displayName: `Account Admin ${runId}`,
  password: `fixture-password-1-${runId}`,
};

/** A second account, so a duplicate address is a real conflict. */
const other = {
  email: `itest-account-other-${runId}@example.com`,
  displayName: `Other Admin ${runId}`,
  password: `fixture-password-2-${runId}`,
};

const fixtureEmails = [subject.email, other.email, `itest-account-moved-${runId}@example.com`];

const NOT_AUTHENTICATED = {
  error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' },
};

async function insertAdmin(admin: typeof subject): Promise<void> {
  await dbPool.query(
    `INSERT INTO admin_users (email, display_name, password_hash, is_active)
     VALUES ($1, $2, $3, true)`,
    [admin.email, admin.displayName, await hashPassword(admin.password)],
  );
}

/** Signs in for real and returns the cookie fragment the browser would send. */
async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  assert.equal(response.status, 200, `login failed for ${email}`);

  const setCookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('tph_admin_session='));

  assert.ok(setCookie, 'login returned no session cookie');

  return setCookie.split(';')[0]!;
}

async function loginStatus(email: string, password: string): Promise<number> {
  const response = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  return response.status;
}

type JsonResponse = { status: number; json: any; setCookie: string[]; text: string };

async function patchAccount(
  path: string,
  body: unknown,
  cookie?: string,
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}/api/v1/admin/auth/account/${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  return {
    status: response.status,
    json: text.length ? JSON.parse(text) : undefined,
    setCookie: response.headers.getSetCookie(),
    text,
  };
}

const accountRow = async (email: string) => {
  const { rows } = await dbPool.query<{
    id: string;
    email: string;
    password_hash: string;
    created_at: Date;
    updated_at: Date;
  }>('SELECT id, email, password_hash, created_at, updated_at FROM admin_users WHERE email = $1', [
    email,
  ]);

  return rows[0];
};

const sessionCountFor = async (adminUserId: string) => {
  const { rows } = await dbPool.query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM admin_sessions WHERE admin_user_id = $1',
    [adminUserId],
  );

  return Number(rows[0]?.count ?? 0);
};

const sessionStatus = async (cookie: string) => {
  const response = await fetch(`${baseUrl}/api/v1/admin/auth/session`, { headers: { Cookie: cookie } });
  return response.status;
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

  await insertAdmin(other);
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

// Each test starts from a freshly created subject account with no sessions, so
// one test's password change cannot decide another's outcome.
beforeEach(async () => {
  await dbPool.query(
    `DELETE FROM admin_sessions
      WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email IN ($1))`,
    [[subject.email, `itest-account-moved-${runId}@example.com`]],
  );
  await dbPool.query('DELETE FROM admin_users WHERE email IN ($1)', [
    [subject.email, `itest-account-moved-${runId}@example.com`],
  ]);
  await insertAdmin(subject);
});

describe('PATCH /account/email', () => {
  it('changes the address and answers with the administrator, and no id', async () => {
    const cookie = await signIn(subject.email, subject.password);
    const moved = `itest-account-moved-${runId}@example.com`;

    const response = await patchAccount('email', { currentPassword: subject.password, email: moved }, cookie);

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      data: { administrator: { email: moved, displayName: subject.displayName } },
    });

    const stored = await accountRow(moved);
    assert.ok(stored, 'the row should now carry the new address');

    // Structural, not a substring scan. `stored.id` is a one- or two-digit
    // bigint while this body legitimately contains digits — the fixture runId
    // is hex — so `text.includes(stored.id)` matched by coincidence and failed
    // in CI. Exact keys are what actually proves nothing internal leaked, and
    // they are stricter: any extra field is refused, not just the id.
    assert.deepEqual(
      Object.keys(response.json.data.administrator).sort(),
      ['displayName', 'email'],
      'the administrator body must carry the two public fields and nothing else',
    );

    // These two stay a substring scan, and safely: a scrypt hash is over a
    // hundred characters and cannot occur by accident, and the word itself
    // appears in no legitimate part of this response.
    assert.ok(
      !response.text.includes(stored.password_hash),
      'the stored password hash must never appear in a response body',
    );
    assert.ok(
      !response.text.includes('password'),
      'no password-related field may appear in a response body',
    );
  });

  it('normalises the submitted address before storing it', async () => {
    const cookie = await signIn(subject.email, subject.password);
    const moved = `itest-account-moved-${runId}@example.com`;

    const response = await patchAccount(
      'email',
      { currentPassword: subject.password, email: `  ${moved.toUpperCase()}  ` },
      cookie,
    );

    assert.equal(response.status, 200);
    assert.equal(response.json.data.administrator.email, moved);
    // The CHECK constraints for lower/trimmed were never the thing that
    // decided this: the value arrived already normalised.
    assert.ok(await accountRow(moved));
  });

  it('lets the new address sign in and stops the old one', async () => {
    const cookie = await signIn(subject.email, subject.password);
    const moved = `itest-account-moved-${runId}@example.com`;

    assert.equal(
      (await patchAccount('email', { currentPassword: subject.password, email: moved }, cookie)).status,
      200,
    );

    assert.equal(await loginStatus(moved, subject.password), 200);
    assert.equal(await loginStatus(subject.email, subject.password), 401);
  });

  it('keeps every session valid', async () => {
    const first = await signIn(subject.email, subject.password);
    const second = await signIn(subject.email, subject.password);
    const moved = `itest-account-moved-${runId}@example.com`;

    assert.equal(
      (await patchAccount('email', { currentPassword: subject.password, email: moved }, first)).status,
      200,
    );

    assert.equal(await sessionStatus(first), 200, 'the requesting session survives');
    assert.equal(await sessionStatus(second), 200, 'and so does the other one');
  });

  it('refuses an address another account already holds, with 409', async () => {
    const cookie = await signIn(subject.email, subject.password);

    const response = await patchAccount(
      'email',
      { currentPassword: subject.password, email: other.email },
      cookie,
    );

    assert.equal(response.status, 409);
    assert.deepEqual(response.json, {
      error: { code: 'ADMIN_EMAIL_IN_USE', message: 'That email address is already in use' },
    });

    // Nothing was written: the original address still resolves.
    assert.ok(await accountRow(subject.email));
    assert.equal(await loginStatus(subject.email, subject.password), 200);
  });

  it('refuses a taken address submitted in a different case', async () => {
    // Uniqueness is on the normalised value, so casing cannot defeat it — and
    // the answer is the conflict, not a CHECK violation turned 500.
    const cookie = await signIn(subject.email, subject.password);

    const response = await patchAccount(
      'email',
      { currentPassword: subject.password, email: `  ${other.email.toUpperCase()}  ` },
      cookie,
    );

    assert.equal(response.status, 409);
    assert.equal(response.json.error.code, 'ADMIN_EMAIL_IN_USE');
  });

  it('treats the current address as a success and does not churn updated_at', async () => {
    const cookie = await signIn(subject.email, subject.password);
    const before = await accountRow(subject.email);
    assert.ok(before);

    const response = await patchAccount(
      'email',
      { currentPassword: subject.password, email: subject.email },
      cookie,
    );

    assert.equal(response.status, 200);

    const stored = await accountRow(subject.email);
    assert.ok(stored);
    assert.equal(
      stored.updated_at.getTime(),
      before.updated_at.getTime(),
      'setting an address to the one already stored changes nothing observable',
    );
  });

  it('moves updated_at on a real change', async () => {
    const cookie = await signIn(subject.email, subject.password);
    const before = await accountRow(subject.email);
    assert.ok(before);
    const moved = `itest-account-moved-${runId}@example.com`;

    assert.equal(
      (await patchAccount('email', { currentPassword: subject.password, email: moved }, cookie)).status,
      200,
    );

    const stored = await accountRow(moved);
    assert.ok(stored);
    assert.ok(stored.updated_at.getTime() >= before.updated_at.getTime());
  });

  it('refuses a wrong current password with 401 and writes nothing', async () => {
    const cookie = await signIn(subject.email, subject.password);
    const moved = `itest-account-moved-${runId}@example.com`;

    const response = await patchAccount(
      'email',
      { currentPassword: `${subject.password}-wrong`, email: moved },
      cookie,
    );

    assert.equal(response.status, 401);
    assert.deepEqual(response.json, {
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
    assert.ok(await accountRow(subject.email), 'the address is unchanged');
  });

  it('refuses a malformed body and a malformed address with 400', async () => {
    const cookie = await signIn(subject.email, subject.password);

    for (const body of [
      {},
      { currentPassword: subject.password },
      { currentPassword: subject.password, email: 'not-an-email' },
      { currentPassword: subject.password, email: 'a@b.com', extra: true },
      { currentPassword: '', email: 'a@b.com' },
    ]) {
      const response = await patchAccount('email', body, cookie);

      assert.equal(response.status, 400, JSON.stringify(body));
      assert.deepEqual(response.json, {
        error: {
          code: 'INVALID_ADMIN_ACCOUNT_UPDATE',
          message: 'Invalid account update request',
        },
      });
    }
  });

  it('refuses an unauthenticated request', async () => {
    const response = await patchAccount('email', {
      currentPassword: subject.password,
      email: 'a@b.com',
    });

    assert.equal(response.status, 401);
    assert.deepEqual(response.json, NOT_AUTHENTICATED);
  });

  it('sets no cookie', async () => {
    const cookie = await signIn(subject.email, subject.password);
    const moved = `itest-account-moved-${runId}@example.com`;

    const response = await patchAccount('email', { currentPassword: subject.password, email: moved }, cookie);

    assert.deepEqual(response.setCookie, [], 'this endpoint does not touch the session cookie');
  });
});

describe('PATCH /account/password', () => {
  const NEW_PASSWORD = `replacement-password-9-${runId}`;

  it('changes the password and answers 204 with no body', async () => {
    const cookie = await signIn(subject.email, subject.password);

    const response = await patchAccount(
      'password',
      { currentPassword: subject.password, newPassword: NEW_PASSWORD },
      cookie,
    );

    assert.equal(response.status, 204);
    assert.equal(response.text, '', 'nothing to report that the caller does not know');
  });

  it('lets the new password sign in and stops the old one', async () => {
    const cookie = await signIn(subject.email, subject.password);

    assert.equal(
      (await patchAccount(
        'password',
        { currentPassword: subject.password, newPassword: NEW_PASSWORD },
        cookie,
      )).status,
      204,
    );

    assert.equal(await loginStatus(subject.email, NEW_PASSWORD), 200);
    assert.equal(await loginStatus(subject.email, subject.password), 401);
  });

  it('deletes every session for the account, the requesting one included', async () => {
    const first = await signIn(subject.email, subject.password);
    const second = await signIn(subject.email, subject.password);
    const row = await accountRow(subject.email);
    assert.ok(row);
    assert.equal(await sessionCountFor(row.id), 2, 'two sessions before the change');

    assert.equal(
      (await patchAccount(
        'password',
        { currentPassword: subject.password, newPassword: NEW_PASSWORD },
        first,
      )).status,
      204,
    );

    assert.equal(await sessionCountFor(row.id), 0, 'and none after it');
    assert.equal(await sessionStatus(first), 401, 'the cookie that made the request is dead');
    assert.equal(await sessionStatus(second), 401, 'and so is every other one');
  });

  it('leaves another account’s sessions alone', async () => {
    const mine = await signIn(subject.email, subject.password);
    const theirs = await signIn(other.email, other.password);

    assert.equal(
      (await patchAccount(
        'password',
        { currentPassword: subject.password, newPassword: NEW_PASSWORD },
        mine,
      )).status,
      204,
    );

    assert.equal(await sessionStatus(theirs), 200, 'the delete is scoped to one account');
  });

  it('stores a different hash even though scrypt salts are random', async () => {
    const cookie = await signIn(subject.email, subject.password);
    const before = await accountRow(subject.email);
    assert.ok(before);

    assert.equal(
      (await patchAccount(
        'password',
        { currentPassword: subject.password, newPassword: NEW_PASSWORD },
        cookie,
      )).status,
      204,
    );

    const stored = await accountRow(subject.email);
    assert.ok(stored);
    assert.notEqual(stored.password_hash, before.password_hash);
    assert.match(stored.password_hash, /^scrypt\$N=16384,r=8,p=1\$/);
    assert.ok(stored.updated_at.getTime() >= before.updated_at.getTime());
  });

  it('refuses a new password equal to the current one with 409, keeping sessions', async () => {
    const cookie = await signIn(subject.email, subject.password);
    const row = await accountRow(subject.email);
    assert.ok(row);

    const response = await patchAccount(
      'password',
      { currentPassword: subject.password, newPassword: subject.password },
      cookie,
    );

    assert.equal(response.status, 409);
    assert.deepEqual(response.json, {
      error: {
        code: 'ADMIN_PASSWORD_UNCHANGED',
        message: 'The new password must be different from the current password',
      },
    });

    assert.equal(await sessionCountFor(row.id), 1, 'a refused change signs nobody out');
    assert.equal(await sessionStatus(cookie), 200);
  });

  it('refuses a wrong current password with 401, keeping sessions and the hash', async () => {
    const cookie = await signIn(subject.email, subject.password);
    const before = await accountRow(subject.email);
    assert.ok(before);

    const response = await patchAccount(
      'password',
      { currentPassword: `${subject.password}-wrong`, newPassword: NEW_PASSWORD },
      cookie,
    );

    assert.equal(response.status, 401);
    assert.equal(response.json.error.code, 'INVALID_CREDENTIALS');

    const stored = await accountRow(subject.email);
    assert.ok(stored);
    assert.equal(stored.password_hash, before.password_hash);
    assert.equal(await sessionCountFor(before.id), 1);
    assert.equal(await loginStatus(subject.email, subject.password), 200);
  });

  it('refuses a new password that breaks the policy with 400', async () => {
    const cookie = await signIn(subject.email, subject.password);

    for (const newPassword of ['short1', 'no digits at all', '12345678']) {
      const response = await patchAccount(
        'password',
        { currentPassword: subject.password, newPassword },
        cookie,
      );

      assert.equal(response.status, 400, newPassword);
      assert.equal(response.json.error.code, 'INVALID_ADMIN_ACCOUNT_UPDATE');
      // The rejected value is never echoed.
      assert.ok(!response.text.includes(newPassword));
    }

    assert.equal(await loginStatus(subject.email, subject.password), 200, 'nothing changed');
  });

  it('refuses a malformed body with 400', async () => {
    const cookie = await signIn(subject.email, subject.password);

    for (const body of [
      {},
      { currentPassword: subject.password },
      { newPassword: NEW_PASSWORD },
      { currentPassword: subject.password, newPassword: NEW_PASSWORD, extra: true },
      { currentPassword: subject.password, email: 'a@b.com' },
    ]) {
      const response = await patchAccount('password', body, cookie);
      assert.equal(response.status, 400, JSON.stringify(body));
    }
  });

  it('refuses an unauthenticated request', async () => {
    const response = await patchAccount('password', {
      currentPassword: subject.password,
      newPassword: NEW_PASSWORD,
    });

    assert.equal(response.status, 401);
    assert.deepEqual(response.json, NOT_AUTHENTICATED);
  });

  it('sets no cookie, even though the session it used is now gone', async () => {
    const cookie = await signIn(subject.email, subject.password);

    const response = await patchAccount(
      'password',
      { currentPassword: subject.password, newPassword: NEW_PASSWORD },
      cookie,
    );

    assert.equal(response.status, 204);
    assert.deepEqual(
      response.setCookie,
      [],
      'clearing the cookie belongs to the logout route, not here',
    );
  });
});

describe('the account endpoints cannot reach another account', () => {
  it('ignores any account identity a caller puts in the body', async () => {
    // There is no field for one, and an extra key is refused outright — so the
    // attempt cannot even be expressed as a valid request.
    const cookie = await signIn(subject.email, subject.password);
    const row = await accountRow(other.email);
    assert.ok(row);

    for (const body of [
      { currentPassword: subject.password, email: 'a@b.com', adminUserId: row.id },
      { currentPassword: subject.password, email: 'a@b.com', id: row.id },
    ]) {
      const response = await patchAccount('email', body, cookie);
      assert.equal(response.status, 400);
    }

    // And the other account is untouched.
    assert.equal(await loginStatus(other.email, other.password), 200);
  });
});
