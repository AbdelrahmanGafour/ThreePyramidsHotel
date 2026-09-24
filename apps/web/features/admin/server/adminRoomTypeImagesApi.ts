import "server-only";

import { ApiConfigurationError, resolveApiBaseUrl } from "@/shared/server/apiBaseUrl";
import type { AdminRoomTypeImage } from "../types";

// Server-only client for the hotel API's admin room-type media endpoints.
//
// The import above is the boundary: importing this module from client code
// fails the build, so the API address never reaches the browser bundle. It
// talks to Express directly and never to this app's own route handlers.
//
// Its own module, mirroring the API's own split — `admin-room-type-media` is a
// separate feature from `admin-room-types` and `admin-rooms`, with a different
// identifier (a media reference, not a slug or a room number) and a transport
// the other two never use: one operation here sends raw image bytes, not
// JSON.
//
// It holds no state and decides nothing beyond classifying what the API said.
// Nothing is logged — not the cookie, not a response body, not the configured
// API address, and not an uploaded image's bytes.
//
// This client never fetches an image's own `url`. That field is data to carry
// to a page, never something this module reads, and doing so would also be
// the one way a server-only module here could end up needing to know
// anything about R2, a bucket or a credential — which it must not.

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

const ROOM_TYPE_NOT_FOUND_ERROR = {
  code: "ROOM_TYPE_NOT_FOUND",
  message: "Room type not found",
} as const;

const INVALID_ROOM_TYPE_IMAGE_REFERENCE_ERROR = {
  code: "INVALID_ROOM_TYPE_IMAGE_REFERENCE",
  message: "Invalid room type image reference",
} as const;

const ROOM_TYPE_IMAGE_NOT_FOUND_ERROR = {
  code: "ROOM_TYPE_IMAGE_NOT_FOUND",
  message: "Room type image not found",
} as const;

const INVALID_ROOM_TYPE_IMAGE_UPDATE_ERROR = {
  code: "INVALID_ROOM_TYPE_IMAGE_UPDATE",
  message: "Invalid room type image update",
} as const;

const INVALID_IMAGE_UPLOAD_ERROR = {
  code: "INVALID_IMAGE_UPLOAD",
  message: "Invalid image upload",
} as const;

const UNSUPPORTED_IMAGE_TYPE_ERROR = {
  code: "UNSUPPORTED_IMAGE_TYPE",
  message: "Unsupported image type",
} as const;

const IMAGE_TOO_LARGE_ERROR = {
  code: "IMAGE_TOO_LARGE",
  message: "Image exceeds the maximum upload size",
} as const;

const ROOM_TYPE_IMAGE_LIMIT_REACHED_ERROR = {
  code: "ROOM_TYPE_IMAGE_LIMIT_REACHED",
  message: "Room type has reached its image limit",
} as const;

const MEDIA_STORAGE_UNAVAILABLE_ERROR = {
  code: "MEDIA_STORAGE_UNAVAILABLE",
  message: "Media storage is temporarily unavailable",
} as const;

const MEDIA_DELIVERY_UNAVAILABLE_ERROR = {
  code: "MEDIA_DELIVERY_UNAVAILABLE",
  message: "Media delivery is temporarily unavailable.",
} as const;

/**
 * The locked wording for an uncertain COMMIT, reproduced verbatim from the
 * API's own contract. Never paraphrased: a future page decides what an
 * administrator is told, but the exact body this client matches against must
 * stay byte-for-byte the API's own, or a genuine uncertain outcome would fall
 * through to a generic `unavailable`.
 */
const MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_ERROR = {
  code: "MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN",
  message: "The operation outcome could not be confirmed. Refresh the current state before retrying.",
} as const;

const MEDIA_OPERATION_FAILED_ERROR = {
  code: "MEDIA_OPERATION_FAILED",
  message: "The operation could not be completed",
} as const;

// The ways this client can fail before the API answers. A wrong or missing
// API address is a deployment fault, not an outage, and saying "could not be
// reached" about it would send someone to check a network that is fine.
// Neither carries the configured value or a hostname.
const MISCONFIGURED_REASON = "The hotel system is not configured correctly.";
const UNREACHABLE_REASON = "The hotel API could not be reached.";
const UNREADABLE_RESPONSE_REASON = "The hotel API returned an unreadable response.";
const UNEXPECTED_RESPONSE_REASON = "The hotel API returned an unexpected room-type-image response.";

/** The one direction an image may move, exactly as the API accepts it. */
export type MediaOrderDirection = "up" | "down";

/** What one upload sends. `contentType` travels to the API exactly as given — never normalised. */
export type AdminRoomTypeImageUploadInput = {
  body: Buffer;
  contentType: string;
};

export type AdminRoomTypeImageListResult =
  | { state: "ok"; data: AdminRoomTypeImage[] }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "not-found" }
  | { state: "delivery-unavailable" }
  | { state: "unavailable"; reason: string };

/**
 * Every outcome an upload can answer with. `outcome-uncertain` is kept
 * distinct from every other refusal on purpose — nothing may collapse it into
 * a generic failure, because it is the one answer that must never be retried
 * automatically and must never be reported as "the upload failed".
 */
export type AdminRoomTypeImageUploadResult =
  | { state: "ok"; data: AdminRoomTypeImage }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "not-found" }
  | { state: "invalid-image" }
  | { state: "unsupported-type" }
  | { state: "too-large" }
  | { state: "limit-reached" }
  | { state: "storage-unavailable" }
  | { state: "delivery-unavailable" }
  | { state: "outcome-uncertain" }
  | { state: "operation-failed" }
  | { state: "unavailable"; reason: string };

export type AdminRoomTypeImageAltTextResult =
  | { state: "ok" }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "invalid-image-reference" }
  | { state: "not-found" }
  | { state: "image-not-found" }
  | { state: "invalid-update" }
  | { state: "outcome-uncertain" }
  | { state: "unavailable"; reason: string };

export type AdminRoomTypeImageCoverResult =
  | { state: "ok" }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "invalid-image-reference" }
  | { state: "not-found" }
  | { state: "image-not-found" }
  | { state: "outcome-uncertain" }
  | { state: "unavailable"; reason: string };

/**
 * `ok` covers both a real move and a boundary no-op: the API answers both
 * with the identical 204, so this client has no way to tell them apart and
 * must not invent one.
 */
export type AdminRoomTypeImageMoveResult =
  | { state: "ok" }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "invalid-image-reference" }
  | { state: "not-found" }
  | { state: "image-not-found" }
  | { state: "invalid-direction" }
  | { state: "outcome-uncertain" }
  | { state: "unavailable"; reason: string };

/**
 * `ok` is the whole of what a successful delete reports. Whether the object
 * came off storage afterward is internal, orphan-reconciliation state the API
 * itself does not expose to this contract — a 204 is a 204 regardless — and
 * this client must not invent a field for it.
 */
export type AdminRoomTypeImageDeleteResult =
  | { state: "ok" }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "invalid-image-reference" }
  | { state: "not-found" }
  | { state: "image-not-found" }
  | { state: "outcome-uncertain" }
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
 * The canonical ISO instant the API produces: `YYYY-MM-DDTHH:mm:ss.sssZ`.
 *
 * The round trip is the contract. `Date` parses far more than the API ever
 * sends, and merely parsing proves only that JavaScript coped. Re-serialising
 * and demanding the same string admits only what `toISOString()` itself
 * produces.
 */
function isInstant(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.toISOString() === value;
}

/**
 * A URL this app may hand to `next/image`: absolute, `https:`, no embedded
 * credentials.
 *
 * Deliberately does not check the hostname against `MEDIA_PUBLIC_BASE_URL`.
 * The API is the one source of truth for where one image actually lives;
 * `MEDIA_PUBLIC_BASE_URL` only tells `next/image` which remote origin it may
 * optimize, at build time, in a different file. Coupling this parser to that
 * build-time value would mix a runtime data contract with a build
 * configuration concern that happens to describe the same kind of thing.
 */
function isPublicImageUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return url.protocol === "https:" && url.username === "" && url.password === "";
}

/**
 * Rebuilds one image from the payload, field by field.
 *
 * Nothing is spread through: a response is data from another process, and
 * only the fields this app has a use for are carried across — so a
 * `storageKey`, a `checksumSha256` or an internal id the API should never send
 * could not reach a page even if it somehow did. Anything missing, mistyped or
 * unexpected returns null, which the caller reports as an outage rather than
 * rendering half an image.
 */
function toImage(value: unknown): AdminRoomTypeImage | null {
  if (!isRecord(value)) {
    return null;
  }

  const { reference, url, contentType, byteSize, width, height, altText, sortOrder, isCover, createdAt, updatedAt } =
    value;

  if (typeof reference !== "string" || reference.length === 0) {
    return null;
  }

  if (!isPublicImageUrl(url)) {
    return null;
  }

  if (contentType !== "image/webp") {
    return null;
  }

  if (!isCount(byteSize, 0) || !isCount(width, 1) || !isCount(height, 1) || !isCount(sortOrder, 0)) {
    return null;
  }

  if (altText !== null && typeof altText !== "string") {
    return null;
  }

  if (typeof isCover !== "boolean") {
    return null;
  }

  if (!isInstant(createdAt) || !isInstant(updatedAt)) {
    return null;
  }

  return { reference, url, contentType, byteSize, width, height, altText, sortOrder, isCover, createdAt, updatedAt };
}

function toImageListPayload(payload: unknown): AdminRoomTypeImage[] | null {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }

  const { images } = payload.data;

  if (!Array.isArray(images)) {
    return null;
  }

  const items: AdminRoomTypeImage[] = [];

  for (const entry of images) {
    const image = toImage(entry);

    // One bad row invalidates the list: silently dropping it would show a
    // shorter gallery than the room type actually has, with no sign anything
    // was missing.
    if (!image) {
      return null;
    }

    items.push(image);
  }

  return items;
}

function toImagePayload(payload: unknown): AdminRoomTypeImage | null {
  if (!isRecord(payload)) {
    return null;
  }

  return toImage(payload.data);
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

function imagesPath(slug: string): string {
  // Encoded as exactly one path segment: the slug is caller input, and a
  // slash or a query character in it must not become part of the URL's
  // structure.
  return `${ADMIN_ROOM_TYPES_PATH}/${encodeURIComponent(slug)}/images`;
}

function imagePath(slug: string, imageReference: string): string {
  return `${imagesPath(slug)}/${encodeURIComponent(imageReference)}`;
}

/**
 * Classifies a 401 by its body, not by its status alone.
 *
 * Only the admin guard's own refusal means "your session is not valid". A 401
 * from anything else in front of the API carries a different body, and
 * reading it as a signed-out administrator would send someone to log in again
 * over a problem logging in cannot fix.
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
 * The one 503 body that must never be told apart from a plain failure: it is
 * shared verbatim by upload, alt-text, cover, order and delete, and always
 * means the same thing regardless of which operation produced it.
 */
function isOutcomeUncertain(payload: unknown): boolean {
  return matchesApiError(payload, MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_ERROR);
}

/**
 * Every image of one room type.
 *
 * The Cookie header is forwarded verbatim: this app never parses it, names
 * the session cookie, or decides whether it is valid — Express and PostgreSQL
 * do. `MEDIA_DELIVERY_UNAVAILABLE` is kept distinct from a generic outage: the
 * gallery could not be shown with working image URLs, which is a different
 * fact from the API being unreachable.
 */
export async function fetchAdminRoomTypeImages(
  slug: string,
  cookie?: string,
): Promise<AdminRoomTypeImageListResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  let response: Response;

  try {
    response = await fetch(`${resolved.baseUrl}${imagesPath(slug)}`, {
      method: "GET",
      headers: authHeaders(cookie),
      // A gallery is editable; nothing here may be served from a snapshot.
      cache: "no-store",
    });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return await classifyUnauthenticated(response);
  }

  if (response.status === 400 || response.status === 404 || response.status === 503) {
    const payload = await readJson(response);

    if (response.status === 400 && matchesApiError(payload, INVALID_ROOM_TYPE_SLUG_ERROR)) {
      return { state: "invalid-reference" };
    }

    if (response.status === 404 && matchesApiError(payload, ROOM_TYPE_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    if (response.status === 503 && matchesApiError(payload, MEDIA_DELIVERY_UNAVAILABLE_ERROR)) {
      return { state: "delivery-unavailable" };
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

  const data = toImageListPayload(payload);

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}

/**
 * Uploads one image for a room type.
 *
 * This is the one operation on this client that is not JSON. `input.body` is
 * sent exactly as given — never `JSON.stringify`d, never base64-encoded,
 * never wrapped in `multipart/form-data` or a browser `FormData` toward
 * Express, which only ever receives raw bytes for this route. `input
 * .contentType` becomes the request's `Content-Type` exactly as provided: not
 * lower-cased, not trimmed, not corrected. The domain rule on the other side
 * owns what counts as an accepted type, not this client.
 *
 * Exactly one HTTP request, and never retried — including when the answer is
 * `outcome-uncertain`. A PUT to storage may have already committed a database
 * row by the time this client learns anything went wrong with the connection,
 * so retrying could create a second image; the caller is told the outcome is
 * unknown instead, and must not turn that into an automatic second attempt.
 */
export async function uploadAdminRoomTypeImage(
  slug: string,
  input: AdminRoomTypeImageUploadInput,
  cookie?: string,
): Promise<AdminRoomTypeImageUploadResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  let response: Response;

  try {
    response = await fetch(`${resolved.baseUrl}${imagesPath(slug)}`, {
      method: "POST",
      headers: { "Content-Type": input.contentType, ...authHeaders(cookie) },
      body: input.body as BodyInit,
      cache: "no-store",
    });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return await classifyUnauthenticated(response);
  }

  if (
    response.status === 400 ||
    response.status === 404 ||
    response.status === 409 ||
    response.status === 413 ||
    response.status === 415 ||
    response.status === 500 ||
    response.status === 503
  ) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_ROOM_TYPE_SLUG_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_IMAGE_UPLOAD_ERROR)) {
        return { state: "invalid-image" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, ROOM_TYPE_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    if (response.status === 409 && matchesApiError(payload, ROOM_TYPE_IMAGE_LIMIT_REACHED_ERROR)) {
      return { state: "limit-reached" };
    }

    if (response.status === 413 && matchesApiError(payload, IMAGE_TOO_LARGE_ERROR)) {
      return { state: "too-large" };
    }

    if (response.status === 415 && matchesApiError(payload, UNSUPPORTED_IMAGE_TYPE_ERROR)) {
      return { state: "unsupported-type" };
    }

    if (response.status === 500 && matchesApiError(payload, MEDIA_OPERATION_FAILED_ERROR)) {
      return { state: "operation-failed" };
    }

    if (response.status === 503) {
      if (isOutcomeUncertain(payload)) {
        return { state: "outcome-uncertain" };
      }
      if (matchesApiError(payload, MEDIA_STORAGE_UNAVAILABLE_ERROR)) {
        return { state: "storage-unavailable" };
      }
      if (matchesApiError(payload, MEDIA_DELIVERY_UNAVAILABLE_ERROR)) {
        return { state: "delivery-unavailable" };
      }
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (response.status !== 201) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: UNREADABLE_RESPONSE_REASON };
  }

  const data = toImagePayload(payload);

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}

/**
 * Replaces one image's alt text.
 *
 * `altText` is sent exactly as given, as the request's only field — this
 * client normalises nothing; the API's own rule (trim, whitespace-only
 * becomes null, a 240-character ceiling) is authoritative.
 *
 * A 204 answers with no body, and none is read: parsing one that is not there
 * would turn a correct response into a manufactured `unavailable`.
 */
export async function updateAdminRoomTypeImageAltText(
  slug: string,
  imageReference: string,
  altText: string | null,
  cookie?: string,
): Promise<AdminRoomTypeImageAltTextResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  let response: Response;

  try {
    response = await fetch(`${resolved.baseUrl}${imagePath(slug, imageReference)}/alt-text`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(cookie) },
      body: JSON.stringify({ altText }),
      cache: "no-store",
    });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 204) {
    return { state: "ok" };
  }

  if (response.status === 401) {
    return await classifyUnauthenticated(response);
  }

  if (response.status === 400 || response.status === 404 || response.status === 503) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_ROOM_TYPE_SLUG_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_ROOM_TYPE_IMAGE_REFERENCE_ERROR)) {
        return { state: "invalid-image-reference" };
      }
      if (matchesApiError(payload, INVALID_ROOM_TYPE_IMAGE_UPDATE_ERROR)) {
        return { state: "invalid-update" };
      }
    }

    if (response.status === 404) {
      if (matchesApiError(payload, ROOM_TYPE_NOT_FOUND_ERROR)) {
        return { state: "not-found" };
      }
      if (matchesApiError(payload, ROOM_TYPE_IMAGE_NOT_FOUND_ERROR)) {
        return { state: "image-not-found" };
      }
    }

    if (response.status === 503 && isOutcomeUncertain(payload)) {
      return { state: "outcome-uncertain" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
}

/**
 * Makes one image the room type's cover.
 *
 * The route names the action, so no body is sent at all — not `{}`, not
 * `{"isCover": true}` — and no `Content-Type` header is set, because there is
 * no JSON body for one to describe. Selecting the image that is already the
 * cover still answers 204: an administrator asking for something already true
 * has not made a mistake, and this client reports it identically to any other
 * successful selection.
 */
export async function setAdminRoomTypeImageCover(
  slug: string,
  imageReference: string,
  cookie?: string,
): Promise<AdminRoomTypeImageCoverResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  let response: Response;

  try {
    response = await fetch(`${resolved.baseUrl}${imagePath(slug, imageReference)}/cover`, {
      method: "PATCH",
      headers: authHeaders(cookie),
      cache: "no-store",
    });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 204) {
    return { state: "ok" };
  }

  if (response.status === 401) {
    return await classifyUnauthenticated(response);
  }

  if (response.status === 400 || response.status === 404 || response.status === 503) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_ROOM_TYPE_SLUG_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_ROOM_TYPE_IMAGE_REFERENCE_ERROR)) {
        return { state: "invalid-image-reference" };
      }
    }

    if (response.status === 404) {
      if (matchesApiError(payload, ROOM_TYPE_NOT_FOUND_ERROR)) {
        return { state: "not-found" };
      }
      if (matchesApiError(payload, ROOM_TYPE_IMAGE_NOT_FOUND_ERROR)) {
        return { state: "image-not-found" };
      }
    }

    if (response.status === 503 && isOutcomeUncertain(payload)) {
      return { state: "outcome-uncertain" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
}

/**
 * Moves one image one step through its gallery.
 *
 * `direction` is sent exactly as given, as the request's only field — never
 * trimmed, never re-cased. The public contract is a direction, never a
 * submitted position: there is no `sortOrder` field this client can send.
 *
 * A move and a boundary no-op are both a 204 from the API, and this client has
 * no way — and no need — to tell them apart; `ok` covers both.
 */
export async function moveAdminRoomTypeImage(
  slug: string,
  imageReference: string,
  direction: MediaOrderDirection,
  cookie?: string,
): Promise<AdminRoomTypeImageMoveResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  let response: Response;

  try {
    response = await fetch(`${resolved.baseUrl}${imagePath(slug, imageReference)}/order`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(cookie) },
      body: JSON.stringify({ direction }),
      cache: "no-store",
    });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 204) {
    return { state: "ok" };
  }

  if (response.status === 401) {
    return await classifyUnauthenticated(response);
  }

  if (response.status === 400 || response.status === 404 || response.status === 503) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_ROOM_TYPE_SLUG_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_ROOM_TYPE_IMAGE_REFERENCE_ERROR)) {
        return { state: "invalid-image-reference" };
      }
      if (matchesApiError(payload, INVALID_ROOM_TYPE_IMAGE_UPDATE_ERROR)) {
        return { state: "invalid-direction" };
      }
    }

    if (response.status === 404) {
      if (matchesApiError(payload, ROOM_TYPE_NOT_FOUND_ERROR)) {
        return { state: "not-found" };
      }
      if (matchesApiError(payload, ROOM_TYPE_IMAGE_NOT_FOUND_ERROR)) {
        return { state: "image-not-found" };
      }
    }

    if (response.status === 503 && isOutcomeUncertain(payload)) {
      return { state: "outcome-uncertain" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
}

/**
 * Removes one image from a room type.
 *
 * No request body. A 204 means the database rows are gone — full stop. Any
 * later, best-effort object cleanup in storage is internal state the API does
 * not expose to this contract, and this client invents no field to guess at
 * it: `ok` is the whole answer, exactly as the API's own doctrine holds that a
 * definite DB deletion stays a success whatever storage cleanup did.
 */
export async function deleteAdminRoomTypeImage(
  slug: string,
  imageReference: string,
  cookie?: string,
): Promise<AdminRoomTypeImageDeleteResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  let response: Response;

  try {
    response = await fetch(`${resolved.baseUrl}${imagePath(slug, imageReference)}`, {
      method: "DELETE",
      headers: authHeaders(cookie),
      cache: "no-store",
    });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 204) {
    return { state: "ok" };
  }

  if (response.status === 401) {
    return await classifyUnauthenticated(response);
  }

  if (response.status === 400 || response.status === 404 || response.status === 503) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_ROOM_TYPE_SLUG_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_ROOM_TYPE_IMAGE_REFERENCE_ERROR)) {
        return { state: "invalid-image-reference" };
      }
    }

    if (response.status === 404) {
      if (matchesApiError(payload, ROOM_TYPE_NOT_FOUND_ERROR)) {
        return { state: "not-found" };
      }
      if (matchesApiError(payload, ROOM_TYPE_IMAGE_NOT_FOUND_ERROR)) {
        return { state: "image-not-found" };
      }
    }

    if (response.status === 503 && isOutcomeUncertain(payload)) {
      return { state: "outcome-uncertain" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
}
