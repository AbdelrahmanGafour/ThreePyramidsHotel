import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  ADMIN_SESSION_COOKIE_NAME,
  clearSessionCookieOptions,
  generateSessionToken,
  getSessionTtlHours,
  getSessionTtlMs,
  hashSessionToken,
  readSessionCookie,
  sessionCookieOptions,
} from '../src/modules/admin-auth/admin-auth.session';

// Pure: node:crypto and process.env only, so nothing here needs a database.
const ORIGINAL_TTL = process.env.ADMIN_SESSION_TTL_HOURS;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

const restore = (name: 'ADMIN_SESSION_TTL_HOURS' | 'NODE_ENV', value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

// Every test leaves the environment exactly as it found it.
afterEach(() => {
  restore('ADMIN_SESSION_TTL_HOURS', ORIGINAL_TTL);
  restore('NODE_ENV', ORIGINAL_NODE_ENV);
});

const HOUR_MS = 60 * 60 * 1000;
const cookieHeader = (token: string) => `${ADMIN_SESSION_COOKIE_NAME}=${token}`;

describe('admin session tokens', () => {
  it('generates a canonical 32-byte base64url token', () => {
    const token = generateSessionToken();

    // 32 bytes is exactly 43 unpadded base64url characters.
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    // Unpadded.
    assert.ok(!token.includes('='));
  });

  it('holds that length across many generated tokens', () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      assert.equal(generateSessionToken().length, 43);
    }
  });

  it('generates a different token each time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateSessionToken()));

    assert.equal(tokens.size, 50);
  });

  it('hashes a token deterministically as lowercase hex', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);

    assert.equal(hash, hashSessionToken(token));
    assert.match(hash, /^[0-9a-f]{64}$/);
    // The raw token is not recoverable from, or contained in, the hash.
    assert.ok(!hash.includes(token));
  });

  it('hashes different tokens to different values', () => {
    assert.notEqual(hashSessionToken(generateSessionToken()), hashSessionToken(generateSessionToken()));
  });
});

describe('admin session cookie reading', () => {
  it('returns the token from a valid header', () => {
    const token = generateSessionToken();

    assert.equal(readSessionCookie(cookieHeader(token)), token);
  });

  it('ignores unrelated cookies around it', () => {
    const token = generateSessionToken();

    assert.equal(readSessionCookie(`theme=dark; ${cookieHeader(token)}; locale=en-GB`), token);
    assert.equal(readSessionCookie(`${cookieHeader(token)}; other=value`), token);
    assert.equal(readSessionCookie(` theme=dark ; ${ADMIN_SESSION_COOKIE_NAME} = ${token} `), token);
  });

  it('returns null when the cookie is absent', () => {
    assert.equal(readSessionCookie(undefined), null);
    assert.equal(readSessionCookie(''), null);
    assert.equal(readSessionCookie('theme=dark; locale=en-GB'), null);
    // A cookie whose name merely contains ours is not ours.
    assert.equal(readSessionCookie(`not_${ADMIN_SESSION_COOKIE_NAME}=${generateSessionToken()}`), null);
  });

  it('returns null for a malformed token value', () => {
    const token = generateSessionToken();
    const malformed = [
      '',
      'short',
      `${token}extra`,
      token.slice(0, 42),
      // base64 padding and non-base64url characters.
      `${token.slice(0, 42)}=`,
      `${token.slice(0, 42)}+`,
      `${token.slice(0, 42)}/`,
      `${token.slice(0, 42)} `,
      'a'.repeat(43) + 'b',
    ];

    for (const value of malformed) {
      assert.equal(readSessionCookie(cookieHeader(value)), null, `should reject: ${value.slice(0, 20)}`);
    }
  });

  it('returns null for a non-canonical encoding of the right length', () => {
    const decoded = Buffer.from(generateSessionToken(), 'base64url');
    const canonical = decoded.toString('base64url');
    // The final character carries two unused bits; flipping them decodes to the
    // same 32 bytes but is not what the generator would emit.
    const lastChar = canonical.at(-1)!;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const shifted = alphabet[(alphabet.indexOf(lastChar) + 1) % alphabet.length]!;
    const nonCanonical = `${canonical.slice(0, -1)}${shifted}`;

    if (Buffer.from(nonCanonical, 'base64url').equals(decoded)) {
      assert.equal(readSessionCookie(cookieHeader(nonCanonical)), null);
    }
  });

  it('returns null when the session cookie appears more than once', () => {
    const first = generateSessionToken();
    const second = generateSessionToken();

    assert.equal(readSessionCookie(`${cookieHeader(first)}; ${cookieHeader(second)}`), null);
    // Even when both copies are identical, the header is ambiguous.
    assert.equal(readSessionCookie(`${cookieHeader(first)}; ${cookieHeader(first)}`), null);
    assert.equal(readSessionCookie(`${cookieHeader(first)}; theme=dark; ${cookieHeader(second)}`), null);
  });

  it('does not throw on malformed cookie fragments', () => {
    const token = generateSessionToken();

    assert.doesNotThrow(() => readSessionCookie(';;;'));
    assert.doesNotThrow(() => readSessionCookie('=novalue'));
    assert.doesNotThrow(() => readSessionCookie('noequals'));
    assert.equal(readSessionCookie(`noequals; ; =orphan; ${cookieHeader(token)}`), token);
    assert.equal(readSessionCookie('=; ;'), null);
  });
});

describe('admin session TTL', () => {
  it('defaults to 12 hours', () => {
    delete process.env.ADMIN_SESSION_TTL_HOURS;

    assert.equal(getSessionTtlHours(), 12);
    assert.equal(getSessionTtlMs(), 12 * HOUR_MS);
  });

  it('rejects a present-but-blank value rather than defaulting', () => {
    for (const value of ['', '   ', '\t']) {
      process.env.ADMIN_SESSION_TTL_HOURS = value;

      assert.throws(() => getSessionTtlHours(), /positive whole number/i, `should reject: "${value}"`);
      assert.throws(() => getSessionTtlMs(), /positive whole number/i, `should reject: "${value}"`);
    }
  });

  it('accepts a configured positive whole number of hours', () => {
    process.env.ADMIN_SESSION_TTL_HOURS = '1';
    assert.equal(getSessionTtlHours(), 1);
    assert.equal(getSessionTtlMs(), HOUR_MS);

    process.env.ADMIN_SESSION_TTL_HOURS = '24';
    assert.equal(getSessionTtlHours(), 24);
    assert.equal(getSessionTtlMs(), 24 * HOUR_MS);
  });

  it('rejects malformed values instead of falling back', () => {
    for (const value of ['0', '-1', '1.5', '12h', 'twelve', '1e3', 'NaN', 'Infinity', '9007199254740993']) {
      process.env.ADMIN_SESSION_TTL_HOURS = value;

      assert.throws(() => getSessionTtlHours(), /positive whole number/i, `should reject: ${value}`);
      assert.throws(() => getSessionTtlMs(), /positive whole number/i, `should reject: ${value}`);
    }
  });

  it('rejects an hour count whose millisecond form would be unsafe', () => {
    // A safe integer as hours, but 2_501_999_793 * 3_600_000 exceeds
    // Number.MAX_SAFE_INTEGER, so the millisecond value would no longer be exact.
    process.env.ADMIN_SESSION_TTL_HOURS = '2501999793';

    assert.equal(getSessionTtlHours(), 2501999793);
    assert.ok(!Number.isSafeInteger(2501999793 * 60 * 60 * 1000));
    assert.throws(() => getSessionTtlMs(), /ADMIN_SESSION_TTL_HOURS/);
    assert.throws(() => sessionCookieOptions(), /ADMIN_SESSION_TTL_HOURS/);
  });

  it('accepts the largest hour count that stays safe in milliseconds', () => {
    process.env.ADMIN_SESSION_TTL_HOURS = '2501999792';

    assert.equal(getSessionTtlMs(), 2501999792 * HOUR_MS);
    assert.ok(Number.isSafeInteger(getSessionTtlMs()));
  });
});

describe('admin session cookie options', () => {
  it('marks the cookie secure in production', () => {
    process.env.NODE_ENV = 'production';

    assert.equal(sessionCookieOptions().secure, true);
    assert.equal(clearSessionCookieOptions().secure, true);
  });

  it('does not mark the cookie secure outside production', () => {
    process.env.NODE_ENV = 'development';
    assert.equal(sessionCookieOptions().secure, false);
    assert.equal(clearSessionCookieOptions().secure, false);

    delete process.env.NODE_ENV;
    assert.equal(sessionCookieOptions().secure, false);
  });

  it('always sets httpOnly, lax and root path', () => {
    for (const options of [sessionCookieOptions(), clearSessionCookieOptions()]) {
      assert.equal(options.httpOnly, true);
      assert.equal(options.sameSite, 'lax');
      assert.equal(options.path, '/');
    }
  });

  it('sets maxAge to exactly the configured TTL', () => {
    delete process.env.ADMIN_SESSION_TTL_HOURS;
    assert.equal(sessionCookieOptions().maxAge, 12 * HOUR_MS);

    process.env.ADMIN_SESSION_TTL_HOURS = '3';
    assert.equal(sessionCookieOptions().maxAge, 3 * HOUR_MS);
  });

  it('gives the clearing options no lifetime of their own', () => {
    const options = clearSessionCookieOptions();

    assert.equal(options.maxAge, undefined);
    assert.equal(options.expires, undefined);
  });
});
