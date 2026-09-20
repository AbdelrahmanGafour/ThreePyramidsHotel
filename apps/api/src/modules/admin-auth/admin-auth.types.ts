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
