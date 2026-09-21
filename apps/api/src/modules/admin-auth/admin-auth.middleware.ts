import type { NextFunction, Request, Response } from 'express';
import { findAdministratorBySessionTokenHash } from './admin-auth.repository';
import { hashSessionToken, readSessionCookie } from './admin-auth.session';
import type { AuthenticatedAdministrator } from './admin-auth.types';

// Declaration merging is how Express types are extended; this adds one optional
// field and nothing else. It stays with the feature that sets it.
declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requireAdminSession` once a session is verified. */
    administrator?: AuthenticatedAdministrator;
  }
}

const NOT_AUTHENTICATED = {
  error: {
    code: 'NOT_AUTHENTICATED',
    message: 'Authentication required',
  },
} as const;

/**
 * Guards admin routes. Every reason for refusal - no cookie, a malformed or
 * duplicated one, an unknown, expired or revoked session, or a deactivated
 * account - produces the identical 401, so the response reveals nothing about
 * why. Only the safe administrator identity is attached to the request.
 *
 * Reading a session never changes it: no rotation, no refreshed expiry, no
 * cookie written back.
 */
export async function requireAdminSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readSessionCookie(req.headers.cookie);

  if (!token) {
    res.status(401).json(NOT_AUTHENTICATED);
    return;
  }

  // An unexpected database failure is left to propagate: it is a server
  // problem, not an authentication answer.
  const administrator = await findAdministratorBySessionTokenHash(hashSessionToken(token));

  if (!administrator) {
    res.status(401).json(NOT_AUTHENTICATED);
    return;
  }

  req.administrator = administrator;

  next();
}
