import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';

// Session token and cookie mechanics for staff sessions.
//
// The browser only ever holds an opaque random token; PostgreSQL stores only
// its SHA-256, so a database leak yields nothing a client could present. This
// file performs no database access and no logging: a raw token must never
// reach a log line.

export const ADMIN_SESSION_COOKIE_NAME = 'tph_admin_session';

/** 32 random bytes encode to exactly 43 unpadded base64url characters. */
const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_LENGTH = Math.ceil((SESSION_TOKEN_BYTES * 4) / 3);
const SESSION_TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${SESSION_TOKEN_LENGTH}}$`);

const DEFAULT_TTL_HOURS = 12;
const TTL_ENV_NAME = 'ADMIN_SESSION_TTL_HOURS';
const WHOLE_NUMBER_PATTERN = /^\d+$/;
const MS_PER_HOUR = 60 * 60 * 1000;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/** Lowercase hex SHA-256 of the raw token; this is the only form stored. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * True only for the exact shape `generateSessionToken` emits: base64url, no
 * padding, 32 bytes. Re-encoding rejects non-canonical values whose unused
 * trailing bits differ but decode to the same bytes.
 */
function isCanonicalToken(value: string): boolean {
  if (!SESSION_TOKEN_PATTERN.test(value)) {
    return false;
  }

  const decoded = Buffer.from(value, 'base64url');

  return decoded.length === SESSION_TOKEN_BYTES && decoded.toString('base64url') === value;
}

/**
 * Reads the admin session token from a raw `Cookie` header. Deliberately not a
 * general cookie parser: it looks for one name and accepts only a canonical
 * token. A header carrying that cookie twice is ambiguous, so it is refused
 * rather than resolved by guessing which one the client meant.
 */
export function readSessionCookie(header: string | undefined): string | null {
  if (typeof header !== 'string' || header.length === 0) {
    return null;
  }

  let found: string | null = null;

  for (const fragment of header.split(';')) {
    const separator = fragment.indexOf('=');

    // A fragment without a name/value pair is simply not our cookie.
    if (separator < 1) {
      continue;
    }
    if (fragment.slice(0, separator).trim() !== ADMIN_SESSION_COOKIE_NAME) {
      continue;
    }
    if (found !== null) {
      return null;
    }

    found = fragment.slice(separator + 1).trim();
  }

  if (found === null || !isCanonicalToken(found)) {
    return null;
  }

  return found;
}

/**
 * Session lifetime in hours: the default only when `ADMIN_SESSION_TTL_HOURS` is
 * absent. If the variable exists it must be valid, blank included, so a typo or
 * an emptied value cannot quietly shorten or extend how long a session lives.
 */
export function getSessionTtlHours(): number {
  const configured = process.env[TTL_ENV_NAME];

  if (configured === undefined) {
    return DEFAULT_TTL_HOURS;
  }

  const raw = configured.trim();

  if (!WHOLE_NUMBER_PATTERN.test(raw)) {
    throw new Error(`${TTL_ENV_NAME} must be a positive whole number of hours`);
  }

  const hours = Number(raw);

  if (!Number.isSafeInteger(hours) || hours < 1) {
    throw new Error(`${TTL_ENV_NAME} must be a positive whole number of hours`);
  }

  return hours;
}

export function getSessionTtlMs(): number {
  const milliseconds = getSessionTtlHours() * MS_PER_HOUR;

  // An hour count can be a safe integer while its millisecond form is not;
  // arithmetic past that point stops being exact, so refuse rather than drift.
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(`${TTL_ENV_NAME} is too large to use as a session lifetime`);
  }

  return milliseconds;
}

const isProduction = () => process.env.NODE_ENV === 'production';

/** Attributes for setting the session cookie. */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // Plain HTTP is normal in local development; production must not send it in the clear.
    secure: isProduction(),
    path: '/',
    maxAge: getSessionTtlMs(),
  };
}

/** Same attributes minus any lifetime, so the browser clears the cookie it already holds. */
export function clearSessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/',
  };
}
