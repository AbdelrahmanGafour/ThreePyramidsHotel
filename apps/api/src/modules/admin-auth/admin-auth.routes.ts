import { Router } from 'express';
import {
  adminChangeEmailHandler,
  adminChangePasswordHandler,
  adminLoginHandler,
  adminLogoutHandler,
  adminSessionHandler,
} from './admin-auth.controller';
import { requireAdminSession } from './admin-auth.middleware';

export const adminAuthRouter = Router();

adminAuthRouter.post('/login', adminLoginHandler);
// Deliberately unguarded: logout must stay idempotent for a missing, expired or
// otherwise invalid session.
adminAuthRouter.post('/logout', adminLogoutHandler);
adminAuthRouter.get('/session', requireAdminSession, adminSessionHandler);

// An administrator changing their own account. Guarded first, like every
// other authenticated route: whose account it is comes from the session, so
// neither path nor body carries a target and an unauthenticated caller is
// refused before any body is judged.
//
// Two endpoints rather than one, because they are two operations: changing
// an address can be refused for a reason changing a password never can, and
// only one of them ends every session the account has.
adminAuthRouter.patch('/account/email', requireAdminSession, adminChangeEmailHandler);
adminAuthRouter.patch('/account/password', requireAdminSession, adminChangePasswordHandler);
