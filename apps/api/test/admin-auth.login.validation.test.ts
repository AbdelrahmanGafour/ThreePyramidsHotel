import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { verifyPassword } from '../src/modules/admin-auth/admin-auth.password';
import { parseAdminLoginInput } from '../src/modules/admin-auth/admin-auth.validation';
import {
  INVALID_LOGIN_ERROR_CODE,
  isAdminLoginValidationError,
} from '../src/modules/admin-auth/admin-auth.types';

// Pure: the validation module imports no database code.
const validBody = { email: 'manager@example.com', password: 'a-stored-password' };

function assertRejected(body: unknown): void {
  assert.throws(
    () => parseAdminLoginInput(body),
    (error: unknown) => {
      assert.ok(isAdminLoginValidationError(error), `expected a login validation error, got: ${String(error)}`);
      assert.equal(error.code, INVALID_LOGIN_ERROR_CODE);
      return true;
    },
  );
}

describe('parseAdminLoginInput', () => {
  describe('accepts', () => {
    it('a valid body', () => {
      assert.deepEqual(parseAdminLoginInput(validBody), {
        email: 'manager@example.com',
        password: 'a-stored-password',
      });
    });

    it('an email with surrounding space or mixed case, normalizing it', () => {
      const input = parseAdminLoginInput({ ...validBody, email: '  Manager@Example.COM  ' });

      assert.equal(input.email, 'manager@example.com');
    });

    it('any non-empty password, without applying the admin:create policy', () => {
      // Short, digit-free, and space-padded passwords must still reach verification:
      // an account created under an older policy has to be able to sign in.
      for (const password of ['a', 'password', '   ', ' leading and trailing ', 'x'.repeat(500)]) {
        assert.equal(parseAdminLoginInput({ ...validBody, password }).password, password);
      }
    });

    it('a null-prototype object', () => {
      const body = Object.assign(Object.create(null), validBody);

      assert.equal(parseAdminLoginInput(body).email, validBody.email);
    });

    it('without mutating the caller’s body', () => {
      const body = { ...validBody, email: '  Manager@Example.COM  ' };
      const snapshot = JSON.stringify(body);

      parseAdminLoginInput(body);

      assert.equal(JSON.stringify(body), snapshot);
    });
  });

  describe('rejects', () => {
    it('a body that is not a plain object', () => {
      for (const body of [null, undefined, 'email=x', 42, [validBody], new Date(), new Map()]) {
        assertRejected(body);
      }
    });

    it('a missing or non-string email', () => {
      assertRejected({ password: validBody.password });
      assertRejected({ ...validBody, email: 42 });
      assertRejected({ ...validBody, email: null });
      assertRejected({ ...validBody, email: ['manager@example.com'] });
    });

    it('a missing, non-string or empty password', () => {
      assertRejected({ email: validBody.email });
      assertRejected({ ...validBody, password: '' });
      assertRejected({ ...validBody, password: 12345678 });
      assertRejected({ ...validBody, password: null });
    });

    it('a malformed email address', () => {
      for (const email of [
        '',
        '   ',
        'admin@',
        '@example.com',
        'admin@example',
        'admin @example.com',
        'admin@example..com',
        'admin@-example.com',
        'admin@example-.com',
        'admin@.example.com',
        'admin@example.com.',
        'two@at@example.com',
        `${'a'.repeat(65)}@example.com`,
        `${'a'.repeat(250)}@example.com`,
      ]) {
        assertRejected({ ...validBody, email });
      }
    });

    it('server-controlled or unexpected fields (login)', () => {
      for (const field of [
        'id',
        'isActive',
        'is_active',
        'passwordHash',
        'password_hash',
        'token',
        'tokenHash',
        'sessionId',
        'expiresAt',
        'displayName',
        'role',
        'anythingElse',
      ]) {
        assertRejected({ ...validBody, [field]: 'x' });
      }
    });
  });
});

// The service module reaches db/pool, which requires DATABASE_URL at import
// time. Nothing here connects: only the fixed constant is inspected.
type ServiceModule = typeof import('../src/modules/admin-auth/admin-auth.service.js');

let DUMMY_PASSWORD_HASH: ServiceModule['DUMMY_PASSWORD_HASH'];

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ DUMMY_PASSWORD_HASH } = await import('../src/modules/admin-auth/admin-auth.service.js'));
});

describe('unknown-user verification path', () => {
  it('uses a fixed canonical scrypt hash with the current cost parameters', () => {
    const [algorithm, params, salt, hash] = DUMMY_PASSWORD_HASH.split('$');

    assert.equal(algorithm, 'scrypt');
    assert.equal(params, 'N=16384,r=8,p=1');
    assert.equal(Buffer.from(salt!, 'base64').length, 16);
    assert.equal(Buffer.from(hash!, 'base64').length, 64);
    // Canonical base64, so verifyPassword accepts the shape.
    assert.equal(Buffer.from(salt!, 'base64').toString('base64'), salt);
    assert.equal(Buffer.from(hash!, 'base64').toString('base64'), hash);
  });

  it('is a constant, not regenerated per call', async () => {
    const again = await import('../src/modules/admin-auth/admin-auth.service.js');

    assert.equal(again.DUMMY_PASSWORD_HASH, DUMMY_PASSWORD_HASH);
  });

  it('performs a real verification that no password satisfies', async () => {
    for (const password of ['', 'password', 'hotel2026', DUMMY_PASSWORD_HASH, 'x'.repeat(64)]) {
      assert.equal(await verifyPassword(password, DUMMY_PASSWORD_HASH), false);
    }
  });
});
