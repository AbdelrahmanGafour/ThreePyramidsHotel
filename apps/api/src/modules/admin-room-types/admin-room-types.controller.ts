import type { Request, Response } from 'express';
import {
  changeAdminRoomType,
  getAdminRoomType,
  getAdminRoomTypes,
} from './admin-room-types.service';
import {
  ROOM_TYPE_NOT_FOUND_RESPONSE,
  isInvalidRoomTypeSlugError,
  isInvalidRoomTypeUpdateError,
  type AdminRoomTypeUpdate,
} from './admin-room-types.types';
import {
  parseAdminRoomTypeUpdate,
  parseRoomTypeSlugParam,
} from './admin-room-types.validation';

// The callers reaching these handlers are already authenticated:
// `requireAdminSession` guards every route, so nothing here re-checks a
// session, and an unauthenticated request never gets far enough to learn
// whether a slug is valid, whether a room type exists, or whether an update
// body would have been accepted.
//
// Nothing is logged: a room type is not secret, but a handler that starts
// logging request contents is one that eventually logs something that is.

/** The whole catalogue: no pagination, no filtering, one fixed order. */
export async function listAdminRoomTypesHandler(_req: Request, res: Response): Promise<void> {
  const roomTypes = await getAdminRoomTypes();

  res.status(200).json({ data: { roomTypes } });
}

export async function getAdminRoomTypeHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;

  try {
    slug = parseRoomTypeSlugParam(req.params.slug);
  } catch (error) {
    if (isInvalidRoomTypeSlugError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const roomType = await getAdminRoomType(slug);

  if (!roomType) {
    res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
    return;
  }

  res.status(200).json({ data: roomType });
}

/**
 * Applies a partial update.
 *
 * Order is deliberate and fixed: the slug says which room type is being
 * changed, so a request naming nothing valid is refused before its body
 * matters. With both malformed, the slug wins, and the answer is the same
 * every time.
 */
export async function updateAdminRoomTypeHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let update: AdminRoomTypeUpdate;

  try {
    slug = parseRoomTypeSlugParam(req.params.slug);
    update = parseAdminRoomTypeUpdate(req.body);
  } catch (error) {
    if (isInvalidRoomTypeSlugError(error) || isInvalidRoomTypeUpdateError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  const roomType = await changeAdminRoomType(slug, update);

  if (!roomType) {
    res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
    return;
  }

  res.status(200).json({ data: roomType });
}
