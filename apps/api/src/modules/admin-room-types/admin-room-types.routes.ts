import { Router } from 'express';
import { requireAdminSession } from '../admin-auth/admin-auth.middleware';
import {
  createAdminPhysicalRoomHandler,
  listAdminPhysicalRoomsHandler,
} from '../admin-rooms/admin-rooms.controller';
import {
  createAdminRoomTypeHandler,
  getAdminRoomTypeHandler,
  listAdminRoomTypesHandler,
  updateAdminRoomTypeCapacityHandler,
  updateAdminRoomTypeHandler,
} from './admin-room-types.controller';

export const adminRoomTypesRouter = Router();

// The guard is repeated on each route rather than hoisted to router.use(), so
// every route states its own protection and none can be read as inheriting it
// by accident. It comes first in each chain, so authentication is settled
// before the slug, the body or the room type's existence is ever considered.
//
// Read, create and edit only: deleting a room type is not a V1 operation, and
// archiving one is deferred until the public site can cope with a room-type
// slug it has no presentation content for.
//
// Registration order is most-specific first. Express matches on segment count,
// so `/:slug` cannot swallow `/:slug/capacity` or `/:slug/rooms` — the two-
// segment paths are simply a different shape. The order is therefore for a
// reader rather than for the matcher, and is stated so it stays that way: a
// later `/:slug/*` or an optional-segment pattern would make it load-bearing.
adminRoomTypesRouter.get('/', requireAdminSession, listAdminRoomTypesHandler);
adminRoomTypesRouter.post('/', requireAdminSession, createAdminRoomTypeHandler);

// Physical rooms of one room type. The handlers live in the admin-rooms
// module, because they are about rooms; the routes live here, because this is
// where the parent slug is.
adminRoomTypesRouter.get('/:slug/rooms', requireAdminSession, listAdminPhysicalRoomsHandler);
adminRoomTypesRouter.post('/:slug/rooms', requireAdminSession, createAdminPhysicalRoomHandler);

// Capacity is its own sub-resource rather than a field of the general update:
// it is the one value that can be refused, and an operation that can be
// refused does not belong in a body that never can.
adminRoomTypesRouter.patch('/:slug/capacity', requireAdminSession, updateAdminRoomTypeCapacityHandler);

adminRoomTypesRouter.get('/:slug', requireAdminSession, getAdminRoomTypeHandler);
adminRoomTypesRouter.patch('/:slug', requireAdminSession, updateAdminRoomTypeHandler);
