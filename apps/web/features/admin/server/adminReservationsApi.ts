import "server-only";

import { ApiConfigurationError, resolveApiBaseUrl } from "@/shared/server/apiBaseUrl";
import type {
  AdminReservationList,
  AdminReservationListItem,
  AdminReservationListPagination,
  AdminReservationListWindow,
  AdminReservationStatus,
} from "../types";

// Server-only client for the hotel API's admin reservations list.
//
// The import above is the boundary: importing this module from client code
// fails the build, so the API address never reaches the browser bundle. It
// talks to Express directly and never to this app's own route handlers — the
// browser has no reason to see reservation data except through a server-
// rendered page.
//
// It holds no state and decides nothing: it forwards the caller's Cookie header
// and reports what the API said.

const ADMIN_RESERVATIONS_PATH = "/api/v1/admin/reservations";

const RESERVATION_STATUSES: readonly AdminReservationStatus[] = ["pending", "confirmed", "cancelled"];

// The API's own pagination bounds. Mirrored here so a response claiming a
// window the API could never have accepted is recognised as malformed.
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

/**
 * Three outcomes, kept apart on purpose. An API that cannot be reached is a
 * server problem, and a refused session is an authentication problem — neither
 * is "this hotel has no reservations".
 */
export type AdminReservationListResult =
  | { state: "ok"; data: AdminReservationList }
  | { state: "unauthenticated" }
  | { state: "unavailable"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Rebuilds one row from the payload, field by field.
 *
 * Nothing is spread through: a response is data from another process, and only
 * the fields this app has a use for are carried across. Anything missing,
 * mistyped or unexpected returns null, which the caller reports as an outage
 * rather than rendering half a row.
 */
function toListItem(value: unknown): AdminReservationListItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const { bookingReference, guestName, guestEmail, checkIn, checkOut, status, totalAmount, currency, createdAt } =
    value;
  const roomType = value.roomType;

  if (!isRecord(roomType) || typeof roomType.slug !== "string" || typeof roomType.name !== "string") {
    return null;
  }

  if (
    typeof bookingReference !== "string" ||
    typeof guestName !== "string" ||
    typeof guestEmail !== "string" ||
    typeof checkIn !== "string" ||
    typeof checkOut !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }

  // Money must stay the exact decimal string the database holds; a number here
  // would mean precision had already been lost upstream.
  if (typeof totalAmount !== "string" || currency !== "EGP") {
    return null;
  }

  // find(), not some(): it returns the matched literal, so the union is reached
  // by narrowing rather than by an unchecked assertion.
  const reservationStatus = RESERVATION_STATUSES.find((candidate) => candidate === status);

  if (!reservationStatus) {
    return null;
  }

  return {
    bookingReference,
    guestName,
    guestEmail,
    roomType: { slug: roomType.slug, name: roomType.name },
    checkIn,
    checkOut,
    status: reservationStatus,
    totalAmount,
    currency,
    createdAt,
  };
}

/**
 * Checks the window the API reports against the contract and against what was
 * actually asked for.
 *
 * A page that comes back describing a different window than the one requested
 * cannot be interpreted: these rows might be someone else's page, and rendering
 * them under the requested window's paging controls would be a quiet lie. It is
 * reported as malformed rather than silently accepted, rewritten or clamped.
 */
function toPagination(value: unknown, requested: AdminReservationListWindow): AdminReservationListPagination | null {
  if (!isRecord(value)) {
    return null;
  }

  const { limit, offset, total } = value;

  if (!isSafeCount(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
    return null;
  }

  if (!isSafeCount(offset) || !isSafeCount(total)) {
    return null;
  }

  if (limit !== requested.limit || offset !== requested.offset) {
    return null;
  }

  // `total` is the API's to report; only its shape is checked here.
  return { limit, offset, total };
}

function toReservationList(payload: unknown, requested: AdminReservationListWindow): AdminReservationList | null {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }

  const { reservations, pagination } = payload.data;

  if (!Array.isArray(reservations)) {
    return null;
  }

  const items: AdminReservationListItem[] = [];

  for (const entry of reservations) {
    const item = toListItem(entry);

    // One bad row invalidates the page: silently dropping it would show a
    // shorter list than the total claims, with no sign anything was missing.
    if (!item) {
      return null;
    }

    items.push(item);
  }

  const reportedWindow = toPagination(pagination, requested);

  if (!reportedWindow) {
    return null;
  }

  return { reservations: items, pagination: reportedWindow };
}

/**
 * Asks the API for one page of reservations on behalf of the signed-in
 * administrator.
 *
 * The Cookie header is forwarded verbatim: this app never parses it, names the
 * session cookie, or decides whether it is valid — Express and PostgreSQL do.
 *
 * Never redirects and never invents data. Both ways of failing before the API
 * answers are reported as `unavailable`, but with distinct reasons: a wrong or
 * missing API address is a deployment fault, not an outage, and saying "could
 * not be reached" about it would send someone to check a network that is fine.
 * Neither reason carries the configured value, a hostname or an error message.
 */
export async function fetchAdminReservations(
  requested: AdminReservationListWindow,
  cookie?: string,
): Promise<AdminReservationListResult> {
  const { limit, offset } = requested;

  let baseUrl: string;

  // Resolved outside the fetch below so a configuration fault cannot be caught
  // by, and mistaken for, a network failure.
  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: "The hotel system is not configured correctly." };
    }

    throw error;
  }

  // Built explicitly rather than by concatenation, so the values are always
  // encoded and the path itself is never caller-supplied.
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const headers: Record<string, string> = {};

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(`${baseUrl}${ADMIN_RESERVATIONS_PATH}?${query}`, {
      method: "GET",
      headers,
      // Reservation data is never cacheable.
      cache: "no-store",
    });
  } catch {
    // Unreachable API: deliberately not reported as an empty list.
    return { state: "unavailable", reason: "The hotel API could not be reached." };
  }

  if (response.status === 401) {
    return { state: "unauthenticated" };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toReservationList(payload, requested);

  if (!data) {
    return { state: "unavailable", reason: "The hotel API returned an unexpected reservations response." };
  }

  return { state: "ok", data };
}
