import { isValidAdminEmail, isValidAdminPassword, normalizeAdminEmail } from './admin-auth.policy';
import {
  AdminAccountUpdateValidationError,
  AdminLoginValidationError,
  type AdminEmailChangeInput,
  type AdminLoginInput,
  type AdminPasswordChangeInput,
} from './admin-auth.types';

// Request validation for the auth module. Framework-independent: plain values
// in, normalized input out, a local error on anything unusable.
//
// The syntax rules themselves live in `admin-auth.policy.ts`, shared with the
// admin:create seed, so an address that could never have been stored is
// rejected the same way wherever it is submitted.
//
// Login checks only that the request is readable as a login attempt. It must
// never apply the password policy (length, digit) to a submitted password: an
// account created under an older policy still has to be able to sign in, and
// rejecting early would also tell an attacker something about the stored
// password. Changing a password is the opposite case — see below.

const ALLOWED_FIELDS = ['email', 'password'] as const;

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
  const normalizedEmail = normalizeAdminEmail(email);

  if (!isValidAdminEmail(normalizedEmail)) {
    throw new AdminLoginValidationError('email is not a valid address');
  }

  return { email: normalizedEmail, password };
}

// ---------------------------------------------------------------------------
// Account settings
//
// Both bodies are exact: two named keys, both strings, nothing else. An extra
// key is refused rather than ignored — a caller must not be able to believe
// it changed something it did not, and on these two endpoints the something
// would be a credential.
//
// Neither password is ever trimmed. Leading and trailing spaces are part of a
// password, and silently removing them would change which secret was checked.
// ---------------------------------------------------------------------------

/** Rejects anything that is not a plain JSON object, prototypes included. */
function requireAccountBody(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AdminAccountUpdateValidationError('Request body must be a JSON object');
  }

  const prototype = Object.getPrototypeOf(body);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new AdminAccountUpdateValidationError('Request body must be a JSON object');
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);

  // Exactly the named keys, no more and no fewer. Length plus membership,
  // so a body that omits one and adds another cannot pass.
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new AdminAccountUpdateValidationError('Unexpected request body');
  }

  return record;
}

/** The credential proving the person at the keyboard, on either endpoint. */
function requireCurrentPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AdminAccountUpdateValidationError('currentPassword is required');
  }

  return value;
}

const EMAIL_CHANGE_FIELDS = ['currentPassword', 'email'] as const;

/**
 * Validates a request to change one's own email.
 *
 * Shape and syntax only. Whether the address is already taken is a question
 * about another row, which no pure function can answer — that is the unique
 * index's job, under the write.
 */
export function parseAdminEmailChangeInput(body: unknown): AdminEmailChangeInput {
  const record = requireAccountBody(body, EMAIL_CHANGE_FIELDS);
  const currentPassword = requireCurrentPassword(record.currentPassword);

  if (typeof record.email !== 'string') {
    throw new AdminAccountUpdateValidationError('email is required');
  }

  const email = normalizeAdminEmail(record.email);

  if (!isValidAdminEmail(email)) {
    throw new AdminAccountUpdateValidationError('email is not a valid address');
  }

  return { currentPassword, email };
}

const PASSWORD_CHANGE_FIELDS = ['currentPassword', 'newPassword'] as const;

/**
 * Validates a request to change one's own password.
 *
 * The policy IS applied here, unlike on login: this decides what a password
 * may become, and a value that could never have been created must not be
 * settable by an edit either.
 *
 * Whether the new password happens to equal the current one is deliberately
 * not decided here — answering that needs the stored hash, so it belongs to
 * the service.
 */
export function parseAdminPasswordChangeInput(body: unknown): AdminPasswordChangeInput {
  const record = requireAccountBody(body, PASSWORD_CHANGE_FIELDS);
  const currentPassword = requireCurrentPassword(record.currentPassword);

  if (typeof record.newPassword !== 'string') {
    throw new AdminAccountUpdateValidationError('newPassword is required');
  }

  if (!isValidAdminPassword(record.newPassword)) {
    // The rule that failed is not named: this body carries passwords, and an
    // error that explains itself precisely is one that can describe one.
    throw new AdminAccountUpdateValidationError('newPassword does not meet the password policy');
  }

  return { currentPassword, newPassword: record.newPassword };
}
