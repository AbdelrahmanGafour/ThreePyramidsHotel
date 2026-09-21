import { Router } from 'express';
import { requireAdminSession } from '../admin-auth/admin-auth.middleware';
import {
  getAdminRoomTypeHandler,
  listAdminRoomTypesHandler,
  updateAdminRoomTypeHandler,
} from './admin-room-types.controller';

export const adminRoomTypesRouter = Router();

// The guard is repeated on each route rather than hoisted to router.use(), so
// every route states its own protection and none can be read as inheriting it
// by accident. It comes first in each chain, so authentication is settled
// before the slug, the body or the room type's existence is ever considered.
//
// Read and edit only: creating a room type, deleting one, and archiving one
// are each their own decision and none of them is in V1.
adminRoomTypesRouter.get('/', requireAdminSession, listAdminRoomTypesHandler);
adminRoomTypesRouter.get('/:slug', requireAdminSession, getAdminRoomTypeHandler);
adminRoomTypesRouter.patch('/:slug', requireAdminSession, updateAdminRoomTypeHandler);
