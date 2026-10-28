/**
 * The administration view of room types. Separate from the guest-facing
 * `rooms` module on purpose: different audience, different guard, and a wider
 * set of fields. Nothing here is reachable without an admin session.
 *
 * Money and measurements stay exact decimal strings, as MySQL returned
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

/**
 * A new room type, as the repository will receive it: every column it may set,
 * already normalised, with no optionality left to interpret.
 *
 * `isActive` is absent because it is not a choice. A room type is created with
 * no physical rooms, so it cannot be allocated to anyone; publishing it would
 * put a room on the website that every availability search reports as unable
 * to be booked. Creation therefore always produces a draft, and making one
 * public is a separate decision made once it actually has rooms.
 *
 * The six descriptive fields are `| null` rather than optional: an omitted
 * field and an empty one both mean "not recorded", and the create contract
 * resolves that here so nothing downstream has to ask again.
 */
export type AdminRoomTypeCreate = {
  slug: string;
  name: string;
  capacity: number;
  /** Exact decimal string, never a number. */
  baseNightlyRate: string;
  sortOrder: number;
  shortDescription: string | null;
  description: string | null;
  bedType: string | null;
  bedCount: number | null;
  /** Exact decimal string, never a number. */
  sizeSqm: string | null;
  view: string | null;
};

/**
 * Capacity, on its own.
 *
 * Deliberately not part of `AdminRoomTypeUpdate`. Every field there is free
 * text or a number nobody else depends on, and a PATCH carrying them can
 * always be applied. Capacity is the one value availability filters on and
 * reservation creation enforces, so lowering it can conflict with stays
 * already booked — an operation that can be refused does not belong in a body
 * that never can.
 */
export type AdminRoomTypeCapacityUpdate = {
  capacity: number;
};

/**
 * Publishing or archiving one room type.
 *
 * Its own contract for the same reason capacity has one: it can be refused.
 * `isActive` is the value availability and the public catalogue both filter
 * on, so publishing puts a room type in front of guests and archiving takes
 * it away — neither belongs in a general text edit that never fails.
 *
 * One field, and it is a real boolean. There is no third state: a room type
 * that has never been published and one that was withdrawn are the same row
 * to the database, and the difference between them is a story for a screen to
 * tell, not a column.
 */
export type AdminRoomTypeStatusUpdate = {
  isActive: boolean;
};

export const INVALID_ROOM_TYPE_STATUS_ERROR_CODE = 'INVALID_ROOM_TYPE_STATUS';
export const INVALID_ROOM_TYPE_STATUS_ERROR_MESSAGE = 'Invalid room type status';

/** The status body is not one this endpoint accepts. */
export class InvalidRoomTypeStatusError extends Error {
  readonly code = INVALID_ROOM_TYPE_STATUS_ERROR_CODE;

  constructor() {
    super(INVALID_ROOM_TYPE_STATUS_ERROR_MESSAGE);
    this.name = 'InvalidRoomTypeStatusError';
  }
}

export function isInvalidRoomTypeStatusError(
  error: unknown,
): error is InvalidRoomTypeStatusError {
  return error instanceof InvalidRoomTypeStatusError;
}

export const ROOM_TYPE_NO_ACTIVE_ROOMS_ERROR_CODE = 'ROOM_TYPE_NO_ACTIVE_ROOMS';
export const ROOM_TYPE_NO_ACTIVE_ROOMS_ERROR_MESSAGE =
  'Room type cannot be published without at least one active physical room';

/**
 * Publishing a room type that nothing could be allocated from.
 *
 * Availability requires `room_types.is_active AND rooms.is_active`, so a room
 * type published with no active room of its own is visible on the website and
 * unbookable in every search — the exact outcome creation avoids by starting
 * every room type as a draft, and the reason that rule cannot stop at
 * creation.
 *
 * The body carries no count and no room number. How many rooms a type has and
 * which of them are in service is a read, not something a refusal hands back.
 */
export const ROOM_TYPE_NO_ACTIVE_ROOMS_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: ROOM_TYPE_NO_ACTIVE_ROOMS_ERROR_CODE,
    message: ROOM_TYPE_NO_ACTIVE_ROOMS_ERROR_MESSAGE,
  }),
});

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

export const INVALID_ROOM_TYPE_CREATE_ERROR_CODE = 'INVALID_ROOM_TYPE_CREATE';
export const INVALID_ROOM_TYPE_CREATE_ERROR_MESSAGE = 'Invalid room type creation request';

/**
 * The creation body is not one this endpoint accepts.
 *
 * One message for every reason — a bad value, a missing required field, an
 * unknown key, a server-controlled key, a malformed slug. The slug is part of
 * this body, so a bad one is a bad creation request rather than a bad route
 * parameter: `INVALID_ROOM_TYPE_SLUG` stays the answer for the identifier in
 * a URL, and every rejection of a body belongs to that body's own contract.
 */
export class InvalidRoomTypeCreateError extends Error {
  readonly code = INVALID_ROOM_TYPE_CREATE_ERROR_CODE;

  constructor() {
    super(INVALID_ROOM_TYPE_CREATE_ERROR_MESSAGE);
    this.name = 'InvalidRoomTypeCreateError';
  }
}

export function isInvalidRoomTypeCreateError(error: unknown): error is InvalidRoomTypeCreateError {
  return error instanceof InvalidRoomTypeCreateError;
}

export const ROOM_TYPE_SLUG_TAKEN_ERROR_CODE = 'ROOM_TYPE_SLUG_TAKEN';
export const ROOM_TYPE_SLUG_TAKEN_ERROR_MESSAGE = 'Room type reference is already in use';

/**
 * A slug someone already used. Frozen and built once, so a future handler can
 * only send the locked contract rather than a hand-assembled near-copy.
 *
 * The slug is deliberately absent: the caller sent it, and echoing it back
 * tells them nothing while turning an error body into a lookup oracle.
 *
 * "reference", not "slug", because this reaches an administrator who chose it
 * in a form field labelled Reference, not a developer reading the schema.
 */
export const ROOM_TYPE_SLUG_TAKEN_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: ROOM_TYPE_SLUG_TAKEN_ERROR_CODE,
    message: ROOM_TYPE_SLUG_TAKEN_ERROR_MESSAGE,
  }),
});

export const INVALID_ROOM_TYPE_CAPACITY_ERROR_CODE = 'INVALID_ROOM_TYPE_CAPACITY';
export const INVALID_ROOM_TYPE_CAPACITY_ERROR_MESSAGE = 'Invalid room type capacity';

/** The capacity body is not one this endpoint accepts. */
export class InvalidRoomTypeCapacityError extends Error {
  readonly code = INVALID_ROOM_TYPE_CAPACITY_ERROR_CODE;

  constructor() {
    super(INVALID_ROOM_TYPE_CAPACITY_ERROR_MESSAGE);
    this.name = 'InvalidRoomTypeCapacityError';
  }
}

export function isInvalidRoomTypeCapacityError(
  error: unknown,
): error is InvalidRoomTypeCapacityError {
  return error instanceof InvalidRoomTypeCapacityError;
}

export const ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_ERROR_CODE =
  'ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS';
export const ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_ERROR_MESSAGE =
  'Room type capacity conflicts with existing upcoming reservations';

/**
 * Lowering capacity below what an upcoming stay already booked.
 *
 * The base body carries no guest count, no booking reference and no date — a
 * refusal is not a place to read reservation data out of. A later HTTP design
 * may add a plain `conflictingReservationCount` alongside this `error` object;
 * this frozen value is what the `error` member must always be.
 */
export const ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_ERROR_CODE,
    message: ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_ERROR_MESSAGE,
  }),
});
