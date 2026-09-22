/**
 * Physical rooms, as an administrator sees them.
 *
 * A physical room is what the backend allocates; a room type is what a guest
 * books. Guests never see this module at all — the public API exposes room
 * types only, and a room number appears nowhere outside the admin area.
 *
 * Separate from `admin-room-types` on purpose. These are different rows, a
 * different identifier and a different lifecycle: a room type is published or
 * archived, a room is in service or out of it.
 */

/**
 * One physical room.
 *
 * `id` and `roomTypeId` are absent by design — both are internal join keys
 * with no meaning outside the database, and a room is addressed by its number,
 * which is unique hotel-wide.
 */
export type AdminPhysicalRoom = {
  roomNumber: string;
  isActive: boolean;
  /** ISO 8601 instant. */
  createdAt: string;
  /** ISO 8601 instant. */
  updatedAt: string;
};

export type AdminPhysicalRoomListResponse = {
  data: {
    rooms: AdminPhysicalRoom[];
  };
};

/**
 * The envelope for a single room, as creating or updating one answers with.
 * Mirrors `AdminRoomTypeDetailResponse` so both admin resources wrap one row
 * the same way.
 */
export type AdminPhysicalRoomResponse = {
  data: AdminPhysicalRoom;
};

/**
 * A new physical room.
 *
 * It carries no room type: which type a room belongs to comes from the route
 * it was created under, not from the body. `isActive` is absent too — a newly
 * added room is in service, and a room that should not be is one that should
 * not have been added yet.
 */
export type AdminPhysicalRoomCreate = {
  roomNumber: string;
};

/**
 * A change to one physical room: its number, its service status, or both.
 *
 * Both optional, but a body mentioning neither is refused rather than treated
 * as a no-op. `roomTypeId` is deliberately absent — moving a room between
 * types is not a V1 operation, and the composite foreign key from
 * `reservations` refuses it outright for any room with booking history.
 */
export type AdminPhysicalRoomUpdate = {
  roomNumber?: string;
  isActive?: boolean;
};

export const INVALID_ROOM_NUMBER_ERROR_CODE = 'INVALID_ROOM_NUMBER';
export const INVALID_ROOM_NUMBER_ERROR_MESSAGE = 'Invalid room number';

/**
 * The value is not a room number this system will resolve.
 *
 * Raised only for a room number arriving as a route *identifier* — the thing
 * naming which room a request is about. A request body is never answered with
 * this, even when the only field it carries is a room number: a body has its
 * own contract, and which half of a request was malformed is the one
 * distinction worth drawing.
 *
 * Fixed message, so nothing about the expected format leaks into the response.
 */
export class InvalidRoomNumberError extends Error {
  readonly code = INVALID_ROOM_NUMBER_ERROR_CODE;

  constructor() {
    super(INVALID_ROOM_NUMBER_ERROR_MESSAGE);
    this.name = 'InvalidRoomNumberError';
  }
}

export function isInvalidRoomNumberError(error: unknown): error is InvalidRoomNumberError {
  return error instanceof InvalidRoomNumberError;
}

export const INVALID_ROOM_CREATE_ERROR_CODE = 'INVALID_ROOM_CREATE';
export const INVALID_ROOM_CREATE_ERROR_MESSAGE = 'Invalid room creation request';

/**
 * The creation body is not one this endpoint accepts.
 *
 * One message for every reason — a non-object body, a missing `roomNumber`, an
 * unknown key, a server-controlled key, a malformed number. It is the body's
 * own contract even though the body currently carries a single field: the
 * error a caller receives should say which part of their request was wrong,
 * not happen to coincide with it, and this endpoint's body may gain fields
 * without its error contract changing meaning.
 */
export class InvalidRoomCreateError extends Error {
  readonly code = INVALID_ROOM_CREATE_ERROR_CODE;

  constructor() {
    super(INVALID_ROOM_CREATE_ERROR_MESSAGE);
    this.name = 'InvalidRoomCreateError';
  }
}

export function isInvalidRoomCreateError(error: unknown): error is InvalidRoomCreateError {
  return error instanceof InvalidRoomCreateError;
}

export const INVALID_ROOM_UPDATE_ERROR_CODE = 'INVALID_ROOM_UPDATE';
export const INVALID_ROOM_UPDATE_ERROR_MESSAGE = 'Invalid room update';

/**
 * The update body is not one this endpoint accepts.
 *
 * One message for every reason — a malformed replacement number, a
 * non-boolean status, an unknown key, an empty body. Naming the offending
 * field would tell a caller which internal columns exist.
 */
export class InvalidRoomUpdateError extends Error {
  readonly code = INVALID_ROOM_UPDATE_ERROR_CODE;

  constructor() {
    super(INVALID_ROOM_UPDATE_ERROR_MESSAGE);
    this.name = 'InvalidRoomUpdateError';
  }
}

export function isInvalidRoomUpdateError(error: unknown): error is InvalidRoomUpdateError {
  return error instanceof InvalidRoomUpdateError;
}

export const ROOM_NOT_FOUND_ERROR_CODE = 'ROOM_NOT_FOUND';
export const ROOM_NOT_FOUND_ERROR_MESSAGE = 'Room not found';

/**
 * No room carries that number. Built once and frozen, so a future handler can
 * only send the locked contract rather than a hand-assembled near-copy. The
 * requested number is deliberately absent: the caller sent it.
 */
export const ROOM_NOT_FOUND_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: ROOM_NOT_FOUND_ERROR_CODE,
    message: ROOM_NOT_FOUND_ERROR_MESSAGE,
  }),
});

export const ROOM_NUMBER_TAKEN_ERROR_CODE = 'ROOM_NUMBER_TAKEN';
export const ROOM_NUMBER_TAKEN_ERROR_MESSAGE = 'Room number is already in use';

/**
 * Some room already has that number.
 *
 * The wording says "already in use" and stops there, deliberately: room
 * numbers are unique across the whole hotel, not within one room type, and
 * `rooms_room_number_lower_key` makes that case-insensitive. A message hinting
 * the clash were local to this room type would send an administrator looking
 * in the wrong place — the conflicting room may well belong to another type,
 * and may differ only in letter case.
 */
export const ROOM_NUMBER_TAKEN_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: ROOM_NUMBER_TAKEN_ERROR_CODE,
    message: ROOM_NUMBER_TAKEN_ERROR_MESSAGE,
  }),
});

export const ROOM_HAS_FUTURE_RESERVATIONS_ERROR_CODE = 'ROOM_HAS_FUTURE_RESERVATIONS';
export const ROOM_HAS_FUTURE_RESERVATIONS_ERROR_MESSAGE = 'Room has upcoming reservations';

/**
 * The room cannot be taken out of service while guests are booked into it.
 *
 * Taking a room out of service while an upcoming stay is allocated to it would
 * leave that stay pointing at a room the hotel believes is closed, with
 * nothing anywhere flagging the contradiction — and this system has no way to
 * move a reservation to another room.
 *
 * The base body carries no guest data, no booking reference and no date. A
 * later HTTP design may add a plain count alongside this `error` object; this
 * frozen value is what the `error` member must always be.
 */
export const ROOM_HAS_FUTURE_RESERVATIONS_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: ROOM_HAS_FUTURE_RESERVATIONS_ERROR_CODE,
    message: ROOM_HAS_FUTURE_RESERVATIONS_ERROR_MESSAGE,
  }),
});
