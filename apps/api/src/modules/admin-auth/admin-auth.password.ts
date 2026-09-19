import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// Password hashing for staff accounts, using only Node's built-in crypto.
//
// The stored string is self-describing, so the cost parameters travel with each
// hash and can be raised later without a schema change. V1 verifies only the
// current canonical encoding: a stored value must match the parameters and the
// exact salt and key lengths this encoder produces. A malformed or hostile
// database value is therefore rejected before any key derivation runs, so it
// can never dictate how much CPU, memory or output we allocate.
//
// Supporting an older cost later means accepting an explicit additional set of
// parameters here, never widening this to arbitrary values.
//
// Nothing here logs or returns a password.

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const ALGORITHM = 'scrypt';
const COST = { N: 16384, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** scrypt needs 128 * N * r bytes; the headroom keeps Node's default maxmem from rejecting valid work. */
const MAXMEM = 256 * COST.N * COST.r;

const SCRYPT_OPTIONS: ScryptOptions = { N: COST.N, r: COST.r, p: COST.p, maxmem: MAXMEM };

const ENCODED_PATTERN = new RegExp(
  `^${ALGORITHM}\\$N=(\\d+),r=(\\d+),p=(\\d+)\\$([A-Za-z0-9+/]+={0,2})\\$([A-Za-z0-9+/]+={0,2})$`,
);

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('A password is required');
  }

  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_BYTES, SCRYPT_OPTIONS);

  return `${ALGORITHM}$N=${COST.N},r=${COST.r},p=${COST.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/** Returns false for a wrong password and for any malformed or unsupported stored hash - it never throws. */
export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof encodedHash !== 'string') {
    return false;
  }

  const match = ENCODED_PATTERN.exec(encodedHash);

  if (!match) {
    return false;
  }

  const [, n, r, p, encodedSalt, encodedExpected] = match;

  // Only the parameters this encoder writes are accepted.
  if (Number(n) !== COST.N || Number(r) !== COST.r || Number(p) !== COST.p) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt!, 'base64');
    const expected = Buffer.from(encodedExpected!, 'base64');

    // Exact sizes only, so the stored value cannot choose the work or the
    // output length. Re-encoding proves the base64 was canonical, catching
    // padding tricks that decode to the right size.
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) {
      return false;
    }
    if (salt.toString('base64') !== encodedSalt || expected.toString('base64') !== encodedExpected) {
      return false;
    }

    const derived = await scryptAsync(password, salt, KEY_BYTES, SCRYPT_OPTIONS);

    return timingSafeEqual(derived, expected);
  } catch {
    // A stored value that cannot be decoded or derived is simply not a match.
    return false;
  }
}
