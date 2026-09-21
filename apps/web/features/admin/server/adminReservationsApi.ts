import "server-only";

import { ApiConfigurationError, resolveApiBaseUrl } from "@/shared/server/apiBaseUrl";
import type {
  AdminReservationDetail,
  AdminReservationList,
  AdminReservationListItem,
  AdminReservationListPagination,
  AdminReservationListWindow,
  AdminReservationStatus,
  AdminReservationStatusChange,
  AdminReservationStatusTarget,
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
 * Narrows a payload's status to the contract's union by matching it, rather
 * than asserting it. Shared by both mappers so the two cannot drift.
 */
function toReservationStatus(value: unknown): AdminReservationStatus | null {
  // find(), not some(): it returns the matched literal, so the union is reached
  // by narrowing rather than by an unchecked assertion.
  return RESERVATION_STATUSES.find((candidate) => candidate === value) ?? null;
}

// The two ways this client can fail before the API answers. Distinct on
// purpose: a wrong or missing API address is a deployment fault, not an outage,
// and saying "could not be reached" about it would send someone to check a
// network that is fine. Neither carries the configured value or a hostname.
const MISCONFIGURED_REASON = "The hotel system is not configured correctly.";
const UNREACHABLE_REASON = "The hotel API could not be reached.";

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

  const reservationStatus = toReservationStatus(status);

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
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
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
    return { state: "unavailable", reason: UNREACHABLE_REASON };
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

// --- One reservation in full ------------------------------------------------

// The two error bodies the detail endpoint is contracted to send. A 400 or 404
// that does not match one of these is some other failure wearing the same
// status, so it is reported as an outage rather than as an answer.
const INVALID_BOOKING_REFERENCE_ERROR = {
  code: "INVALID_BOOKING_REFERENCE",
  message: "Invalid booking reference",
} as const;

const RESERVATION_NOT_FOUND_ERROR = {
  code: "RESERVATION_NOT_FOUND",
  message: "Reservation not found",
} as const;

/**
 * Five outcomes, kept apart on purpose.
 *
 * A malformed reference and an unknown one are different facts, and neither is
 * an outage or a refused session. A page may well render `invalid` and
 * `not-found` the same way, but that is the page's decision to make — this
 * client reports what the API actually said.
 */
export type AdminReservationDetailResult =
  | { state: "ok"; data: AdminReservationDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "not-found" }
  | { state: "unavailable"; reason: string };

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

/** Five strings, all required, rebuilt rather than carried across wholesale. */
function toGuest(value: unknown): AdminReservationDetail["guest"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const { firstName, lastName, email, phone, country } = value;

  if (
    typeof firstName !== "string" ||
    typeof lastName !== "string" ||
    typeof email !== "string" ||
    typeof phone !== "string" ||
    typeof country !== "string"
  ) {
    return null;
  }

  return { firstName, lastName, email, phone, country };
}

/**
 * The stay's own invariants, which the database enforces: a reservation covers
 * at least one night and carries at least one adult, while children may be
 * zero. A payload disagreeing with that is not something to render.
 */
function toStay(value: unknown): AdminReservationDetail["stay"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const { checkIn, checkOut, nights, adults, children } = value;

  if (typeof checkIn !== "string" || typeof checkOut !== "string") {
    return null;
  }

  if (!isSafeCount(nights) || nights < 1) {
    return null;
  }

  if (!isSafeCount(adults) || adults < 1) {
    return null;
  }

  if (!isSafeCount(children)) {
    return null;
  }

  return { checkIn, checkOut, nights, adults, children };
}

function toPricing(value: unknown): AdminReservationDetail["pricing"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const { nightlyRate, totalAmount, currency } = value;

  // Both stay the exact decimal strings the database holds; a number here would
  // mean precision had already been lost upstream.
  if (typeof nightlyRate !== "string" || typeof totalAmount !== "string" || currency !== "EGP") {
    return null;
  }

  return { nightlyRate, totalAmount, currency };
}

/**
 * Rebuilds the whole reservation from the payload, group by group.
 *
 * Nothing is spread: a response is data from another process, and only the
 * fields this app has a use for are carried across. Anything missing, mistyped
 * or unexpected returns null, which the caller reports as an outage rather than
 * rendering half a booking.
 *
 * `requested` is checked against the reservation that came back, the same way
 * the list checks the window it asked for: a page showing one booking under
 * another booking's URL would be a quiet lie, and whichever reservation this
 * is, it is not the one anybody asked about.
 */
function toReservationDetail(payload: unknown, requested: string): AdminReservationDetail | null {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }

  const { bookingReference, status, roomType, room, specialRequests, createdAt } = payload.data;

  if (typeof bookingReference !== "string" || typeof createdAt !== "string") {
    return null;
  }

  // Exact: the reference was sent untouched, so the answer must come back
  // untouched too. Anything else is a different reservation.
  if (bookingReference !== requested) {
    return null;
  }

  const reservationStatus = toReservationStatus(status);

  if (!reservationStatus) {
    return null;
  }

  const guest = toGuest(payload.data.guest);
  const stay = toStay(payload.data.stay);
  const pricing = toPricing(payload.data.pricing);

  if (!guest || !stay || !pricing) {
    return null;
  }

  if (!isRecord(roomType) || typeof roomType.slug !== "string" || typeof roomType.name !== "string") {
    return null;
  }

  if (!isRecord(room) || typeof room.number !== "string") {
    return null;
  }

  // Genuinely optional in the schema, so null is data rather than a fault.
  if (specialRequests !== null && typeof specialRequests !== "string") {
    return null;
  }

  return {
    bookingReference,
    status: reservationStatus,
    guest,
    stay,
    roomType: { slug: roomType.slug, name: roomType.name },
    room: { number: room.number },
    pricing,
    specialRequests,
    createdAt,
  };
}

/**
 * Asks the API for one reservation on behalf of the signed-in administrator.
 *
 * The reference is passed through untouched — never trimmed, never upper-cased.
 * The API owns what a booking reference is, and normalising one here would mean
 * asking about a value the caller never sent.
 *
 * The Cookie header is forwarded verbatim: this app never parses it, names the
 * session cookie, or decides whether it is valid — Express and PostgreSQL do.
 */
export async function fetchAdminReservation(
  bookingReference: string,
  cookie?: string,
): Promise<AdminReservationDetailResult> {
  let baseUrl: string;

  // Resolved outside the fetch below so a configuration fault cannot be caught
  // by, and mistaken for, a network failure.
  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  // Encoded as exactly one path segment: the reference is route input, and a
  // slash or a query character in it must not become part of the URL's
  // structure. The path itself is a constant and is never caller-supplied.
  const url = `${baseUrl}${ADMIN_RESERVATIONS_PATH}/${encodeURIComponent(bookingReference)}`;
  const headers: Record<string, string> = {};

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      // Reservation data is never cacheable.
      cache: "no-store",
    });
  } catch {
    // Unreachable API: deliberately not reported as a missing reservation.
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  // Identified by status alone, matching the existing auth boundary.
  if (response.status === 401) {
    return { state: "unauthenticated" };
  }

  if (response.status === 400 || response.status === 404) {
    const payload = await readJson(response);

    if (response.status === 400 && matchesApiError(payload, INVALID_BOOKING_REFERENCE_ERROR)) {
      return { state: "invalid" };
    }

    if (response.status === 404 && matchesApiError(payload, RESERVATION_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    // The right status but the wrong body: something other than this contract
    // answered, so it must not be reported as a decision about this booking.
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toReservationDetail(payload, bookingReference);

  if (!data) {
    return { state: "unavailable", reason: "The hotel API returned an unexpected reservation response." };
  }

  return { state: "ok", data };
}

// --- Changing one reservation's status --------------------------------------

// The two further error bodies this endpoint is contracted to send, alongside
// the malformed-reference and not-found ones above. A status that matches but a
// body that does not is some other failure wearing the same number, so it is
// reported as an outage rather than as an answer about this booking.
const INVALID_RESERVATION_STATUS_ERROR = {
  code: "INVALID_RESERVATION_STATUS",
  message: "Invalid reservation status",
} as const;

const INVALID_STATUS_TRANSITION_ERROR = {
  code: "INVALID_STATUS_TRANSITION",
  message: "Reservation status transition is not allowed",
} as const;

/** The only statuses a request may ask for; `pending` is deliberately absent. */
const STATUS_TARGETS: readonly AdminReservationStatusTarget[] = ["confirmed", "cancelled"];

const UNEXPECTED_RESPONSE_REASON = "The hotel API returned an unexpected reservation response.";
const UNREADABLE_RESPONSE_REASON = "The hotel API returned an unreadable response.";

/**
 * Six outcomes, kept apart on purpose.
 *
 * A reference that is not a reference, a status that is not a status, a booking
 * nobody made, and a move this booking cannot make are four different facts,
 * and none of them is an outage or a refused session. A page may well present
 * some of them the same way, but that is the page's decision — this client
 * reports what the API actually said.
 */
export type AdminReservationStatusUpdateResult =
  | { state: "ok"; data: AdminReservationStatusChange }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "invalid-status" }
  | { state: "not-found" }
  | { state: "invalid-transition" }
  | { state: "unavailable"; reason: string };

/**
 * Narrows to a status a reservation can be moved to. `pending` is refused even
 * here: a successful mutation cannot have produced it.
 */
function toStatusTarget(value: unknown): AdminReservationStatusTarget | null {
  // find(), not some(): it returns the matched literal, so the union is reached
  // by narrowing rather than by an unchecked assertion.
  return STATUS_TARGETS.find((candidate) => candidate === value) ?? null;
}

/**
 * The canonical ISO instant the API produces: `YYYY-MM-DDTHH:mm:ss.sssZ`.
 *
 * The round trip is the contract. `Date` parses far more than the API ever
 * sends — a bare day, a locale-shaped string, an offset like `+02:00` — and
 * merely parsing proves only that JavaScript coped, not that the value came
 * from the mapper this client is talking to. Re-serialising and demanding the
 * exact same string admits only what `toISOString()` itself produces.
 *
 * The parsed date is used for the check and discarded: the caller keeps the
 * original string, which by then is known to be identical anyway.
 */
function isInstant(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const parsed = new Date(value);

  // Checked first: toISOString() throws on an invalid date rather than
  // returning something comparable.
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.toISOString() === value;
}

/**
 * Rebuilds the change from the payload, field by field.
 *
 * `requested` is checked against what came back, the same way the detail client
 * checks the reservation it asked for: a response describing a different
 * booking, or a different status than the one requested, cannot be interpreted.
 * Whatever it is, it is not the answer to this request, and showing it as one
 * would tell an administrator their change succeeded when something else
 * entirely happened.
 */
function toStatusChange(
  payload: unknown,
  requested: { bookingReference: string; status: AdminReservationStatusTarget },
): AdminReservationStatusChange | null {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }

  const { bookingReference, status, updatedAt } = payload.data;

  if (typeof bookingReference !== "string" || bookingReference !== requested.bookingReference) {
    return null;
  }

  const changedTo = toStatusTarget(status);

  if (!changedTo || changedTo !== requested.status) {
    return null;
  }

  // The instant the API recorded, carried across as it sent it: never
  // reformatted, never re-zoned, and never replaced with this server's clock.
  if (!isInstant(updatedAt)) {
    return null;
  }

  return { bookingReference, status: changedTo, updatedAt };
}

/**
 * Asks the API to change one reservation's status, on behalf of the signed-in
 * administrator.
 *
 * The reference is passed through untouched — never trimmed, never upper-cased.
 * The API owns what a booking reference is, and what transitions a booking may
 * make; this client states neither rule and only reports the answer.
 *
 * The body is built here from the one validated status, not forwarded from a
 * caller's object, so nothing a caller happens to be holding can reach the API.
 *
 * The Cookie header is forwarded verbatim: this app never parses it, names the
 * session cookie, or decides whether it is valid — Express and PostgreSQL do.
 */
export async function updateAdminReservationStatus(
  bookingReference: string,
  status: AdminReservationStatusTarget,
  cookie?: string,
): Promise<AdminReservationStatusUpdateResult> {
  let baseUrl: string;

  // Resolved outside the fetch below so a configuration fault cannot be caught
  // by, and mistaken for, a network failure.
  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  // Encoded as exactly one path segment: the reference is caller input, and a
  // slash or a query character in it must not become part of the URL's
  // structure. Both path constants around it are fixed.
  const url = `${baseUrl}${ADMIN_RESERVATIONS_PATH}/${encodeURIComponent(bookingReference)}/status`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status }),
      // A mutation is never cacheable.
      cache: "no-store",
    });
  } catch {
    // The request may never have arrived — or may have arrived and committed
    // before the connection failed. Reported as an outage, never as a refusal
    // and never as success.
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  // Identified by status alone, matching the existing auth boundary.
  if (response.status === 401) {
    return { state: "unauthenticated" };
  }

  // For these three the status alone is not enough: each has a contracted body,
  // and anything else answering with the same number is not this contract.
  if (response.status === 400 || response.status === 404 || response.status === 409) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_BOOKING_REFERENCE_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_RESERVATION_STATUS_ERROR)) {
        return { state: "invalid-status" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, RESERVATION_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    if (response.status === 409 && matchesApiError(payload, INVALID_STATUS_TRANSITION_ERROR)) {
      return { state: "invalid-transition" };
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

  const data = toStatusChange(payload, { bookingReference, status });

  if (!data) {
    return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
  }

  return { state: "ok", data };
}
