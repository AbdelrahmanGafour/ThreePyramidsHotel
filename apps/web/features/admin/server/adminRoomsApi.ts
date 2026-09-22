import "server-only";

import { ApiConfigurationError, resolveApiBaseUrl } from "@/shared/server/apiBaseUrl";
import type {
  AdminPhysicalRoom,
  AdminPhysicalRoomCreate,
  AdminPhysicalRoomUpdate,
} from "../types";

// Server-only client for the hotel API's physical-room endpoints.
//
// The import above is the boundary: importing this module from client code
// fails the build, so the API address never reaches the browser bundle. It
// talks to Express directly and never to this app's own route handlers — a
// room number appears nowhere outside the admin area, and there is
// deliberately no same-origin proxy for it.
//
// Separate from `adminRoomTypesApi` on purpose, mirroring the API's own module
// split: these are different rows with a different identifier and a different
// lifecycle. A room type is published or archived; a room is in service or out
// of it.
//
// It holds no state and decides nothing: it forwards the caller's Cookie
// header and reports what the API said. Nothing is logged — not the cookie,
// not a response body, not the configured API address.

const ADMIN_ROOM_TYPES_PATH = "/api/v1/admin/room-types";
const ADMIN_ROOMS_PATH = "/api/v1/admin/rooms";

// The error bodies these endpoints are contracted to send. A status that
// matches but a body that does not is some other failure wearing the same
// number, so it is reported as an outage rather than as an answer.

/**
 * The admin session guard's own refusal, identical for every reason it
 * refuses.
 *
 * Duplicated from `admin-auth.middleware.ts` rather than imported: it lives in
 * the API workspace, which this app cannot reach, and the existing web clients
 * keep no shared copy. Both sides must be changed together — the API's
 * `NOT_AUTHENTICATED` constant is the source of truth.
 */
const NOT_AUTHENTICATED_ERROR = {
  code: "NOT_AUTHENTICATED",
  message: "Authentication required",
} as const;

/** The room type a room hangs from; its contract is the room-types module's. */
const INVALID_ROOM_TYPE_SLUG_ERROR = {
  code: "INVALID_ROOM_TYPE_SLUG",
  message: "Invalid room type slug",
} as const;

const ROOM_TYPE_NOT_FOUND_ERROR = {
  code: "ROOM_TYPE_NOT_FOUND",
  message: "Room type not found",
} as const;

const INVALID_ROOM_CREATE_ERROR = {
  code: "INVALID_ROOM_CREATE",
  message: "Invalid room creation request",
} as const;

const INVALID_ROOM_NUMBER_ERROR = {
  code: "INVALID_ROOM_NUMBER",
  message: "Invalid room number",
} as const;

const INVALID_ROOM_UPDATE_ERROR = {
  code: "INVALID_ROOM_UPDATE",
  message: "Invalid room update",
} as const;

const ROOM_NOT_FOUND_ERROR = {
  code: "ROOM_NOT_FOUND",
  message: "Room not found",
} as const;

const ROOM_NUMBER_TAKEN_ERROR = {
  code: "ROOM_NUMBER_TAKEN",
  message: "Room number is already in use",
} as const;

const ROOM_HAS_FUTURE_RESERVATIONS_ERROR = {
  code: "ROOM_HAS_FUTURE_RESERVATIONS",
  message: "Room has upcoming reservations",
} as const;

// The ways this client can fail before the API answers. A wrong or missing API
// address is a deployment fault, not an outage, and saying "could not be
// reached" about it would send someone to check a network that is fine.
// Neither carries the configured value or a hostname.
const MISCONFIGURED_REASON = "The hotel system is not configured correctly.";
const UNREACHABLE_REASON = "The hotel API could not be reached.";
const UNREADABLE_RESPONSE_REASON = "The hotel API returned an unreadable response.";
const UNEXPECTED_RESPONSE_REASON = "The hotel API returned an unexpected room response.";

/**
 * Five outcomes for reading one room type's inventory. A room type that has no
 * rooms yet is a success with an empty list; a slug nobody has used is not.
 */
export type AdminPhysicalRoomListResult =
  | { state: "ok"; data: AdminPhysicalRoom[] }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "not-found" }
  | { state: "unavailable"; reason: string };

/** The same, plus the body the API refused and a number already in use. */
export type AdminPhysicalRoomCreateResult =
  | { state: "ok"; data: AdminPhysicalRoom }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "invalid-create" }
  | { state: "not-found" }
  | { state: "room-number-taken" }
  | { state: "unavailable"; reason: string };

/**
 * Seven outcomes for changing one room. A refused body, a number already in
 * use and a room with guests booked into it are three different answers, and a
 * page that treated them alike would tell an administrator to fix the wrong
 * thing.
 */
export type AdminPhysicalRoomUpdateResult =
  | { state: "ok"; data: AdminPhysicalRoom }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "invalid-update" }
  | { state: "not-found" }
  | { state: "room-number-taken" }
  | { state: "has-future-reservations" }
  | { state: "unavailable"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True only for the exact error body the API is contracted to send. */
function matchesApiError(payload: unknown, expected: { code: string; message: string }): boolean {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return false;
  }

  return payload.error.code === expected.code && payload.error.message === expected.message;
}

async function readJson(response: Response): Promise<unknown | undefined> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Classifies a 401 by its body, not by its status alone.
 *
 * Only the admin guard's own refusal means "your session is not valid". A 401
 * from anything else in front of the API — a gateway, a proxy demanding its
 * own credentials — carries a different body, and reading it as a signed-out
 * administrator would send someone to log in again over a problem logging in
 * cannot fix.
 */
async function classifyUnauthenticated(
  response: Response,
): Promise<{ state: "unauthenticated" } | { state: "unavailable"; reason: string }> {
  const payload = await readJson(response);

  if (matchesApiError(payload, NOT_AUTHENTICATED_ERROR)) {
    return { state: "unauthenticated" };
  }

  return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
}

/**
 * The canonical ISO instant the API produces: `YYYY-MM-DDTHH:mm:ss.sssZ`.
 *
 * The round trip is the contract. `Date` parses far more than the API ever
 * sends — a bare day, an offset like `+02:00` — and merely parsing proves only
 * that JavaScript coped. Re-serialising and demanding the same string admits
 * only what `toISOString()` itself produces.
 */
function isInstant(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const parsed = new Date(value);

  // Checked first: toISOString() throws on an invalid date.
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.toISOString() === value;
}

/**
 * Rebuilds one physical room from the payload, field by field.
 *
 * Nothing is spread through: a response is data from another process, and only
 * the fields this app has a use for are carried across — so an `id` or a
 * `roomTypeId` the API should never send could not reach a page even if it
 * did. Anything missing, mistyped or unexpected returns null, which the caller
 * reports as an outage rather than rendering half a room.
 *
 * The room number is carried through exactly as returned: never re-cased,
 * never trimmed. `D-101` and `d-101` are different rooms as far as identity
 * goes, and the API has already decided which one this is.
 */
function toPhysicalRoom(value: unknown): AdminPhysicalRoom | null {
  if (!isRecord(value)) {
    return null;
  }

  const { roomNumber, isActive, createdAt, updatedAt } = value;

  if (typeof roomNumber !== "string" || roomNumber.length === 0) {
    return null;
  }

  if (typeof isActive !== "boolean") {
    return null;
  }

  if (!isInstant(createdAt) || !isInstant(updatedAt)) {
    return null;
  }

  return { roomNumber, isActive, createdAt, updatedAt };
}

/** The list envelope: `{ data: { rooms: [...] } }` and nothing else. */
function toRoomListPayload(payload: unknown): AdminPhysicalRoom[] | null {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }

  const { rooms } = payload.data;

  if (!Array.isArray(rooms)) {
    return null;
  }

  const items: AdminPhysicalRoom[] = [];

  for (const entry of rooms) {
    const room = toPhysicalRoom(entry);

    // One bad row invalidates the list: silently dropping it would show fewer
    // rooms than the hotel has, with no sign anything was missing.
    if (!room) {
      return null;
    }

    items.push(room);
  }

  return items;
}

/** The single-room envelope: `{ data: {...} }` and nothing else. */
function toRoomPayload(payload: unknown): AdminPhysicalRoom | null {
  if (!isRecord(payload)) {
    return null;
  }

  return toPhysicalRoom(payload.data);
}

/**
 * Resolves the API address, kept separate from the fetch below so a
 * configuration fault cannot be caught by, and mistaken for, a network
 * failure.
 */
function resolveBaseUrl(): { ok: true; baseUrl: string } | { ok: false; reason: string } {
  try {
    return { ok: true, baseUrl: resolveApiBaseUrl() };
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { ok: false, reason: MISCONFIGURED_REASON };
    }

    throw error;
  }
}

function authHeaders(cookie?: string): Record<string, string> {
  // Only the caller's own Cookie header, forwarded verbatim. No authorization
  // header, and nothing else a browser happened to send.
  return cookie ? { Cookie: cookie } : {};
}

/**
 * Reads every physical room of one room type, in service or out of it.
 *
 * The Cookie header is forwarded verbatim: this app never parses it, names the
 * session cookie, or decides whether it is valid — Express and PostgreSQL do.
 *
 * A read that fails is simply unavailable; unlike the mutations below, nothing
 * may have happened that this client failed to learn about.
 */
export async function fetchAdminPhysicalRooms(
  slug: string,
  cookie?: string,
): Promise<AdminPhysicalRoomListResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  // Encoded as exactly one path segment: the slug is caller input, and a slash
  // or a query character in it must not become part of the URL's structure.
  const url = `${resolved.baseUrl}${ADMIN_ROOM_TYPES_PATH}/${encodeURIComponent(slug)}/rooms`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: authHeaders(cookie),
      // Inventory is editable; nothing here may be served from a snapshot.
      cache: "no-store",
    });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return await classifyUnauthenticated(response);
  }

  // For these the status alone is not enough: each has a contracted body, and
  // anything else answering with the same number is not this contract.
  if (response.status === 400 || response.status === 404) {
    const payload = await readJson(response);

    if (response.status === 400 && matchesApiError(payload, INVALID_ROOM_TYPE_SLUG_ERROR)) {
      return { state: "invalid-reference" };
    }

    if (response.status === 404 && matchesApiError(payload, ROOM_TYPE_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: UNREADABLE_RESPONSE_REASON };
  }

  const data = toRoomListPayload(payload);

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}

/**
 * Adds one physical room to a room type.
 *
 * Exactly one HTTP request, and never retried. A POST whose connection dropped
 * may well have committed first, so repeating it could add a second room or
 * turn a success into a confusing "number already in use". The caller is told
 * the outcome is unknown instead.
 *
 * The room number is sent exactly as given — the API trims it before storage,
 * and normalising it here would mean asking about a value the caller never
 * sent.
 */
export async function createAdminPhysicalRoom(
  slug: string,
  create: AdminPhysicalRoomCreate,
  cookie?: string,
): Promise<AdminPhysicalRoomCreateResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  const url = `${resolved.baseUrl}${ADMIN_ROOM_TYPES_PATH}/${encodeURIComponent(slug)}/rooms`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(cookie) },
      body: JSON.stringify(create),
      // A mutation is never cacheable.
      cache: "no-store",
    });
  } catch {
    // The request may never have arrived — or may have arrived and committed
    // before the connection failed. Reported as an outage, never as a refusal
    // and never as success, and never retried here.
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return await classifyUnauthenticated(response);
  }

  if (response.status === 400 || response.status === 404 || response.status === 409) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_ROOM_TYPE_SLUG_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_ROOM_CREATE_ERROR)) {
        return { state: "invalid-create" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, ROOM_TYPE_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    // One contract covers both the exact and the case-insensitive unique
    // index: to an administrator, a clash on either means the same thing.
    if (response.status === 409 && matchesApiError(payload, ROOM_NUMBER_TAKEN_ERROR)) {
      return { state: "room-number-taken" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: UNREADABLE_RESPONSE_REASON };
  }

  const data = toRoomPayload(payload);

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}

/**
 * Renames one physical room, changes whether it is in service, or both.
 *
 * Exactly one HTTP request, and never retried — the same reasoning as every
 * other mutation here.
 *
 * The room number identifying the room is sent exactly as given: never
 * trimmed, never re-cased. It is percent-encoded as one path segment, which
 * matters more here than for a slug — a room number may contain spaces, and a
 * raw space is not a legal URL character.
 *
 * Unlike the room-type detail client, the returned room number is deliberately
 * **not** checked against the requested one. A successful rename is supposed
 * to answer with a different number, so an identity check here would reject
 * exactly the case it was meant to protect.
 */
export async function updateAdminPhysicalRoom(
  roomNumber: string,
  update: AdminPhysicalRoomUpdate,
  cookie?: string,
): Promise<AdminPhysicalRoomUpdateResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  const url = `${resolved.baseUrl}${ADMIN_ROOMS_PATH}/${encodeURIComponent(roomNumber)}`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(cookie) },
      body: JSON.stringify(update),
      cache: "no-store",
    });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return await classifyUnauthenticated(response);
  }

  if (response.status === 400 || response.status === 404 || response.status === 409) {
    const payload = await readJson(response);

    if (response.status === 400) {
      // The route identifier and the body carry different contracts, so which
      // half of the request was wrong survives the round trip.
      if (matchesApiError(payload, INVALID_ROOM_NUMBER_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_ROOM_UPDATE_ERROR)) {
        return { state: "invalid-update" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, ROOM_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    if (response.status === 409) {
      if (matchesApiError(payload, ROOM_NUMBER_TAKEN_ERROR)) {
        return { state: "room-number-taken" };
      }
      if (matchesApiError(payload, ROOM_HAS_FUTURE_RESERVATIONS_ERROR)) {
        return { state: "has-future-reservations" };
      }
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: UNREADABLE_RESPONSE_REASON };
  }

  const data = toRoomPayload(payload);

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}
