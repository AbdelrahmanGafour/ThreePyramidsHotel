// Server Component room-domain API module (WFI-T03 Phase 5A).
//
// Calls the existing shared server transport (apps/web/lib/api/proxy.ts) —
// the same generic Next -> Express transport the WFI-T02 bridge routes use —
// in-process, never the browser-facing Route Handlers, never a second
// transport layer, never a hardcoded origin. This module owns exactly one
// responsibility: turn a generic ProxyResult into validated, UI-safe room
// data. It must never read business facts from the legacy
// features/rooms/data/roomsData.ts `rooms` array — only its presentation-only
// `roomPresentationBySlug` lookup.
//
// baseNightlyRate is preserved as the backend's exact decimal string
// throughout — never converted to a JavaScript number as a source of truth
// (see features/rooms/types.ts and features/rooms/lib/money.ts).

import { forwardToExpress } from "@/lib/api/proxy";
import { roomPresentationBySlug, type RoomPresentation } from "./data/roomsData";
import type { RoomDetailResponseBody, RoomDisplay, RoomListResponseBody } from "./types";

const ROOM_NOT_FOUND_CODE = "ROOM_NOT_FOUND";

// Shape check only (optional sign, digits, optional up-to-2-decimal
// fraction) — matches the backend's own money-string pattern
// (apps/api/src/modules/reservations/reservations.service.ts). Never used to
// parse baseNightlyRate into a number; sizeSqm is parsed because it is not
// money.
const DECIMAL_STRING_PATTERN = /^-?\d+(?:\.\d{1,2})?$/;

export type RoomWithPresentation = RoomDisplay & RoomPresentation;

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseFiniteNumber(field: string, value: string, slug: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Room API returned a non-numeric ${field} for slug "${String(slug)}": "${value}"`);
  }
  return parsed;
}

/**
 * Validates one raw API room object and narrows it into the display shape.
 * Fails explicitly on any unexpected primitive/null type rather than
 * silently coercing malformed data — a malformed response is a real problem
 * to surface, never something to paper over (per WFI-T03 Phase 5A).
 */
function toRoomDisplay(value: unknown): RoomDisplay {
  if (typeof value !== "object" || value === null) {
    throw new Error("Room API returned a non-object room");
  }

  const room = value as Record<string, unknown>;
  const slug = room.slug;

  if (typeof room.slug !== "string") {
    throw new Error("Room API response is missing a string slug");
  }
  if (typeof room.name !== "string") {
    throw new Error(`Room API response is missing a string name for slug "${String(slug)}"`);
  }
  if (!isStringOrNull(room.shortDescription)) {
    throw new Error(`Room API response has an invalid shortDescription for slug "${String(slug)}"`);
  }
  if (!isStringOrNull(room.description)) {
    throw new Error(`Room API response has an invalid description for slug "${String(slug)}"`);
  }
  // capacity/bedCount are plain counts, not money — finite-number checks are
  // trivial here and worth doing; this is not the numeric-money conversion
  // this module must avoid for baseNightlyRate below.
  if (typeof room.capacity !== "number" || !Number.isFinite(room.capacity)) {
    throw new Error(`Room API response has a non-finite capacity for slug "${String(slug)}"`);
  }
  if (!isStringOrNull(room.bedType)) {
    throw new Error(`Room API response has an invalid bedType for slug "${String(slug)}"`);
  }
  if (room.bedCount !== null && (typeof room.bedCount !== "number" || !Number.isFinite(room.bedCount))) {
    throw new Error(`Room API response has a non-finite bedCount for slug "${String(slug)}"`);
  }
  if (!isStringOrNull(room.sizeSqm)) {
    throw new Error(`Room API response has an invalid sizeSqm for slug "${String(slug)}"`);
  }
  if (typeof room.baseNightlyRate !== "string") {
    throw new Error(`Room API response is missing a string baseNightlyRate for slug "${String(slug)}"`);
  }
  // Validated for shape only — a decimal-string check, never parsed into a
  // number here. baseNightlyRate is preserved exactly as the backend
  // returned it; this module must never recreate or normalize money via
  // floating-point arithmetic.
  if (!DECIMAL_STRING_PATTERN.test(room.baseNightlyRate)) {
    throw new Error(`Room API response has a malformed baseNightlyRate for slug "${String(slug)}": "${room.baseNightlyRate}"`);
  }
  if (!isStringOrNull(room.view)) {
    throw new Error(`Room API response has an invalid view for slug "${String(slug)}"`);
  }
  if (room.currency !== "EGP") {
    throw new Error(`Room API response has an unexpected currency for slug "${String(slug)}": ${String(room.currency)}`);
  }

  // sizeSqm is a size, not money — safe to parse to a finite number.
  const sizeSqm = room.sizeSqm === null ? null : parseFiniteNumber("sizeSqm", room.sizeSqm, slug);

  return {
    slug: room.slug,
    name: room.name,
    shortDescription: room.shortDescription as string | null,
    description: room.description as string | null,
    capacity: room.capacity,
    sleeps: room.capacity,
    bedType: room.bedType as string | null,
    bedCount: room.bedCount as number | null,
    sizeSqm,
    view: room.view as string | null,
    baseNightlyRate: room.baseNightlyRate,
    currency: "EGP",
  };
}

/**
 * Merges a validated room with its presentation-only metadata, matched by
 * the same canonical slug — never a translation between different slugs.
 *
 * No repository convention exists for a generic/placeholder presentation
 * fallback: every existing presentation component instead renders nothing
 * for an individual missing field (e.g. RoomAmenities/RoomStory render
 * nothing when unset) — there is no "show a neutral image for an
 * unrecognized room" pattern anywhere in this codebase. Per WFI-T03 Phase
 * 5A's explicit instruction, this therefore fails explicitly rather than
 * inventing one: a backend room with no matching presentation entry is a
 * real content gap to fix, not something to silently paper over.
 */
function withPresentation(room: RoomDisplay): RoomWithPresentation {
  const presentation = roomPresentationBySlug[room.slug];

  if (!presentation) {
    throw new Error(`No presentation metadata configured for room slug: "${room.slug}"`);
  }

  return { ...room, ...presentation };
}

/** GET /api/v1/rooms, through the shared server transport. */
export async function getRooms(): Promise<RoomWithPresentation[]> {
  const result = await forwardToExpress({ method: "GET", path: "/api/v1/rooms" });

  if (!result.ok) {
    // A transport/config failure, not a business answer — let it propagate.
    throw result.error;
  }

  if (result.status !== 200) {
    throw new Error(`Room list API returned an unexpected status: ${result.status}`);
  }

  const body = result.body as RoomListResponseBody;
  if (!Array.isArray(body?.data)) {
    throw new Error("Room list API response did not contain a data array");
  }

  return body.data.map((room) => withPresentation(toRoomDisplay(room)));
}

type BackendErrorBody = { error: { code: string; message: string } };

function isBackendErrorBody(value: unknown): value is BackendErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "object" &&
    (value as { error: { code?: unknown } | null }).error !== null &&
    typeof (value as { error: { code?: unknown } }).error.code === "string"
  );
}

/**
 * GET /api/v1/rooms/:slug, through the shared server transport.
 *
 * Returns `null` only for the backend's real `ROOM_NOT_FOUND` domain
 * response — never for a transport/config failure, which is thrown instead
 * so it can never be mistaken for "this room doesn't exist." The caller
 * (a later, not-yet-written page) is responsible for converting a genuine
 * `null` into Next.js's `notFound()`.
 */
export async function getRoomBySlug(slug: string): Promise<RoomWithPresentation | null> {
  const result = await forwardToExpress({
    method: "GET",
    path: `/api/v1/rooms/${encodeURIComponent(slug)}`,
  });

  if (!result.ok) {
    throw result.error;
  }

  if (result.status === 404 && isBackendErrorBody(result.body) && result.body.error.code === ROOM_NOT_FOUND_CODE) {
    return null;
  }

  if (result.status !== 200) {
    throw new Error(`Room detail API returned an unexpected status: ${result.status}`);
  }

  const body = result.body as RoomDetailResponseBody;
  if (typeof body?.data !== "object" || body.data === null) {
    throw new Error("Room detail API response did not contain a data object");
  }

  return withPresentation(toRoomDisplay(body.data));
}
