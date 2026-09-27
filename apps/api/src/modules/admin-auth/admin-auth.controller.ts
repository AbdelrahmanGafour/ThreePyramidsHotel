import type { Request, Response } from 'express';
import { changeAdminEmail, changeAdminPassword, login, logout } from './admin-auth.service';
import {
  ADMIN_SESSION_COOKIE_NAME,
  clearSessionCookieOptions,
  sessionCookieOptions,
} from './admin-auth.session';
import {
  isAdminAccountUpdateValidationError,
  isAdminEmailInUseError,
  isAdminLoginValidationError,
  isAdminPasswordUnchangedError,
  isInvalidCredentialsError,
} from './admin-auth.types';

/**
 * Ends the presented session. Always 204, whether or not there was a session to
 * end, so signing out never depends on the state of a cookie the browser is
 * about to lose anyway.
 *
 * Server-side invalidation happens first: if it fails, the error propagates and
 * the cookie is deliberately left in place rather than telling the browser it
 * is signed out while the session is still live.
 */
export async function adminLogoutHandler(req: Request, res: Response): Promise<void> {
  await logout(req.headers.cookie);

  res.clearCookie(ADMIN_SESSION_COOKIE_NAME, clearSessionCookieOptions());
  res.status(204).end();
}

/**
 * Reports who the current session belongs to. The administrator was resolved by
 * `requireAdminSession`, so no credential or session lookup happens here.
 */
export function adminSessionHandler(req: Request, res: Response): void {
  const administrator = req.administrator;

  if (!administrator) {
    // Unreachable behind requireAdminSession; a server error, never a 401.
    throw new Error('adminSessionHandler requires requireAdminSession');
  }

  res.status(200).json({ data: { administrator } });
}

export async function adminLoginHandler(req: Request, res: Response): Promise<void> {
  try {
    const { administrator, rawToken, sessionTtlMs } = await login(req.body);

    // The raw token leaves the server only here, in an HttpOnly cookie; the
    // maxAge is the same lifetime stored on the session row.
    res.cookie(ADMIN_SESSION_COOKIE_NAME, rawToken, { ...sessionCookieOptions(), maxAge: sessionTtlMs });

    res.status(200).json({ data: { administrator } });
  } catch (error) {
    // A deliberately vague message: which field was wrong is not the caller's business.
    if (isAdminLoginValidationError(error)) {
      res.status(400).json({ error: { code: error.code, message: 'Invalid login request' } });
      return;
    }

    // Unknown email, wrong password and inactive account share this response.
    if (isInvalidCredentialsError(error)) {
      res.status(401).json({ error: { code: error.code, message: error.message } });
      return;
    }

    // Express 5 turns this rejected async handler into a server error.
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Account settings
//
// Both handlers sit behind `requireAdminSession`, so the caller is known
// before either reads a body. Whose account is changed comes from
// `req.adminUserId` — the id the session resolved to — and never from the
// request: neither body has a field naming an account, so there is no shape
// in which one administrator can address another's row.
//
// Neither response carries the id, the password hash, or any value the
// caller submitted. The success body is the same public administrator shape
// `/session` answers with, and nothing else.
// ---------------------------------------------------------------------------

/**
 * The id the session resolved to.
 *
 * Unreachable behind `requireAdminSession`; a missing value is a wiring fault
 * and must surface as a server error rather than as a 401, which would claim
 * the caller was not signed in when they demonstrably were.
 */
function requireAdminUserId(req: Request): string {
  const adminUserId = req.adminUserId;

  if (!adminUserId) {
    throw new Error('Account handlers require requireAdminSession');
  }

  return adminUserId;
}

/**
 * Turns an account-change failure into its locked response, or re-throws.
 *
 * One place for both handlers, because the vocabulary is shared: a malformed
 * body and a policy violation are both 400 with a fixed message that quotes
 * nothing, a wrong current password is the same 401 login answers with, and
 * each conflict has its own 409.
 *
 * Express 5 turns anything re-thrown here into a 500, which is what an
 * unexpected database failure is.
 */
function respondToAccountFailure(res: Response, error: unknown): void {
  if (isAdminAccountUpdateValidationError(error)) {
    // Deliberately not `error.message`: these requests carry passwords, and a
    // body that explains precisely which rule failed is a body that can end
    // up describing one.
    res.status(400).json({ error: { code: error.code, message: 'Invalid account update request' } });
    return;
  }

  if (isInvalidCredentialsError(error)) {
    // A wrong current password and an account changed underneath the request
    // share this answer; which it was is not the caller's business.
    res.status(401).json({ error: { code: error.code, message: error.message } });
    return;
  }

  if (isAdminEmailInUseError(error) || isAdminPasswordUnchangedError(error)) {
    res.status(409).json({ error: { code: error.code, message: error.message } });
    return;
  }

  throw error;
}

/**
 * Changes the signed-in administrator's own email.
 *
 * Answers with the administrator as it now stands, in the same shape
 * `/session` uses, so a client can refresh what it displays without a second
 * request. Sessions are untouched: the cookie the caller sent is still valid.
 */
export async function adminChangeEmailHandler(req: Request, res: Response): Promise<void> {
  const adminUserId = requireAdminUserId(req);

  try {
    const administrator = await changeAdminEmail(adminUserId, req.body);

    res.status(200).json({ data: { administrator } });
  } catch (error) {
    respondToAccountFailure(res, error);
  }
}

/**
 * Changes the signed-in administrator's own password.
 *
 * 204, with no body: there is nothing to report that the caller does not
 * already know, and the one thing that did change — the password — must not
 * be echoed in any form.
 *
 * Every session for the account is gone by the time this answers, this one
 * included, so the cookie the browser still holds now authenticates nothing.
 * The cookie is deliberately NOT cleared here: this endpoint is not the
 * logout route, and the web layer signs out through the route that owns
 * cookie clearing.
 */
export async function adminChangePasswordHandler(req: Request, res: Response): Promise<void> {
  const adminUserId = requireAdminUserId(req);

  try {
    await changeAdminPassword(adminUserId, req.body);

    res.status(204).end();
  } catch (error) {
    respondToAccountFailure(res, error);
  }
}
