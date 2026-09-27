/** A staff login request, normalized. The password is never trimmed or altered. */
export type AdminLoginInput = {
  email: string;
  password: string;
};

/** The only administrator fields a client ever sees. */
export type AuthenticatedAdministrator = {
  email: string;
  displayName: string;
};

/**
 * Who the presented session belongs to, as the SERVER needs to know it.
 *
 * Deliberately not a widening of `AuthenticatedAdministrator`. That type is a
 * public contract — `adminSessionHandler` serialises it verbatim as the
 * `/session` body — so putting the row id inside it would publish an internal
 * identifier to every browser that asks who it is. The id travels beside the
 * public shape instead, and the middleware puts the two on different request
 * fields.
 *
 * The id exists so an account endpoint can act on the session's own row
 * without a target parameter: there is no `?id=` and no email in any account
 * body, so a caller cannot ask to change somebody else's account.
 */
export type AuthenticatedAdminSession = {
  /** `admin_users.id`. Internal: it must never reach a response body. */
  adminUserId: string;
  administrator: AuthenticatedAdministrator;
};

/** Internal: the account row login needs, including the stored hash. */
export type AdminAccount = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  isActive: boolean;
};

export type AdminLoginResult = {
  administrator: AuthenticatedAdministrator;
  /** Raw session token for the cookie only - never stored, logged or returned in JSON. */
  rawToken: string;
  /** The lifetime used for both the stored expiry and the cookie, so they cannot diverge. */
  sessionTtlMs: number;
};

export const INVALID_LOGIN_ERROR_CODE = 'INVALID_LOGIN';

/**
 * The request could not be read as a login attempt. Local to this module - not
 * the start of an application-wide error framework.
 */
export class AdminLoginValidationError extends Error {
  readonly code = INVALID_LOGIN_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'AdminLoginValidationError';
  }
}

export function isAdminLoginValidationError(error: unknown): error is AdminLoginValidationError {
  return error instanceof AdminLoginValidationError;
}

export const INVALID_CREDENTIALS_ERROR_CODE = 'INVALID_CREDENTIALS';

/**
 * Raised for an unknown email, a wrong password and an inactive account alike.
 * Carrying no detail is the point: the caller must not learn which it was.
 */
export class InvalidCredentialsError extends Error {
  readonly code = INVALID_CREDENTIALS_ERROR_CODE;

  constructor() {
    super('Invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

export function isInvalidCredentialsError(error: unknown): error is InvalidCredentialsError {
  return error instanceof InvalidCredentialsError;
}

// ---------------------------------------------------------------------------
// Account settings — an administrator changing their own email or password
// ---------------------------------------------------------------------------

/**
 * A request to change one's own email.
 *
 * `email` arrives normalised; `currentPassword` is never trimmed or altered,
 * exactly as on login. There is no target account field, by design: the
 * session decides whose account this is.
 */
export type AdminEmailChangeInput = {
  currentPassword: string;
  email: string;
};

/** A request to change one's own password. Neither value is ever trimmed. */
export type AdminPasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
};

export const INVALID_ADMIN_ACCOUNT_UPDATE_ERROR_CODE = 'INVALID_ADMIN_ACCOUNT_UPDATE';

/**
 * The request could not be read as an account change, or a new value breaks
 * the policy.
 *
 * One error for both, because the controller answers both with the same 400
 * and the same fixed message. Which rule failed is not echoed back: the
 * request carries a password, and an error that explains itself in detail is
 * an error that can end up describing one.
 */
export class AdminAccountUpdateValidationError extends Error {
  readonly code = INVALID_ADMIN_ACCOUNT_UPDATE_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'AdminAccountUpdateValidationError';
  }
}

export function isAdminAccountUpdateValidationError(
  error: unknown,
): error is AdminAccountUpdateValidationError {
  return error instanceof AdminAccountUpdateValidationError;
}

export const ADMIN_EMAIL_IN_USE_ERROR_CODE = 'ADMIN_EMAIL_IN_USE';
export const ADMIN_EMAIL_IN_USE_ERROR_MESSAGE = 'That email address is already in use';

/**
 * Another account already holds the requested address.
 *
 * Raised only from a `23505` on `admin_users_email_key`, never from a read
 * taken before the write: a SELECT-then-UPDATE would widen the window in
 * which the answer changes, and the unique index is the only thing that
 * actually decides.
 */
export class AdminEmailInUseError extends Error {
  readonly code = ADMIN_EMAIL_IN_USE_ERROR_CODE;

  constructor() {
    super(ADMIN_EMAIL_IN_USE_ERROR_MESSAGE);
    this.name = 'AdminEmailInUseError';
  }
}

export function isAdminEmailInUseError(error: unknown): error is AdminEmailInUseError {
  return error instanceof AdminEmailInUseError;
}

export const ADMIN_PASSWORD_UNCHANGED_ERROR_CODE = 'ADMIN_PASSWORD_UNCHANGED';
export const ADMIN_PASSWORD_UNCHANGED_ERROR_MESSAGE =
  'The new password must be different from the current password';

/**
 * The new password is the one already in use.
 *
 * A conflict rather than a validation failure: the value is perfectly valid,
 * it just changes nothing — and a "password changed" answer that revoked
 * every session while leaving the credential identical would be a lie with
 * consequences.
 */
export class AdminPasswordUnchangedError extends Error {
  readonly code = ADMIN_PASSWORD_UNCHANGED_ERROR_CODE;

  constructor() {
    super(ADMIN_PASSWORD_UNCHANGED_ERROR_MESSAGE);
    this.name = 'AdminPasswordUnchangedError';
  }
}

export function isAdminPasswordUnchangedError(
  error: unknown,
): error is AdminPasswordUnchangedError {
  return error instanceof AdminPasswordUnchangedError;
}
