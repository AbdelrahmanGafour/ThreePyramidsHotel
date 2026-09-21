import { Router } from 'express';
import { adminLoginHandler, adminLogoutHandler, adminSessionHandler } from './admin-auth.controller';
import { requireAdminSession } from './admin-auth.middleware';

export const adminAuthRouter = Router();

adminAuthRouter.post('/login', adminLoginHandler);
// Deliberately unguarded: logout must stay idempotent for a missing, expired or
// otherwise invalid session.
adminAuthRouter.post('/logout', adminLogoutHandler);
adminAuthRouter.get('/session', requireAdminSession, adminSessionHandler);
