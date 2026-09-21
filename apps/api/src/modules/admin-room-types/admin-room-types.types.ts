/**
 * The administration view of room types. Separate from the guest-facing
 * `rooms` module on purpose: different audience, different guard, and a wider
 * set of fields. Nothing here is reachable without an admin session.
 *
 * Money and measurements stay exact decimal strings, as PostgreSQL returned
 * them. A `numeric` read through a JavaScript number is a value that has
 * already lost precision by the time anyone looks at it.
 */

/**
 * One row of the admin room-type list.
 *
 * `roomCount` is the number of physical rooms belonging to this type —
 * admin-only context that says whether the type is bookable at all, since a
 * type with no rooms can never be allocated. The physical rooms themselves
 * stay internal; only how many there are is exposed.
 */
export type AdminRoomTypeListItem = {
  slug: string;
  name: string;
  capacity: number;
  /** Exact decimal string, never a number. */
  baseNightlyRate: string;
  currency: 'EGP';
  isActive: boolean;
  sortOrder: number;
  roomCount: number;
  /** ISO 8601 instant. */
  updatedAt: string;
};

/**
 * One room type in full.
 *
 * Deliberately absent: the database `id`, which is an internal join key with
 * no meaning outside the database.
 */
export type AdminRoomTypeDetail = {
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  capacity: number;
  bedType: string | null;
  bedCount: number | null;
  /** Exact decimal string, never a number. */
  sizeSqm: string | null;
  view: string | null;
  /** Exact decimal string, never a number. */
  baseNightlyRate: string;
  currency: 'EGP';
  isActive: boolean;
  sortOrder: number;
  roomCount: number;
  /** ISO 8601 instant. */
  createdAt: string;
  /** ISO 8601 instant. */
  updatedAt: string;
};

export type AdminRoomTypeListResponse = {
  data: {
    roomTypes: AdminRoomTypeListItem[];
  };
};

export type AdminRoomTypeDetailResponse = {
  data: AdminRoomTypeDetail;
};

/**
 * What an administrator may change about a room type in V1.
 *
 * Every field is optional — a PATCH carries only what is being changed — but a
 * body that changes nothing is refused rather than accepted as a no-op.
 *
 * Absent by decision, not oversight:
 *
 *   `slug`     the public identifier. It is the key a reservation request
 *              names, the public detail URL, and the presentation lookup, and
 *              nothing in this system redirects an old one.
 *   `capacity` availability filters on it and reservation creation enforces
 *              it, so lowering it would strand bookings the system would now
 *              refuse. That needs its own design.
 *   `isActive` archiving removes a room type from the public site, from
 *              availability and from new bookings. Too consequential to ride
 *              along inside a text edit; it gets its own endpoint later.
 *
 * `id`, `currency`, `createdAt` and `updatedAt` are the server's own.
 */
export type AdminRoomTypeUpdate = {
  name?: string;
  shortDescription?: string | null;
  description?: string | null;
  bedType?: string | null;
  bedCount?: number | null;
  /** Exact decimal string, never a number. */
  sizeSqm?: string | null;
  view?: string | null;
  /** Exact decimal string, never a number. */
  baseNightlyRate?: string;
  sortOrder?: number;
};

export const INVALID_ROOM_TYPE_SLUG_ERROR_CODE = 'INVALID_ROOM_TYPE_SLUG';
export const INVALID_ROOM_TYPE_SLUG_ERROR_MESSAGE = 'Invalid room type slug';

/**
 * The route parameter is not a room-type slug. Distinct from a slug that is
 * well formed but unknown, which is a 404: one is a malformed request, the
 * other a question with the answer "no".
 *
 * Fixed message, like the other validation errors in this codebase, so a
 * controller mapping `code`/`message` onto a 400 always produces the locked
 * body and nothing about the expected format can leak into it.
 */
export class InvalidRoomTypeSlugError extends Error {
  readonly code = INVALID_ROOM_TYPE_SLUG_ERROR_CODE;

  constructor() {
    super(INVALID_ROOM_TYPE_SLUG_ERROR_MESSAGE);
    this.name = 'InvalidRoomTypeSlugError';
  }
}

export function isInvalidRoomTypeSlugError(error: unknown): error is InvalidRoomTypeSlugError {
  return error instanceof InvalidRoomTypeSlugError;
}

export const INVALID_ROOM_TYPE_UPDATE_ERROR_CODE = 'INVALID_ROOM_TYPE_UPDATE';
export const INVALID_ROOM_TYPE_UPDATE_ERROR_MESSAGE = 'Invalid room type update';

/**
 * The update body is not one this endpoint accepts.
 *
 * One message for every reason — a bad value, an unknown key, a read-only
 * field, an empty body. Naming the offending field would tell a caller which
 * internal columns exist and which are server-controlled, which is a map of
 * the model rather than help with their request.
 */
export class InvalidRoomTypeUpdateError extends Error {
  readonly code = INVALID_ROOM_TYPE_UPDATE_ERROR_CODE;

  constructor() {
    super(INVALID_ROOM_TYPE_UPDATE_ERROR_MESSAGE);
    this.name = 'InvalidRoomTypeUpdateError';
  }
}

export function isInvalidRoomTypeUpdateError(error: unknown): error is InvalidRoomTypeUpdateError {
  return error instanceof InvalidRoomTypeUpdateError;
}

export const ROOM_TYPE_NOT_FOUND_ERROR_CODE = 'ROOM_TYPE_NOT_FOUND';
export const ROOM_TYPE_NOT_FOUND_ERROR_MESSAGE = 'Room type not found';

/**
 * The one 404 body this module will send, built once and frozen so a future
 * handler can only send the locked contract rather than a hand-assembled
 * near-copy. The requested slug is deliberately absent: echoing a caller's
 * input back into an error body tells them nothing they did not already know.
 */
export const ROOM_TYPE_NOT_FOUND_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: ROOM_TYPE_NOT_FOUND_ERROR_CODE,
    message: ROOM_TYPE_NOT_FOUND_ERROR_MESSAGE,
  }),
});
