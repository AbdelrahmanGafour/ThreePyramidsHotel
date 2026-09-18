import { Router } from 'express';
import { getRoomTypeBySlug, listRoomTypes } from './rooms.controller';

export const roomsRouter = Router();

roomsRouter.get('/', listRoomTypes);
roomsRouter.get('/:slug', getRoomTypeBySlug);
