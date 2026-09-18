import type { Request, Response } from 'express';
import { findActiveRoomTypeBySlug, findActiveRoomTypes } from './rooms.repository';

// Database errors are intentionally not caught here: an unexpected failure must
// surface as a server error through Express, never as a 404.
export async function listRoomTypes(_req: Request, res: Response): Promise<void> {
  const roomTypes = await findActiveRoomTypes();

  res.status(200).json({ data: roomTypes });
}

export async function getRoomTypeBySlug(req: Request<{ slug: string }>, res: Response): Promise<void> {
  const roomType = await findActiveRoomTypeBySlug(req.params.slug);

  // Unknown and inactive slugs are indistinguishable to the public API.
  if (!roomType) {
    res.status(404).json({
      error: {
        code: 'ROOM_NOT_FOUND',
        message: 'Room type not found',
      },
    });
    return;
  }

  res.status(200).json({ data: roomType });
}
