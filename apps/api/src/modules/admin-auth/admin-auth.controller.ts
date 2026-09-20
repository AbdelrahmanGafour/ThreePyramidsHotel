import type { Request, Response } from 'express';
import { login, logout } from './admin-auth.service';
import {
  ADMIN_SESSION_COOKIE_NAME,
  clearSessionCookieOptions,
  sessionCookieOptions,
} from './admin-auth.session';
import { isAdminLoginValidationError, isInvalidCredentialsError } from './admin-auth.types';

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
