import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

// Covers the two account-settings services: their decisions, the shape of the
// transaction each runs, and the one thing the two-phase doctrine exists to
// guarantee — that no scrypt derivation happens while a client is checked out.
//
// `dbPool.connect` and `dbPool.query` are swapped for stand-ins that record
// statements and return programmed rows, so the real service runs and the
// sequence it issues can be inspected. Real scrypt runs: the hashes below are
// derived once in `before`, which is what makes the "no derivation inside the
// transaction" assertion meaningful rather than decorative.
//
// What this cannot test is the lock itself. `FOR UPDATE` only means something
// against real PostgreSQL, so the serialization it buys is proven in
// admin-auth.account.integration.test.ts and nowhere here.

type ServiceModule = typeof import('../src/modules/admin-auth/admin-auth.service.js');
type PasswordModule = typeof import('../src/modules/admin-auth/admin-auth.password.js');
type Pool = typeof import('../src/db/pool.js');

let changeAdminEmail: ServiceModule['changeAdminEmail'];
let changeAdminPassword: ServiceModule['changeAdminPassword'];
let dbPool: Pool['dbPool'];
let hashPassword: PasswordModule['hashPassword'];
let verifyPassword: PasswordModule['verifyPassword'];

type RecordedCall = { text: string; values: unknown[]; clientHeld: boolean };

let calls: RecordedCall[] = [];
let released = 0;
let totalReleased = 0;
/** True between `connect()` and `release()`, so each statement records it. */
let clientHeld = false;

/** Rows the unlocked pool-level SELECT returns. */
let accountRows: unknown[] = [];
/** Rows the in-transaction `SELECT ... FOR UPDATE` returns. */
let lockedRows: unknown[] = [];
/** Rows every UPDATE returns, with its rowCount. */
let updateRowCount = 1;
/** Statement prefix that should reject, and the error it rejects with. */
let failOn: string | null = null;
let failWith: unknown = null;

const ADMIN_ID = '7';
const CURRENT_PASSWORD = 'current value 1';
const NEW_PASSWORD = 'replacement value 2';
const CURRENT_EMAIL = 'manager@example.com';

let currentHash = '';

const accountRow = (overrides: Record<string, unknown> = {}) => ({
  id: ADMIN_ID,
  email: CURRENT_EMAIL,
  display_name: 'Hotel manager',
  password_hash: currentHash,
  is_active: true,
  ...overrides,
});

/** A pg unique violation, as the driver reports one. */
const uniqueViolation = (constraint: string) =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });

/** The statements issued, reduced for readability. */
const sequence = () =>
  calls.map((call) => {
    const text = call.text.trim();

    if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
      return text;
    }
    if (text.startsWith('DELETE')) {
      return 'DELETE';
    }
    if (text.startsWith('UPDATE')) {
      return 'UPDATE';
    }

    return text.includes('FOR UPDATE') ? 'SELECT FOR UPDATE' : 'SELECT';
  });

const statementMatching = (pattern: RegExp) => calls.find((call) => pattern.test(call.text));

function respond(text: string): Promise<{ rows: unknown[]; rowCount: number }> {
  const trimmed = text.trim();

  if (trimmed.startsWith('SELECT')) {
    const rows = trimmed.includes('FOR UPDATE') ? lockedRows : accountRows;
    return Promise.resolve({ rows, rowCount: rows.length });
  }

  return Promise.resolve({ rows: [], rowCount: updateRowCount });
}

before(async () => {
  // The service's module graph reaches db/pool, which requires DATABASE_URL at
  // import time. Nothing here connects: the pool is replaced before any call,
  // and a placeholder is enough to load the module.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ dbPool } = await import('../src/db/pool.js'));
  ({ hashPassword, verifyPassword } = await import(
    '../src/modules/admin-auth/admin-auth.password.js'
  ));
  ({ changeAdminEmail, changeAdminPassword } = await import(
    '../src/modules/admin-auth/admin-auth.service.js'
  ));

  // Derived once, with the real hasher, so every verification below is real.
  currentHash = await hashPassword(CURRENT_PASSWORD);

  // node:test runs each file in its own process, so this cannot reach another
  // suite.
  const record = (text: string, values: unknown[] = []) => {
    calls.push({ text, values, clientHeld });

    if (failOn && text.trim().startsWith(failOn)) {
      return Promise.reject(failWith ?? new Error(`database failure during ${failOn}`));
    }

    return respond(text);
  };

  (dbPool as unknown as { connect: unknown }).connect = () => {
    clientHeld = true;

    return Promise.resolve({
      query: record,
      release: () => {
        clientHeld = false;
        released += 1;
        totalReleased += 1;
      },
    });
  };

  (dbPool as unknown as { query: unknown }).query = record;
});

after(() => {
  assert.ok(totalReleased > 0, 'the suite should have exercised the client lifecycle');
});

beforeEach(() => {
  calls = [];
  released = 0;
  clientHeld = false;
  accountRows = [accountRow()];
  lockedRows = [accountRow()];
  updateRowCount = 1;
  failOn = null;
  failWith = null;
});

// ---------------------------------------------------------------------------
// changeAdminEmail
// ---------------------------------------------------------------------------

describe('changeAdminEmail', () => {
  const body = { currentPassword: CURRENT_PASSWORD, email: 'new.manager@example.com' };

  it('verifies, locks, writes and commits, in that order', async () => {
    const administrator = await changeAdminEmail(ADMIN_ID, body);

    assert.deepEqual(sequence(), ['SELECT', 'BEGIN', 'SELECT FOR UPDATE', 'UPDATE', 'COMMIT']);
    assert.deepEqual(administrator, {
      email: 'new.manager@example.com',
      displayName: 'Hotel manager',
    });
  });

  it('reads the account by internal id, never by an address from the body', async () => {
    await changeAdminEmail(ADMIN_ID, body);

    const read = calls[0];
    assert.ok(read);
    assert.match(read.text, /FROM admin_users/);
    assert.match(read.text, /WHERE id = \$1/);
    assert.deepEqual(read.values, [ADMIN_ID]);
  });

  it('writes nothing when the current password is wrong', async () => {
    await assert.rejects(
      () => changeAdminEmail(ADMIN_ID, { ...body, currentPassword: 'not the password 1' }),
      /Invalid email or password/,
    );

    assert.deepEqual(sequence(), ['SELECT'], 'no transaction was ever opened');
    assert.equal(released, 0, 'and no client was checked out');
  });

  it('writes nothing when the account has been deactivated', async () => {
    accountRows = [accountRow({ is_active: false })];

    await assert.rejects(() => changeAdminEmail(ADMIN_ID, body), /Invalid email or password/);
    assert.deepEqual(sequence(), ['SELECT']);
  });

  it('leaves updated_at alone when the address is unchanged', async () => {
    await changeAdminEmail(ADMIN_ID, { currentPassword: CURRENT_PASSWORD, email: CURRENT_EMAIL });

    const update = statementMatching(/UPDATE admin_users/);
    assert.ok(update);
    assert.match(update.text, /updated_at = CASE WHEN email IS DISTINCT FROM \$2/);
    assert.match(update.text, /ELSE updated_at/);
    assert.ok(!/SET[\s\S]*updated_at = now\(\)/.test(update.text), 'no unconditional now()');
  });

  it('never deletes a session', async () => {
    await changeAdminEmail(ADMIN_ID, body);

    assert.equal(statementMatching(/DELETE/), undefined, 'an address change signs nobody out');
  });

  it('maps only the email unique index to the in-use conflict', async () => {
    failOn = 'UPDATE';
    failWith = uniqueViolation('admin_users_email_key');

    await assert.rejects(() => changeAdminEmail(ADMIN_ID, body), /already in use/);
    assert.deepEqual(sequence(), ['SELECT', 'BEGIN', 'SELECT FOR UPDATE', 'UPDATE', 'ROLLBACK']);
  });

  it('does not claim "in use" for a violation on another constraint', async () => {
    failOn = 'UPDATE';
    failWith = uniqueViolation('admin_users_something_else_key');

    await assert.rejects(() => changeAdminEmail(ADMIN_ID, body), /duplicate key/);
  });

  it('does not claim "in use" for a non-unique database failure', async () => {
    failOn = 'UPDATE';
    failWith = Object.assign(new Error('deadlock detected'), { code: '40P01' });

    await assert.rejects(() => changeAdminEmail(ADMIN_ID, body), /deadlock detected/);
  });

  it('takes no SELECT before the write to test uniqueness', async () => {
    await changeAdminEmail(ADMIN_ID, body);

    const reads = calls.filter((call) => call.text.trim().startsWith('SELECT'));
    assert.equal(reads.length, 2, 'the unlocked read and the lock, and nothing else');
  });

  it('rejects an account whose password changed after pre-verification', async () => {
    // Another session changed the password between phase one and the lock.
    lockedRows = [accountRow({ password_hash: 'scrypt$N=16384,r=8,p=1$AAAA$BBBB' })];

    await assert.rejects(() => changeAdminEmail(ADMIN_ID, body), /Invalid email or password/);
    assert.deepEqual(sequence(), ['SELECT', 'BEGIN', 'SELECT FOR UPDATE', 'ROLLBACK']);
  });

  it('rolls back and releases on every failure path', async () => {
    failOn = 'UPDATE';
    failWith = uniqueViolation('admin_users_email_key');

    await assert.rejects(() => changeAdminEmail(ADMIN_ID, body));
    assert.equal(released, 1);
    assert.equal(sequence().at(-1), 'ROLLBACK');
  });
});

// ---------------------------------------------------------------------------
// changeAdminPassword
// ---------------------------------------------------------------------------

describe('changeAdminPassword', () => {
  const body = { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD };

  it('runs the locked sequence: BEGIN, lock, UPDATE, DELETE, COMMIT', async () => {
    await changeAdminPassword(ADMIN_ID, body);

    assert.deepEqual(sequence(), [
      'SELECT',
      'BEGIN',
      'SELECT FOR UPDATE',
      'UPDATE',
      'DELETE',
      'COMMIT',
    ]);
  });

  it('deletes every session for the account, scoped to its id', async () => {
    await changeAdminPassword(ADMIN_ID, body);

    const remove = statementMatching(/DELETE FROM admin_sessions/);
    assert.ok(remove);
    assert.match(remove.text, /WHERE admin_user_id = \$1/);
    assert.deepEqual(remove.values, [ADMIN_ID]);
    // No token, no "except this one": the current session goes with the rest.
    assert.ok(!/token_hash/.test(remove.text));
    assert.ok(!/<>|!=|NOT/.test(remove.text));
  });

  it('deletes the sessions before COMMIT, in the same transaction as the hash', async () => {
    await changeAdminPassword(ADMIN_ID, body);

    const order = sequence();
    assert.ok(order.indexOf('UPDATE') < order.indexOf('DELETE'));
    assert.ok(order.indexOf('DELETE') < order.indexOf('COMMIT'));
  });

  it('stores a hash that verifies the new password and not the old one', async () => {
    await changeAdminPassword(ADMIN_ID, body);

    const update = statementMatching(/UPDATE admin_users/);
    assert.ok(update);
    const stored = update.values[1] as string;

    assert.equal(await verifyPassword(NEW_PASSWORD, stored), true);
    assert.equal(await verifyPassword(CURRENT_PASSWORD, stored), false);
    assert.notEqual(stored, currentHash);
  });

  it('derives no hash while a client is held', async () => {
    // The whole reason for two phases. Every statement records whether a
    // client was checked out; scrypt ran before the first one that was.
    await changeAdminPassword(ADMIN_ID, body);

    const unlocked = calls.filter((call) => !call.clientHeld);
    assert.equal(unlocked.length, 1, 'only the pool-level read runs unlocked');
    assert.match(unlocked[0]!.text, /FROM admin_users/);

    // The hash reached the UPDATE, so it was finished before BEGIN.
    const update = statementMatching(/UPDATE admin_users/);
    assert.ok(update);
    assert.match(String(update.values[1]), /^scrypt\$N=16384,r=8,p=1\$/);
  });

  it('writes nothing when the current password is wrong', async () => {
    await assert.rejects(
      () => changeAdminPassword(ADMIN_ID, { ...body, currentPassword: 'not the password 1' }),
      /Invalid email or password/,
    );

    assert.deepEqual(sequence(), ['SELECT']);
    assert.equal(released, 0);
  });

  it('refuses a new password equal to the current one, before any transaction', async () => {
    await assert.rejects(
      () => changeAdminPassword(ADMIN_ID, {
        currentPassword: CURRENT_PASSWORD,
        newPassword: CURRENT_PASSWORD,
      }),
      /must be different from the current password/,
    );

    assert.deepEqual(sequence(), ['SELECT'], 'no session was destroyed for a no-op');
    assert.equal(released, 0);
  });

  it('rejects an account whose password changed after pre-verification', async () => {
    lockedRows = [accountRow({ password_hash: 'scrypt$N=16384,r=8,p=1$AAAA$BBBB' })];

    await assert.rejects(() => changeAdminPassword(ADMIN_ID, body), /Invalid email or password/);

    assert.deepEqual(sequence(), ['SELECT', 'BEGIN', 'SELECT FOR UPDATE', 'ROLLBACK']);
    assert.equal(statementMatching(/DELETE/), undefined, 'and no session was destroyed');
  });

  it('rejects an account deactivated after pre-verification', async () => {
    lockedRows = [accountRow({ is_active: false })];

    await assert.rejects(() => changeAdminPassword(ADMIN_ID, body), /Invalid email or password/);
    // Anchored: the locking SELECT carries the words "FOR UPDATE", so an
    // unanchored match would find it and pass for the wrong reason.
    assert.equal(statementMatching(/^\s*UPDATE/), undefined);
  });

  it('rolls back and releases when the delete fails', async () => {
    failOn = 'DELETE';

    await assert.rejects(() => changeAdminPassword(ADMIN_ID, body));

    assert.deepEqual(sequence(), [
      'SELECT',
      'BEGIN',
      'SELECT FOR UPDATE',
      'UPDATE',
      'DELETE',
      'ROLLBACK',
    ]);
    assert.equal(released, 1);
  });

  it('releases the client on every path', async () => {
    await changeAdminPassword(ADMIN_ID, body);
    assert.equal(released, 1);

    failOn = 'COMMIT';
    await assert.rejects(() => changeAdminPassword(ADMIN_ID, body));
    assert.equal(released, 2);
  });
});

// ---------------------------------------------------------------------------
// What neither service may do
// ---------------------------------------------------------------------------

describe('account services: confidentiality', () => {
  it('never puts a password in a statement, only a derived hash', async () => {
    await changeAdminPassword(ADMIN_ID, {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    for (const call of calls) {
      const serialised = `${call.text} ${JSON.stringify(call.values)}`;
      assert.ok(!serialised.includes(CURRENT_PASSWORD), 'no current password reaches SQL');
      assert.ok(!serialised.includes(NEW_PASSWORD), 'no new password reaches SQL');
    }
  });

  it('never names another account: every statement is addressed by the session id', async () => {
    await changeAdminEmail(ADMIN_ID, {
      currentPassword: CURRENT_PASSWORD,
      email: 'new.manager@example.com',
    });

    for (const call of calls) {
      if (call.values.length === 0) continue;
      assert.equal(call.values[0], ADMIN_ID, `${call.text.trim().slice(0, 24)} addressed by id`);
    }
  });
});
