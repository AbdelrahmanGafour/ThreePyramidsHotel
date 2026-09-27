import "server-only";

import { ApiConfigurationError, resolveApiBaseUrl } from "@/shared/server/apiBaseUrl";
import type {
  AdminRoomTypeCreate,
  AdminRoomTypeDetail,
  AdminRoomTypeListItem,
  AdminRoomTypeUpdate,
} from "../types";

// Server-only client for the hotel API's admin room-type endpoints.
//
// The import above is the boundary: importing this module from client code
// fails the build, so the API address never reaches the browser bundle. It
// talks to Express directly and never to this app's own route handlers — the
// browser has no reason to see the room-type catalogue except through a
// server-rendered page, and there is deliberately no same-origin proxy for it.
//
// It holds no state and decides nothing: it forwards the caller's Cookie
// header and reports what the API said. Nothing is logged — not the cookie,
// not a response body, not the configured API address.

const ADMIN_ROOM_TYPES_PATH = "/api/v1/admin/room-types";

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

const INVALID_ROOM_TYPE_SLUG_ERROR = {
  code: "INVALID_ROOM_TYPE_SLUG",
  message: "Invalid room type slug",
} as const;

const INVALID_ROOM_TYPE_UPDATE_ERROR = {
  code: "INVALID_ROOM_TYPE_UPDATE",
  message: "Invalid room type update",
} as const;

const ROOM_TYPE_NOT_FOUND_ERROR = {
  code: "ROOM_TYPE_NOT_FOUND",
  message: "Room type not found",
} as const;

const INVALID_ROOM_TYPE_CREATE_ERROR = {
  code: "INVALID_ROOM_TYPE_CREATE",
  message: "Invalid room type creation request",
} as const;

const ROOM_TYPE_SLUG_TAKEN_ERROR = {
  code: "ROOM_TYPE_SLUG_TAKEN",
  message: "Room type reference is already in use",
} as const;

const INVALID_ROOM_TYPE_CAPACITY_ERROR = {
  code: "INVALID_ROOM_TYPE_CAPACITY",
  message: "Invalid room type capacity",
} as const;

const ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_ERROR = {
  code: "ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS",
  message: "Room type capacity conflicts with existing upcoming reservations",
} as const;

const INVALID_ROOM_TYPE_STATUS_ERROR = {
  code: "INVALID_ROOM_TYPE_STATUS",
  message: "Invalid room type status",
} as const;

const ROOM_TYPE_NO_ACTIVE_ROOMS_ERROR = {
  code: "ROOM_TYPE_NO_ACTIVE_ROOMS",
  message: "Room type cannot be published without at least one active physical room",
} as const;

// The two ways this client can fail before the API answers. Distinct on
// purpose: a wrong or missing API address is a deployment fault, not an
// outage, and saying "could not be reached" about it would send someone to
// check a network that is fine. Neither carries the configured value or a
// hostname.
const MISCONFIGURED_REASON = "The hotel system is not configured correctly.";
const UNREACHABLE_REASON = "The hotel API could not be reached.";
const UNREADABLE_RESPONSE_REASON = "The hotel API returned an unreadable response.";
const UNEXPECTED_RESPONSE_REASON = "The hotel API returned an unexpected room type response.";

/**
 * Three outcomes for a read of the whole catalogue. An API that cannot be
 * reached is a server problem and a refused session is an authentication
 * problem — neither is "this hotel has no room types".
 */
export type AdminRoomTypeListResult =
  | { state: "ok"; data: AdminRoomTypeListItem[] }
  | { state: "unauthenticated" }
  | { state: "unavailable"; reason: string };

/**
 * A slug that is not a slug and a slug nobody has used are different facts,
 * and neither is an outage. A page may present them the same way; that is the
 * page's decision, not this client's.
 */
export type AdminRoomTypeDetailResult =
  | { state: "ok"; data: AdminRoomTypeDetail }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "not-found" }
  | { state: "unavailable"; reason: string };

/** The same, plus the body the API refused. */
export type AdminRoomTypeUpdateResult =
  | { state: "ok"; data: AdminRoomTypeDetail }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "invalid-update" }
  | { state: "not-found" }
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

function isCount(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
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
 * The precision and scale of the columns behind these fields, mirrored from
 * the API's own validator so both ends agree on what a value may look like.
 *
 * `numeric(12,2)`: up to ten digits before the point and two after.
 * `numeric(6,2)`: up to four before and two after.
 *
 * Both anchored and unsigned — each column carries a CHECK forbidding
 * negatives — so an exponent, a sign, whitespace padding, a bare `.5` or a
 * trailing `1.` cannot pass.
 */
const BASE_NIGHTLY_RATE_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;
const SIZE_SQM_PATTERN = /^\d{1,4}(?:\.\d{1,2})?$/;

/** A decimal string carrying at least one non-zero digit, so "0.00" is not positive. */
const HAS_NON_ZERO_DIGIT = /[1-9]/;

/**
 * An exact decimal as PostgreSQL rendered it.
 *
 * Required as a string: a number here would mean the value had already been
 * through a float before this client ever saw it, which is the whole thing a
 * `numeric` column exists to prevent. The string is never rewritten or
 * normalised — whatever the API sent is what is carried forward.
 */
function isDecimalString(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
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

/** A nullable text field: absent as null, or a string. */
function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Rebuilds one list row from the payload, field by field.
 *
 * Nothing is spread through: a response is data from another process, and only
 * the fields this app has a use for are carried across. Anything missing,
 * mistyped or unexpected returns null, which the caller reports as an outage
 * rather than rendering half a row.
 */
function toListItem(value: unknown): AdminRoomTypeListItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const { slug, name, capacity, baseNightlyRate, currency, isActive, sortOrder, roomCount, updatedAt } =
    value;

  if (typeof slug !== "string" || slug.length === 0 || typeof name !== "string") {
    return null;
  }

  if (!isCount(capacity, 1) || !isCount(sortOrder, 0) || !isCount(roomCount, 0)) {
    return null;
  }

  if (!isDecimalString(baseNightlyRate, BASE_NIGHTLY_RATE_PATTERN) || currency !== "EGP" || typeof isActive !== "boolean") {
    return null;
  }

  if (!isInstant(updatedAt)) {
    return null;
  }

  return {
    slug,
    name,
    capacity,
    baseNightlyRate,
    currency,
    isActive,
    sortOrder,
    roomCount,
    updatedAt,
  };
}

/**
 * Rebuilds one room type in full.
 *
 * `requested` is checked against what came back: a response describing a
 * different room type cannot be interpreted, and showing it would tell an
 * administrator they were looking at — or had just edited — something they
 * were not.
 */
function toDetail(payload: unknown, requested: string): AdminRoomTypeDetail | null {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }

  const data = payload.data;
  const {
    slug,
    name,
    shortDescription,
    description,
    capacity,
    bedType,
    bedCount,
    sizeSqm,
    view,
    baseNightlyRate,
    currency,
    isActive,
    sortOrder,
    roomCount,
    createdAt,
    updatedAt,
  } = data;

  // Exact: the slug was sent untouched, so the answer must come back untouched
  // too. Anything else is a different room type.
  if (typeof slug !== "string" || slug !== requested || typeof name !== "string") {
    return null;
  }

  if (!isNullableText(shortDescription) || !isNullableText(description)) {
    return null;
  }

  if (!isNullableText(bedType) || !isNullableText(view)) {
    return null;
  }

  if (bedCount !== null && !isCount(bedCount, 1)) {
    return null;
  }

  // The column's CHECK requires a positive size, so a stored zero would be
  // data the schema says cannot exist.
  if (sizeSqm !== null && (!isDecimalString(sizeSqm, SIZE_SQM_PATTERN) || !HAS_NON_ZERO_DIGIT.test(sizeSqm))) {
    return null;
  }

  if (!isCount(capacity, 1) || !isCount(sortOrder, 0) || !isCount(roomCount, 0)) {
    return null;
  }

  if (!isDecimalString(baseNightlyRate, BASE_NIGHTLY_RATE_PATTERN) || currency !== "EGP" || typeof isActive !== "boolean") {
    return null;
  }

  if (!isInstant(createdAt) || !isInstant(updatedAt)) {
    return null;
  }

  return {
    slug,
    name,
    shortDescription,
    description,
    capacity,
    bedType,
    bedCount,
    sizeSqm,
    view,
    baseNightlyRate,
    currency,
    isActive,
    sortOrder,
    roomCount,
    createdAt,
    updatedAt,
  };
}

function toListPayload(payload: unknown): AdminRoomTypeListItem[] | null {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }

  const { roomTypes } = payload.data;

  if (!Array.isArray(roomTypes)) {
    return null;
  }

  const items: AdminRoomTypeListItem[] = [];

  for (const entry of roomTypes) {
    const item = toListItem(entry);

    // One bad row invalidates the list: silently dropping it would show a
    // shorter catalogue with no sign anything was missing.
    if (!item) {
      return null;
    }

    items.push(item);
  }

  return items;
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
 * Reads the whole room-type catalogue, active and inactive alike.
 *
 * The Cookie header is forwarded verbatim: this app never parses it, names the
 * session cookie, or decides whether it is valid — Express and PostgreSQL do.
 */
export async function fetchAdminRoomTypes(cookie?: string): Promise<AdminRoomTypeListResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  let response: Response;

  try {
    response = await fetch(`${resolved.baseUrl}${ADMIN_ROOM_TYPES_PATH}`, {
      method: "GET",
      headers: authHeaders(cookie),
      // The catalogue is editable; nothing here may be served from a snapshot.
      cache: "no-store",
    });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return await classifyUnauthenticated(response);
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: UNREADABLE_RESPONSE_REASON };
  }

  const data = toListPayload(payload);

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}

/**
 * Reads one room type by slug, including an archived one.
 *
 * The slug is passed through untouched — never trimmed, never lower-cased. The
 * API owns what a room-type slug is, and normalising one here would mean
 * asking about a value the caller never sent.
 */
export async function fetchAdminRoomType(
  slug: string,
  cookie?: string,
): Promise<AdminRoomTypeDetailResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  // Encoded as exactly one path segment: the slug is caller input, and a slash
  // or a query character in it must not become part of the URL's structure.
  const url = `${resolved.baseUrl}${ADMIN_ROOM_TYPES_PATH}/${encodeURIComponent(slug)}`;

  let response: Response;

  try {
    response = await fetch(url, { method: "GET", headers: authHeaders(cookie), cache: "no-store" });
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

  const data = toDetail(payload, slug);

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}

/**
 * Applies a partial update to one room type.
 *
 * The body is built here from the caller's typed update, not forwarded from an
 * arbitrary object, so nothing a caller happens to be holding can reach the
 * API. What is and is not editable remains the API's rule; this client only
 * carries the request.
 *
 * Never retried. A PATCH whose connection dropped may well have committed
 * first, so repeating it is the one thing this client must not do on its own.
 */
export async function updateAdminRoomType(
  slug: string,
  update: AdminRoomTypeUpdate,
  cookie?: string,
): Promise<AdminRoomTypeUpdateResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  const url = `${resolved.baseUrl}${ADMIN_ROOM_TYPES_PATH}/${encodeURIComponent(slug)}`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(cookie) },
      body: JSON.stringify(update),
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

  if (response.status === 400 || response.status === 404) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_ROOM_TYPE_SLUG_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_ROOM_TYPE_UPDATE_ERROR)) {
        return { state: "invalid-update" };
      }
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

  const data = toDetail(payload, slug);

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}

/**
 * Four outcomes for creating a room type. A refused body and a slug someone
 * already used are ordinary answers this endpoint gives; an unreachable API is
 * neither.
 */
export type AdminRoomTypeCreateResult =
  | { state: "ok"; data: AdminRoomTypeDetail }
  | { state: "unauthenticated" }
  | { state: "invalid-create" }
  | { state: "slug-taken" }
  | { state: "unavailable"; reason: string };

/**
 * Creates one room type, which the API always stores as an inactive draft.
 *
 * Exactly one HTTP request, and never retried. A POST whose connection dropped
 * may well have committed first, so repeating it could create a second room
 * type or turn a success into a confusing "reference already in use". The
 * caller is told the outcome is unknown instead.
 *
 * The body is built from the caller's typed value rather than forwarded from
 * an arbitrary object, so nothing a caller happens to be holding can reach the
 * API. What may be created remains the API's rule; this client only carries
 * the request, and never sends `isActive` — the type has no such field.
 */
export async function createAdminRoomType(
  create: AdminRoomTypeCreate,
  cookie?: string,
): Promise<AdminRoomTypeCreateResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  let response: Response;

  try {
    response = await fetch(`${resolved.baseUrl}${ADMIN_ROOM_TYPES_PATH}`, {
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

  // Status alone is not enough: each of these has a contracted body, and
  // anything else answering with the same number is not this contract.
  if (response.status === 400 || response.status === 409) {
    const payload = await readJson(response);

    if (response.status === 400 && matchesApiError(payload, INVALID_ROOM_TYPE_CREATE_ERROR)) {
      return { state: "invalid-create" };
    }

    if (response.status === 409 && matchesApiError(payload, ROOM_TYPE_SLUG_TAKEN_ERROR)) {
      return { state: "slug-taken" };
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

  const data = toDetail(payload, create.slug);

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}

/**
 * Six outcomes for a capacity change. A malformed slug, a malformed capacity
 * and a capacity that contradicts an upcoming stay are three different
 * answers, and a page that treats them alike would tell an administrator to
 * fix the wrong thing.
 */
export type AdminRoomTypeCapacityResult =
  | { state: "ok"; data: AdminRoomTypeDetail }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "invalid-capacity" }
  | { state: "not-found" }
  | { state: "capacity-conflict" }
  | { state: "unavailable"; reason: string };

/**
 * Changes one room type's capacity.
 *
 * Its own endpoint rather than a field of the general update, because it is
 * the one value that can be refused: lowering it below what an upcoming stay
 * already booked is a conflict, not a validation error.
 *
 * Exactly one HTTP request, and never retried — the same reasoning as every
 * other mutation here.
 *
 * The slug is passed through untouched, never trimmed or lower-cased.
 */
export async function updateAdminRoomTypeCapacity(
  slug: string,
  capacity: number,
  cookie?: string,
): Promise<AdminRoomTypeCapacityResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  // Encoded as exactly one path segment: the slug is caller input, and a slash
  // or a query character in it must not become part of the URL's structure.
  const url = `${resolved.baseUrl}${ADMIN_ROOM_TYPES_PATH}/${encodeURIComponent(slug)}/capacity`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(cookie) },
      body: JSON.stringify({ capacity }),
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
      if (matchesApiError(payload, INVALID_ROOM_TYPE_SLUG_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_ROOM_TYPE_CAPACITY_ERROR)) {
        return { state: "invalid-capacity" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, ROOM_TYPE_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    if (
      response.status === 409 &&
      matchesApiError(payload, ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS_ERROR)
    ) {
      return { state: "capacity-conflict" };
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

  const data = toDetail(payload, slug);

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}

/**
 * Six outcomes for a status change. A malformed slug, a malformed body and a
 * room type with nothing in service to allocate are three different answers,
 * and a page that treated them alike would tell an administrator to fix the
 * wrong thing.
 */
export type AdminRoomTypeStatusResult =
  | { state: "ok"; data: AdminRoomTypeDetail }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "invalid-status" }
  | { state: "not-found" }
  | { state: "no-active-rooms" }
  | { state: "unavailable"; reason: string };

/**
 * Publishes or unpublishes one room type.
 *
 * Its own endpoint rather than a field of the general update, because it is
 * an operation that can be refused: publishing a room type with no physical
 * room in service would put it on the website and make it unbookable in every
 * search, so the API says no.
 *
 * The body is exactly `{ isActive }`, a real boolean. Nothing is coerced here
 * and nothing else is sent — a status change must not be able to carry an
 * edit to anything else.
 *
 * Exactly one HTTP request, and never retried — the same reasoning as every
 * other mutation here. An answer that never arrives is `unavailable`, which
 * means unknown rather than failed.
 *
 * The slug is passed through untouched, never trimmed or lower-cased.
 */
export async function updateAdminRoomTypeStatus(
  slug: string,
  isActive: boolean,
  cookie?: string,
): Promise<AdminRoomTypeStatusResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  // Encoded as exactly one path segment: the slug is caller input, and a slash
  // or a query character in it must not become part of the URL's structure.
  const url = `${resolved.baseUrl}${ADMIN_ROOM_TYPES_PATH}/${encodeURIComponent(slug)}/status`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(cookie) },
      body: JSON.stringify({ isActive }),
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
      if (matchesApiError(payload, INVALID_ROOM_TYPE_SLUG_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_ROOM_TYPE_STATUS_ERROR)) {
        return { state: "invalid-status" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, ROOM_TYPE_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    if (response.status === 409 && matchesApiError(payload, ROOM_TYPE_NO_ACTIVE_ROOMS_ERROR)) {
      return { state: "no-active-rooms" };
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

  // Checked against the slug that was asked for, like every other mutation
  // here: a response describing a different room type cannot be interpreted.
  const data = toDetail(payload, slug);

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}
