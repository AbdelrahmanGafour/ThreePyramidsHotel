import type { Request, Response } from 'express';
import {
  changeAdminRoomType,
  changeAdminRoomTypeCapacity,
  changeAdminRoomTypeStatus,
  createAdminRoomType,
  getAdminRoomType,
  getAdminRoomTypes,
} from './admin-room-types.service';
import {
  ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_RESPONSE,
  ROOM_TYPE_NOT_FOUND_RESPONSE,
  ROOM_TYPE_NO_ACTIVE_ROOMS_RESPONSE,
  ROOM_TYPE_SLUG_TAKEN_RESPONSE,
  isInvalidRoomTypeCapacityError,
  isInvalidRoomTypeCreateError,
  isInvalidRoomTypeSlugError,
  isInvalidRoomTypeStatusError,
  isInvalidRoomTypeUpdateError,
  type AdminRoomTypeCapacityUpdate,
  type AdminRoomTypeCreate,
  type AdminRoomTypeStatusUpdate,
  type AdminRoomTypeUpdate,
} from './admin-room-types.types';
import {
  parseAdminRoomTypeCapacity,
  parseAdminRoomTypeCreate,
  parseAdminRoomTypeStatus,
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

/**
 * Creates one room type.
 *
 * There is no route parameter, so every way this request can be malformed is a
 * way the body is malformed, and one contract covers all of them.
 *
 * The created room type is always inactive. That is not decided here and is
 * not something a caller can ask for: the body has no `isActive` field to
 * carry, and the repository writes the literal `false`.
 */
export async function createAdminRoomTypeHandler(req: Request, res: Response): Promise<void> {
  let create: AdminRoomTypeCreate;

  try {
    create = parseAdminRoomTypeCreate(req.body);
  } catch (error) {
    if (isInvalidRoomTypeCreateError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await createAdminRoomType(create);

  switch (result.outcome) {
    case 'created':
      res.status(201).json({ data: result.roomType });
      return;

    case 'slug-taken':
      // The service classified the constraint; nothing about PostgreSQL
      // reaches this layer, and the slug is not echoed back.
      res.status(409).json(ROOM_TYPE_SLUG_TAKEN_RESPONSE);
      return;
  }
}

/**
 * Changes one room type's capacity.
 *
 * Its own endpoint rather than a field of the general update: capacity is the
 * one value availability filters on and reservation creation enforces, so
 * lowering it can be refused. An operation that can be refused does not belong
 * in a body that never can.
 *
 * Order is deliberate and fixed: the slug says which room type is being
 * changed, so a request naming nothing valid is refused before its body
 * matters. With both malformed, the slug wins, and the answer is the same
 * every time.
 */
export async function updateAdminRoomTypeCapacityHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let update: AdminRoomTypeCapacityUpdate;

  try {
    slug = parseRoomTypeSlugParam(req.params.slug);
    update = parseAdminRoomTypeCapacity(req.body);
  } catch (error) {
    if (isInvalidRoomTypeSlugError(error) || isInvalidRoomTypeCapacityError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  const result = await changeAdminRoomTypeCapacity(slug, update.capacity);

  switch (result.outcome) {
    case 'updated':
      res.status(200).json({ data: result.roomType });
      return;

    case 'not-found':
      res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
      return;

    case 'capacity-conflict':
      // The locked body, and nothing else. How many stays conflict, and whose
      // they are, is not something a refusal hands back.
      res.status(409).json(ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_RESPONSE);
      return;
  }
}

/**
 * Publishes or archives one room type.
 *
 * Its own endpoint rather than a field of the general update, and separate
 * from capacity beside it: publishing a room type and rewriting its wording
 * are different operations with different consequences, and only the first
 * can be refused.
 *
 * Order is deliberate and fixed: the slug says which room type is being
 * changed, so a request naming nothing valid is refused before its body
 * matters. With both malformed, the slug wins, and the answer is the same
 * every time.
 */
export async function updateAdminRoomTypeStatusHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let update: AdminRoomTypeStatusUpdate;

  try {
    slug = parseRoomTypeSlugParam(req.params.slug);
    update = parseAdminRoomTypeStatus(req.body);
  } catch (error) {
    if (isInvalidRoomTypeSlugError(error) || isInvalidRoomTypeStatusError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await changeAdminRoomTypeStatus(slug, update.isActive);

  switch (result.outcome) {
    case 'updated':
      // The same detail contract every other room-type endpoint answers with,
      // including an idempotent request that changed nothing.
      res.status(200).json({ data: result.roomType });
      return;

    case 'not-found':
      res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
      return;

    case 'no-active-rooms':
      // The locked body, and nothing else. How many rooms the type has, and
      // which of them are out of service, is a read rather than something a
      // refusal hands back.
      res.status(409).json(ROOM_TYPE_NO_ACTIVE_ROOMS_RESPONSE);
      return;
  }
}
