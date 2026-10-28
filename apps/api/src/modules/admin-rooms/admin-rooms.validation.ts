import {
  InvalidRoomCreateError,
  InvalidRoomNumberError,
  InvalidRoomUpdateError,
  type AdminPhysicalRoomCreate,
  type AdminPhysicalRoomUpdate,
} from './admin-rooms.types';

/**
 * What a room number is, and what may be said about a physical room.
 *
 * Pure: no database, no Express, no I/O.
 *
 * A room number is whatever the hotel calls a room. This module deliberately
 * learns nothing about floors, wings, blocks or numeric ranges — those are the
 * hotel's conventions, not this system's, and a parser that guessed at them
 * would eventually refuse a real room. It constrains only what would break
 * something: length, characters that break URLs, and characters that are not
 * text at all.
 *
 * Uniqueness is not checked here and cannot be. MySQL owns it, through
 * `rooms_room_number_key` for the exact value and
 * `rooms_room_number_lower_key` for the case-insensitive one.
 */

/** Internal. Never leaves this module; each public parser converts it. */
class RoomFieldError extends Error {
  constructor() {
    super('Invalid physical room field');
    this.name = 'RoomFieldError';
  }
}

function fail(): never {
  throw new RoomFieldError();
}

function underContract<T>(parse: () => T, toContractError: () => Error): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof RoomFieldError) {
      throw toContractError();
    }

    throw error;
  }
}

/**
 * Long enough for any real numbering scheme, short enough that an unbounded
 * `text` admin field is not a denial-of-service surface or a layout problem.
 * Counted in UTF-16 code units, as every other length limit in this codebase
 * is.
 */
const MAX_ROOM_NUMBER_LENGTH = 20;

/**
 * C0 (U+0000–U+001F), DEL and C1 (U+007F–U+009F).
 *
 * None of these are text an operator meant to type. Tab and newline fall in
 * C0, so an internal tab is refused while an internal space is not — a space
 * is a character in a room number, a tab is a layout accident.
 */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Characters that would make a room number ambiguous inside a URL, where it is
 * a path segment: the two slashes, the query and fragment delimiters, and the
 * percent that introduces an escape.
 *
 * Refused at the source rather than escaped at every use. A room number is
 * chosen once by a person who can choose a different one; a system that has to
 * remember to encode it correctly everywhere will eventually forget.
 */
const URL_DELIMITER_PATTERN = /[/\\?#%]/;

function assertUsableRoomNumber(value: string): void {
  if (value.length === 0 || value.length > MAX_ROOM_NUMBER_LENGTH) {
    fail();
  }

  if (CONTROL_CHARACTER_PATTERN.test(value) || URL_DELIMITER_PATTERN.test(value)) {
    fail();
  }
}

/** The body/storage form, throwing the marker. Shared by create and update. */
function roomNumberInput(value: unknown): string {
  if (typeof value !== 'string') {
    fail();
  }

  // Trimmed, then judged. A number typed with a stray space at either end is
  // the same number, and the trimmed value is what gets stored — so every
  // later lookup by that number finds it.
  const trimmed = value.trim();

  assertUsableRoomNumber(trimmed);

  // Case is never touched. `D-101` is stored as `D-101`; the database refuses
  // a second room called `d-101`, which is a different question.
  return trimmed;
}

/**
 * A room number arriving in a request body, for storage.
 *
 * Returns the trimmed value — what will be written, and therefore what every
 * later lookup must use.
 */
export function parseRoomNumberInput(value: unknown): string {
  return underContract(
    () => roomNumberInput(value),
    () => new InvalidRoomNumberError(),
  );
}

/**
 * A room number arriving as a route parameter, identifying a stored room.
 *
 * Deliberately *not* trimmed. A body is input on its way to being stored, so
 * tidying it is part of accepting it; a URL names something that already
 * exists, and ` D-101 ` is not the name of anything. Trimming here would let
 * two URLs address one room, and would quietly disagree with a future exact
 * lookup.
 *
 * The forbidden-character rules still apply. Express decodes percent-escapes
 * before this ever sees the value, so `%2F` arrives as a real slash and is
 * caught here rather than reaching a query as part of an identifier.
 */
export function parseRoomNumberParam(value: unknown): string {
  return underContract(() => {
    if (typeof value !== 'string') {
      fail();
    }

    // Padding is a different value, not a sloppy spelling of this one.
    if (value !== value.trim()) {
      fail();
    }

    assertUsableRoomNumber(value);

    return value;
  }, () => new InvalidRoomNumberError());
}

function requirePlainJsonObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail();
  }

  // A null prototype is accepted because `JSON.parse` with a reviver can
  // produce one. A Date, Map or class instance is an object whose fields would
  // not survive a JSON round-trip.
  const prototype = Object.getPrototypeOf(body);

  if (prototype !== Object.prototype && prototype !== null) {
    fail();
  }

  return body as Record<string, unknown>;
}

/**
 * Validates a new physical room.
 *
 * Every way the body can be wrong — not an object, no `roomNumber`, an extra
 * key, a server-controlled key, a malformed number — raises
 * `InvalidRoomCreateError`. The body has its own contract even though it
 * currently carries one field, so a caller can always tell which half of their
 * request was rejected: the room they named, or what they sent about it.
 */
export function parseAdminPhysicalRoomCreate(body: unknown): AdminPhysicalRoomCreate {
  return underContract(() => {
    const record = requirePlainJsonObject(body);
    const keys = Object.keys(record);

    if (keys.length !== 1 || keys[0] !== 'roomNumber') {
      fail();
    }

    return { roomNumber: roomNumberInput(record.roomNumber) };
  }, () => new InvalidRoomCreateError());
}

const UPDATABLE_KEYS = ['roomNumber', 'isActive'] as const;

/**
 * Validates a change to one physical room.
 *
 * Shape only. Whether deactivating this room would strand an upcoming stay is
 * a question about reservations, which no pure function can answer — the
 * service decides that under a row lock, and refuses with
 * `ROOM_HAS_FUTURE_RESERVATIONS`.
 *
 * A malformed replacement number raises `InvalidRoomUpdateError`, not
 * `InvalidRoomNumberError`, under the locked three-way ownership this module
 * follows:
 *
 *   route identifier   INVALID_ROOM_NUMBER
 *   POST create body   INVALID_ROOM_CREATE
 *   PATCH update body  INVALID_ROOM_UPDATE
 *
 * So the two halves of a PATCH stay distinguishable — which of the two numbers
 * was wrong is exactly what the caller needs to know, and it is the one
 * distinction that gives nothing away.
 */
export function parseAdminPhysicalRoomUpdate(body: unknown): AdminPhysicalRoomUpdate {
  return underContract(() => {
    const record = requirePlainJsonObject(body);
    const keys = Object.keys(record);

    // A body that changes nothing is refused rather than answered with "done".
    if (keys.length === 0) {
      fail();
    }

    for (const key of keys) {
      if (!(UPDATABLE_KEYS as readonly string[]).includes(key)) {
        fail();
      }
    }

    const update: AdminPhysicalRoomUpdate = {};

    if ('roomNumber' in record) {
      update.roomNumber = roomNumberInput(record.roomNumber);
    }

    if ('isActive' in record) {
      // A real boolean. "true", 1 and null are not answers to a yes/no
      // question about whether a room is in service.
      if (typeof record.isActive !== 'boolean') {
        fail();
      }

      update.isActive = record.isActive;
    }

    return update;
  }, () => new InvalidRoomUpdateError());
}
