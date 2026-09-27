import type { NextFunction, Request, Response } from 'express';
import { findAdminSessionByTokenHash } from './admin-auth.repository';
import { hashSessionToken, readSessionCookie } from './admin-auth.session';
import type { AuthenticatedAdministrator } from './admin-auth.types';

// Declaration merging is how Express types are extended; this adds two
// optional fields and nothing else. They stay with the feature that sets them.
//
// Two fields rather than one richer object, deliberately. `administrator` is
// a public shape: `adminSessionHandler` serialises it verbatim, so anything
// added to it is published. The account id is internal and sits on its own
// field, where a handler must ask for it by name and no serialiser can reach
// it by accident.
declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requireAdminSession` once a session is verified. */
    administrator?: AuthenticatedAdministrator;
    /**
     * `admin_users.id` for the same session. Internal only: it exists so an
     * account endpoint can act on the caller's own row without a target
     * parameter, and it must never reach a response body.
     */
    adminUserId?: string;
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
 * why. The safe administrator identity is attached to the request, and the
 * internal account id beside it on its own field.
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
  const session = await findAdminSessionByTokenHash(hashSessionToken(token));

  if (!session) {
    res.status(401).json(NOT_AUTHENTICATED);
    return;
  }

  req.administrator = session.administrator;
  req.adminUserId = session.adminUserId;

  next();
}
