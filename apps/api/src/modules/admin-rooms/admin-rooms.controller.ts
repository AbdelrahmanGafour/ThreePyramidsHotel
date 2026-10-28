import type { Request, Response } from 'express';
import {
  ROOM_TYPE_NOT_FOUND_RESPONSE,
  isInvalidRoomTypeSlugError,
} from '../admin-room-types/admin-room-types.types';
import { parseRoomTypeSlugParam } from '../admin-room-types/admin-room-types.validation';
import {
  addAdminPhysicalRoom,
  changeAdminPhysicalRoom,
  listAdminPhysicalRooms,
} from './admin-rooms.service';
import {
  ROOM_HAS_FUTURE_RESERVATIONS_RESPONSE,
  ROOM_NOT_FOUND_RESPONSE,
  ROOM_NUMBER_TAKEN_RESPONSE,
  isInvalidRoomCreateError,
  isInvalidRoomNumberError,
  isInvalidRoomUpdateError,
  type AdminPhysicalRoomCreate,
  type AdminPhysicalRoomUpdate,
} from './admin-rooms.types';
import {
  parseAdminPhysicalRoomCreate,
  parseAdminPhysicalRoomUpdate,
  parseRoomNumberParam,
} from './admin-rooms.validation';

// The callers reaching these handlers are already authenticated:
// `requireAdminSession` guards every route, so nothing here re-checks a
// session, and an unauthenticated request never gets far enough to learn
// whether a slug is valid, whether a room exists, or whether an update body
// would have been accepted.
//
// The room-type slug is validated with the canonical parser from the
// room-types module rather than a second copy: two rules for one identifier is
// one more than an identifier needs.
//
// Error ownership is three-way and fixed:
//
//   route identifier   INVALID_ROOM_TYPE_SLUG / INVALID_ROOM_NUMBER
//   POST create body   INVALID_ROOM_CREATE
//   PATCH update body  INVALID_ROOM_UPDATE
//
// Nothing about MySQL reaches this layer. A constraint violation was
// already classified by the service into an outcome; no SQLSTATE, constraint
// name or stack trace appears in any response, and no rejected room number or
// slug is echoed back.

/**
 * Every physical room of one room type, active and inactive alike.
 *
 * A room type with no rooms yet is a success with an empty list, not a 404 —
 * it is a real and expected state, and the service keeps it distinct from a
 * slug nobody has used.
 */
export async function listAdminPhysicalRoomsHandler(
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
  const result = await listAdminPhysicalRooms(slug);

  switch (result.outcome) {
    case 'listed':
      res.status(200).json({ data: { rooms: result.rooms } });
      return;

    case 'room-type-not-found':
      res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
      return;
  }
}

/**
 * Adds one physical room to a room type.
 *
 * The room type comes from the route, never from the body. Order is the same
 * as everywhere else: a request naming nothing valid is refused before its
 * body matters.
 */
export async function createAdminPhysicalRoomHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let create: AdminPhysicalRoomCreate;

  try {
    slug = parseRoomTypeSlugParam(req.params.slug);
    create = parseAdminPhysicalRoomCreate(req.body);
  } catch (error) {
    // The two carry different contracts on purpose: which half of the request
    // was wrong is what the caller needs, and it gives nothing away.
    if (isInvalidRoomTypeSlugError(error) || isInvalidRoomCreateError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  const result = await addAdminPhysicalRoom(slug, create.roomNumber);

  switch (result.outcome) {
    case 'created':
      res.status(201).json({ data: result.room });
      return;

    case 'room-type-not-found':
      res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
      return;

    case 'room-number-taken':
      // Unique hotel-wide and case-insensitively, which is why the message
      // does not scope the clash to this room type.
      res.status(409).json(ROOM_NUMBER_TAKEN_RESPONSE);
      return;
  }
}

/**
 * Renames one physical room, changes whether it is in service, or both.
 *
 * The room number in the URL identifies a stored room exactly — it is never
 * trimmed or re-cased. A successful rename answers with the NEW number, which
 * is also the room's new address.
 *
 * `not-found` covers two cases the service keeps apart internally and reports
 * the same way here: no room carries that number, and the room was renamed by
 * someone else between resolution and the lock. Which it was is not an
 * administrator's to debug, and saying would invite guessing at numbers.
 */
export async function updateAdminPhysicalRoomHandler(
  req: Request<{ roomNumber: string }>,
  res: Response,
): Promise<void> {
  let roomNumber: string;
  let update: AdminPhysicalRoomUpdate;

  try {
    roomNumber = parseRoomNumberParam(req.params.roomNumber);
    update = parseAdminPhysicalRoomUpdate(req.body);
  } catch (error) {
    // A malformed identifier and a malformed body answer differently: the
    // route keeps INVALID_ROOM_NUMBER, and everything wrong with the body —
    // including the replacement number — is INVALID_ROOM_UPDATE.
    if (isInvalidRoomNumberError(error) || isInvalidRoomUpdateError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  const result = await changeAdminPhysicalRoom(roomNumber, update);

  switch (result.outcome) {
    case 'updated':
      res.status(200).json({ data: result.room });
      return;

    case 'not-found':
      res.status(404).json(ROOM_NOT_FOUND_RESPONSE);
      return;

    case 'room-number-taken':
      res.status(409).json(ROOM_NUMBER_TAKEN_RESPONSE);
      return;

    case 'has-future-reservations':
      // No count, no dates, no guest. There is no way to move a stay to
      // another room, so this is a refusal, not a warning.
      res.status(409).json(ROOM_HAS_FUTURE_RESERVATIONS_RESPONSE);
      return;
  }
}
