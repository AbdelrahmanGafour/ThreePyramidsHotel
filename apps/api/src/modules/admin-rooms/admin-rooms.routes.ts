import { Router } from 'express';
import { requireAdminSession } from '../admin-auth/admin-auth.middleware';
import { updateAdminPhysicalRoomHandler } from './admin-rooms.controller';

export const adminRoomsRouter = Router();

// Physical rooms addressed on their own, by room number.
//
// Mounted at /api/v1/admin/rooms, which is a different namespace from the
// public /api/v1/rooms — that one serves room *types* to guests and is not
// touched by anything here. A room number appears nowhere outside the admin
// area.
//
// Listing and creating rooms live under the room type they belong to, on the
// room-types router, because that is where the parent slug is. Only operations
// on an existing room, which is identified hotel-wide by its number, belong
// here.
//
// The guard is repeated on each route rather than hoisted to router.use(), so
// every route states its own protection and none can be read as inheriting it
// by accident. It comes first in the chain, so authentication is settled
// before the room number, the body or the room's existence is considered.
//
// Read and edit only: creating a room is a room-type operation, deleting one
// is not a V1 operation at all, and moving a room between types is forbidden
// by the composite foreign key from reservations.
adminRoomsRouter.patch('/:roomNumber', requireAdminSession, updateAdminPhysicalRoomHandler);
