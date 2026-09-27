import "server-only";

import { ApiConfigurationError, resolveApiBaseUrl } from "@/shared/server/apiBaseUrl";
import type { AdminPackageImage } from "../types";

// Server-only client for a journey's one image.
//
// The import above is the boundary: importing this module from client code
// fails the build, so the API address never reaches the browser bundle and
// no request to Cloudflare, R2 or any storage host is ever made from a
// page. The bytes go to Express, which owns everything about storage.
//
// It holds no state and decides nothing: it forwards the caller's Cookie
// header and reports what the API said. What each answer *means* — which
// notice, whether to re-read the journey — lives in
// `lib/packageImageOutcomes.ts`, which is pure and tested directly.
//
// Separate from `adminPackagesApi.ts` for the same reason
// `adminRoomTypeImagesApi.ts` is separate from `adminRoomTypesApi.ts`:
// uploads speak raw bytes rather than JSON, and the catalogue client is
// already long.

const ADMIN_PACKAGES_PATH = "/api/v1/admin/packages";

const MISCONFIGURED_REASON = "The hotel system is not configured correctly.";
const UNREACHABLE_REASON = "The hotel API could not be reached.";

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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// The API's locked error bodies, matched exactly. A right status with a
// wrong body is something other than this contract answering, and is never
// reported as a decision about this journey.
const INVALID_PACKAGE_SLUG_ERROR = {
  code: "INVALID_PACKAGE_SLUG",
  message: "Invalid package slug",
} as const;

const PACKAGE_NOT_FOUND_ERROR = {
  code: "PACKAGE_NOT_FOUND",
  message: "Package not found",
} as const;

const JOURNEY_IMAGE_EXISTS_ERROR = {
  code: "JOURNEY_IMAGE_EXISTS",
  message: "This journey already has an image",
} as const;

const JOURNEY_IMAGE_NOT_FOUND_ERROR = {
  code: "JOURNEY_IMAGE_NOT_FOUND",
  message: "This journey has no image",
} as const;

const INVALID_JOURNEY_IMAGE_UPDATE_ERROR = {
  code: "INVALID_JOURNEY_IMAGE_UPDATE",
  message: "Invalid journey image update",
} as const;

const IMAGE_TOO_LARGE_ERROR = {
  code: "IMAGE_TOO_LARGE",
  message: "Image exceeds the maximum upload size",
} as const;

const UNSUPPORTED_IMAGE_TYPE_ERROR = {
  code: "UNSUPPORTED_IMAGE_TYPE",
  message: "Unsupported image type",
} as const;

const INVALID_IMAGE_UPLOAD_ERROR = {
  code: "INVALID_IMAGE_UPLOAD",
  message: "Invalid image upload",
} as const;

const MEDIA_STORAGE_UNAVAILABLE_ERROR = {
  code: "MEDIA_STORAGE_UNAVAILABLE",
  message: "Media storage is temporarily unavailable",
} as const;

const MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_ERROR = {
  code: "MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN",
  message: "The operation outcome could not be confirmed. Refresh the current state before retrying.",
} as const;

const MEDIA_OPERATION_FAILED_ERROR = {
  code: "MEDIA_OPERATION_FAILED",
  message: "The operation could not be completed",
} as const;

/**
 * One journey image as the admin API returns it.
 *
 * Five fields and no more. There is deliberately no branch here that could
 * read a storage key, a checksum, a content type, a byte size or a database
 * id: the API does not send them, and this mapper would refuse a body that
 * was missing what it does need rather than pass along what it does not.
 */
function toImage(payload: unknown): AdminPackageImage | null {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }

  const data = payload.data;

  if (typeof data.reference !== "string" || data.reference.length === 0) return null;
  if (typeof data.url !== "string" || data.url.length === 0) return null;
  if (data.altText !== null && typeof data.altText !== "string") return null;
  if (typeof data.width !== "number" || !Number.isInteger(data.width) || data.width <= 0) return null;
  if (typeof data.height !== "number" || !Number.isInteger(data.height) || data.height <= 0) return null;

  return {
    reference: data.reference,
    url: data.url,
    altText: data.altText,
    width: data.width,
    height: data.height,
  };
}

/**
 * The bytes a browser chose, ready to become a request body.
 *
 * `contentType` is whatever the browser reported for the file, carried
 * through exactly: the API owns what counts as an accepted declaration, and
 * repairing it here would mean a local guess disagreeing with the one rule
 * that matters. The filename is deliberately absent — it is not media
 * identity and never reaches the API.
 */
export type AdminPackageImageUploadInput = {
  body: Buffer;
  contentType: string;
};

/** Every answer a journey-image write can produce, in this client's terms. */
export type AdminPackageImageWriteState =
  | "ok"
  | "unauthenticated"
  | "invalid-reference"
  | "not-found"
  | "image-exists"
  | "image-not-found"
  | "invalid-image"
  | "invalid-update"
  | "unsupported-type"
  | "too-large"
  | "storage-unavailable"
  | "outcome-uncertain"
  | "operation-failed"
  | "unavailable";

export type AdminPackageImageResult =
  | { state: "ok"; image: AdminPackageImage }
  | { state: Exclude<AdminPackageImageWriteState, "ok" | "unavailable"> }
  | { state: "unavailable"; reason: string };

export type AdminPackageImageDeleteResult =
  | { state: "ok" }
  | { state: Exclude<AdminPackageImageWriteState, "ok" | "unavailable"> }
  | { state: "unavailable"; reason: string };

function imagePath(slug: string): string {
  return `${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}/image`;
}

type Resolved = { ok: true; baseUrl: string } | { ok: false; reason: string };

function resolveBaseUrl(): Resolved {
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
  return cookie ? { Cookie: cookie } : {};
}

/**
 * Classifies every failure body the three image endpoints share.
 *
 * Returns `null` when the status/body pair is not one this contract
 * describes, which the callers report as `unavailable` rather than as a
 * decision about the journey.
 */
async function classifyFailure(
  response: Response,
): Promise<Exclude<AdminPackageImageWriteState, "ok" | "unavailable"> | null> {
  if (response.status === 401) {
    return "unauthenticated";
  }

  const payload = await readJson(response);

  switch (response.status) {
    case 400:
      if (matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)) return "invalid-reference";
      if (matchesApiError(payload, INVALID_IMAGE_UPLOAD_ERROR)) return "invalid-image";
      if (matchesApiError(payload, INVALID_JOURNEY_IMAGE_UPDATE_ERROR)) return "invalid-update";
      return null;

    case 404:
      if (matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) return "not-found";
      if (matchesApiError(payload, JOURNEY_IMAGE_NOT_FOUND_ERROR)) return "image-not-found";
      return null;

    case 409:
      return matchesApiError(payload, JOURNEY_IMAGE_EXISTS_ERROR) ? "image-exists" : null;

    case 413:
      return matchesApiError(payload, IMAGE_TOO_LARGE_ERROR) ? "too-large" : null;

    case 415:
      return matchesApiError(payload, UNSUPPORTED_IMAGE_TYPE_ERROR) ? "unsupported-type" : null;

    case 500:
      return matchesApiError(payload, MEDIA_OPERATION_FAILED_ERROR) ? "operation-failed" : null;

    case 503:
      if (matchesApiError(payload, MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_ERROR)) {
        return "outcome-uncertain";
      }
      if (matchesApiError(payload, MEDIA_STORAGE_UNAVAILABLE_ERROR)) return "storage-unavailable";
      return null;

    default:
      return null;
  }
}

/**
 * Sends one journey image, as the raw bytes the browser chose.
 *
 * `Content-Type` is the file's own type and the body is the file's own
 * bytes. Deliberately NOT multipart, not base64 and not JSON: the API reads
 * the body as an image directly, and any wrapper would have to be unwrapped
 * by something, which is a second place the upload could be misread.
 *
 * `POST` adds the one image a journey does not have; `PUT` replaces the one
 * it does. The API refuses the wrong one rather than guessing, which is what
 * makes a stale page a clear conflict instead of a silent overwrite.
 */
async function sendImage(
  method: "POST" | "PUT",
  slug: string,
  input: AdminPackageImageUploadInput,
  cookie?: string,
): Promise<AdminPackageImageResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  let response: Response;

  try {
    response = await fetch(`${resolved.baseUrl}${imagePath(slug)}`, {
      method,
      headers: { "Content-Type": input.contentType, ...authHeaders(cookie) },
      body: input.body as BodyInit,
      cache: "no-store",
    });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.ok) {
    const image = toImage(await readJson(response));

    return image
      ? { state: "ok", image }
      : { state: "unavailable", reason: "The hotel API returned an unusable response." };
  }

  const failure = await classifyFailure(response);

  return failure
    ? { state: failure }
    : { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
}

export async function uploadAdminPackageImage(
  slug: string,
  input: AdminPackageImageUploadInput,
  cookie?: string,
): Promise<AdminPackageImageResult> {
  return sendImage("POST", slug, input, cookie);
}

export async function replaceAdminPackageImage(
  slug: string,
  input: AdminPackageImageUploadInput,
  cookie?: string,
): Promise<AdminPackageImageResult> {
  return sendImage("PUT", slug, input, cookie);
}

/** Removes a journey's image. 204 and no body on success. */
export async function deleteAdminPackageImage(
  slug: string,
  cookie?: string,
): Promise<AdminPackageImageDeleteResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  let response: Response;

  try {
    response = await fetch(`${resolved.baseUrl}${imagePath(slug)}`, {
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

  const failure = await classifyFailure(response);

  return failure
    ? { state: failure }
    : { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
}

/**
 * Replaces the image's description.
 *
 * The body carries exactly one field. `null` clears the description; a
 * string is normalized by the API, which trims it and turns anything empty
 * into `null` — so what comes back is the value to display, never what was
 * typed.
 */
export async function updateAdminPackageImageAltText(
  slug: string,
  altText: string | null,
  cookie?: string,
): Promise<AdminPackageImageResult> {
  const resolved = resolveBaseUrl();

  if (!resolved.ok) {
    return { state: "unavailable", reason: resolved.reason };
  }

  let response: Response;

  try {
    response = await fetch(`${resolved.baseUrl}${imagePath(slug)}/alt-text`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(cookie) },
      body: JSON.stringify({ altText }),
      cache: "no-store",
    });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.ok) {
    const image = toImage(await readJson(response));

    return image
      ? { state: "ok", image }
      : { state: "unavailable", reason: "The hotel API returned an unusable response." };
  }

  const failure = await classifyFailure(response);

  return failure
    ? { state: failure }
    : { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
}
