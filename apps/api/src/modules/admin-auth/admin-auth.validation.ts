import { AdminLoginValidationError, type AdminLoginInput } from './admin-auth.types';

// Login request validation. Framework-independent: plain values in, normalized
// input out, a local error on anything unusable.
//
// This checks only that the request is readable as a login attempt. It must
// never apply the admin:create password policy (length, digit) to a submitted
// password: an account created under an older policy still has to be able to
// sign in, and rejecting early would also tell an attacker something about the
// stored password.

const ALLOWED_FIELDS = ['email', 'password'] as const;

const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;
const DOMAIN_LABEL_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * The same practical syntax rules the admin:create script applies, so an
 * address that could never have been stored is rejected before any database
 * work. Deliberately not RFC 5322.
 */
function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || /\s/.test(email)) {
    return false;
  }

  const parts = email.split('@');

  if (parts.length !== 2) {
    return false;
  }

  const [localPart = '', domain = ''] = parts;

  if (localPart.length === 0 || localPart.length > MAX_LOCAL_PART_LENGTH) {
    return false;
  }
  if (domain.length === 0 || !domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return false;
  }

  return domain
    .split('.')
    .every((label) => label.length > 0 && !label.startsWith('-') && !label.endsWith('-') && DOMAIN_LABEL_PATTERN.test(label));
}

export function parseAdminLoginInput(body: unknown): AdminLoginInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AdminLoginValidationError('Login request body must be a JSON object');
  }

  const prototype = Object.getPrototypeOf(body);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new AdminLoginValidationError('Login request body must be a JSON object');
  }

  const record = body as Record<string, unknown>;

  // Anything beyond email and password is refused rather than ignored, so a
  // client cannot believe it influenced the session, role or expiry.
  for (const field of Object.keys(record)) {
    if (!ALLOWED_FIELDS.includes(field as (typeof ALLOWED_FIELDS)[number])) {
      throw new AdminLoginValidationError(`Unexpected field: ${field}`);
    }
  }

  const { email, password } = record;

  if (typeof email !== 'string') {
    throw new AdminLoginValidationError('email is required');
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw new AdminLoginValidationError('password is required');
  }

  // Normalized to match how accounts are stored.
  const normalizedEmail = email.trim().toLowerCase();

  if (!isValidEmail(normalizedEmail)) {
    throw new AdminLoginValidationError('email is not a valid address');
  }

  return { email: normalizedEmail, password };
}
