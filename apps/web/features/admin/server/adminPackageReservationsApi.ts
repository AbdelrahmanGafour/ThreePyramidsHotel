import "server-only";

import { ApiConfigurationError, resolveApiBaseUrl } from "@/shared/server/apiBaseUrl";
import type {
  AdminPackageReservationDetail,
  AdminPackageReservationList,
  AdminPackageReservationListItem,
  AdminPackageReservationPricingStatus,
  AdminPackageReservationStatus,
  AdminPackageReservationStatusTarget,
} from "../types";

// Server-only client for the hotel API's admin package reservations list.
//
// The import above is the boundary: importing this module from client code
// fails the build, so the API address never reaches the browser bundle. It
// talks to Express directly and never to this app's own route handlers — the
// browser has no reason to see reservation data except through a server-
// rendered page.
//
// It holds no state and decides nothing: it forwards the caller's Cookie
// header and reports what the API said.

const ADMIN_PACKAGE_RESERVATIONS_PATH = "/api/v1/admin/package-reservations";

const STATUSES: readonly AdminPackageReservationStatus[] = ["pending", "confirmed", "cancelled"];
const PRICING_STATUSES: readonly AdminPackageReservationPricingStatus[] = [
  "quoted",
  "requires_confirmation",
];

/**
 * Three outcomes, kept apart on purpose. An API that cannot be reached is a
 * server problem, and a refused session is an authentication problem — neither
 * is "this hotel has no package reservations".
 */
export type AdminPackageReservationListResult =
  | { state: "ok"; data: AdminPackageReservationList }
  | { state: "unauthenticated" }
  | { state: "unavailable"; reason: string };

// The two ways this client can fail before the API answers. Distinct on
// purpose: a wrong or missing API address is a deployment fault, not an
// outage, and saying "could not be reached" about it would send someone to
// check a network that is fine. Neither carries the configured value.
const MISCONFIGURED_REASON = "The hotel system is not configured correctly.";
const UNREACHABLE_REASON = "The hotel API could not be reached.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Narrows a payload value to a union by matching it, rather than asserting it.
 * `find` returns the matched literal, so the union is reached by narrowing.
 */
function toStatus(value: unknown): AdminPackageReservationStatus | null {
  return STATUSES.find((candidate) => candidate === value) ?? null;
}

function toPricingStatus(value: unknown): AdminPackageReservationPricingStatus | null {
  return PRICING_STATUSES.find((candidate) => candidate === value) ?? null;
}

/**
 * Rebuilds one row from the payload, field by field.
 *
 * Nothing is spread through: a response is data from another process, and only
 * the fields this app has a use for are carried across. Anything missing,
 * mistyped or unexpected returns null, which the caller reports as an outage
 * rather than rendering half a row.
 *
 * The pricing pair is checked against itself, exactly as the API's own schema
 * states it: a quoted reservation must carry a total, and one awaiting
 * confirmation must not. A payload that breaks that is not something to render
 * — showing a confirmation-required booking with a figure beside it would be
 * worse than showing nothing.
 */
function toListItem(value: unknown): AdminPackageReservationListItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const {
    bookingReference,
    guestName,
    guestEmail,
    guestPhone,
    tourDate,
    adults,
    children,
    currency,
    totalAmountSnapshot,
    createdAt,
  } = value;

  const packageValue = value.package;
  const variant = value.variant;

  if (
    !isRecord(packageValue) ||
    typeof packageValue.code !== "string" ||
    typeof packageValue.slug !== "string" ||
    typeof packageValue.title !== "string"
  ) {
    return null;
  }

  if (!isRecord(variant) || typeof variant.key !== "string" || typeof variant.label !== "string") {
    return null;
  }

  if (
    typeof bookingReference !== "string" ||
    typeof guestName !== "string" ||
    typeof guestEmail !== "string" ||
    typeof guestPhone !== "string" ||
    typeof tourDate !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }

  if (!isCount(adults) || !isCount(children)) {
    return null;
  }

  if (currency !== "USD") {
    return null;
  }

  // Money must stay the exact decimal string the database holds; a number here
  // would mean precision had already been lost upstream. Null is a real value
  // and is preserved as one.
  if (totalAmountSnapshot !== null && typeof totalAmountSnapshot !== "string") {
    return null;
  }

  const status = toStatus(value.status);
  const pricingStatus = toPricingStatus(value.pricingStatus);

  if (!status || !pricingStatus) {
    return null;
  }

  if (pricingStatus === "quoted" && totalAmountSnapshot === null) {
    return null;
  }
  if (pricingStatus === "requires_confirmation" && totalAmountSnapshot !== null) {
    return null;
  }

  return {
    bookingReference,
    package: { code: packageValue.code, slug: packageValue.slug, title: packageValue.title },
    variant: { key: variant.key, label: variant.label },
    guestName,
    guestEmail,
    guestPhone,
    tourDate,
    adults,
    children,
    status,
    pricingStatus,
    currency: "USD",
    totalAmountSnapshot,
    createdAt,
  };
}

/**
 * Rebuilds the list envelope. One unusable row invalidates the whole response
 * rather than being dropped: a list silently missing a booking is worse than a
 * list that says it could not be read.
 */
function toReservationList(payload: unknown): AdminPackageReservationList | null {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.reservations)) {
    return null;
  }

  const items: AdminPackageReservationListItem[] = [];

  for (const raw of payload.data.reservations) {
    const item = toListItem(raw);

    if (!item) {
      return null;
    }

    items.push(item);
  }

  return { reservations: items };
}

/**
 * Asks the API for every package reservation on behalf of the signed-in
 * administrator.
 *
 * The Cookie header is forwarded verbatim: this app never parses it, names the
 * session cookie, or decides whether it is valid — Express and PostgreSQL do.
 *
 * Never redirects and never invents data. Both ways of failing before the API
 * answers are reported as `unavailable`, with distinct reasons, and neither
 * reason carries the configured value, a hostname or an error message.
 */
export async function fetchAdminPackageReservations(
  cookie?: string,
): Promise<AdminPackageReservationListResult> {
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

  const headers: Record<string, string> = {};

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(`${baseUrl}${ADMIN_PACKAGE_RESERVATIONS_PATH}`, {
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

  const data = toReservationList(payload);

  if (!data) {
    return {
      state: "unavailable",
      reason: "The hotel API returned an unexpected package reservations response.",
    };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// One reservation
// ---------------------------------------------------------------------------

// The two error bodies the detail endpoint is contracted to send. A 400 or 404
// that does not match one of these is some other failure wearing the same
// status, so it is reported as an outage rather than as an answer.
const INVALID_PACKAGE_BOOKING_REFERENCE_ERROR = {
  code: "INVALID_PACKAGE_BOOKING_REFERENCE",
  message: "Invalid package booking reference",
} as const;

const PACKAGE_RESERVATION_NOT_FOUND_ERROR = {
  code: "PACKAGE_RESERVATION_NOT_FOUND",
  message: "Package reservation not found",
} as const;

/**
 * Five outcomes, kept apart on purpose.
 *
 * A malformed reference and an unknown one are different facts, and neither is
 * an outage or a refused session. A page may well render `invalid` and
 * `not-found` the same way, but that is the page's decision to make — this
 * client reports what the API actually said.
 */
export type AdminPackageReservationDetailResult =
  | { state: "ok"; data: AdminPackageReservationDetail }
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Ages are whole, non-negative numbers, or the field is absent entirely. */
function toChildAges(value: unknown): number[] | null | undefined {
  if (value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const age of value) {
    if (typeof age !== "number" || !Number.isSafeInteger(age) || age < 0) {
      return undefined;
    }
  }

  return value as number[];
}

/**
 * Rebuilds the detail from the payload, field by field.
 *
 * Built on `toListItem`, so every field the list carries — and every check
 * that guards it — applies here unchanged and the two cannot drift apart.
 */
function toReservationDetail(payload: unknown): AdminPackageReservationDetail | null {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }

  const data = payload.data;
  const listItem = toListItem(data);

  if (!listItem) {
    return null;
  }

  const { guestCountry, specialRequests, adultUnitRateSnapshot, childUnitRateSnapshot } = data;

  if (typeof guestCountry !== "string") {
    return null;
  }

  if (specialRequests !== null && typeof specialRequests !== "string") {
    return null;
  }

  // Money must stay the exact decimal string the database holds.
  if (typeof adultUnitRateSnapshot !== "string") {
    return null;
  }

  if (childUnitRateSnapshot !== null && typeof childUnitRateSnapshot !== "string") {
    return null;
  }

  const childAges = toChildAges(data.childAges);

  if (childAges === undefined) {
    return null;
  }

  // The API states this: ages are stored only alongside children.
  if (childAges !== null && childAges.length !== listItem.children) {
    return null;
  }

  return {
    ...listItem,
    guestCountry,
    childAges,
    specialRequests,
    adultUnitRateSnapshot,
    childUnitRateSnapshot,
  };
}

/**
 * Asks the API for one package reservation on behalf of the signed-in
 * administrator.
 *
 * The reference is encoded, never concatenated raw: it comes from the URL, so
 * a value carrying a slash, a query string or a fragment must become one path
 * segment rather than changing which endpoint is called. Whether it is a
 * booking reference at all is the API's decision — validating it here as well
 * would be a second opinion that could disagree with the first, and this app
 * would then be refusing references the API would have accepted.
 *
 * The Cookie header is forwarded verbatim: this app never parses it, names the
 * session cookie, or decides whether it is valid.
 */
export async function fetchAdminPackageReservation(
  bookingReference: string,
  cookie?: string,
): Promise<AdminPackageReservationDetailResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url = `${baseUrl}${ADMIN_PACKAGE_RESERVATIONS_PATH}/${encodeURIComponent(bookingReference)}`;
  const headers: Record<string, string> = {};

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, { method: "GET", headers, cache: "no-store" });
  } catch {
    // Unreachable API: deliberately not reported as a missing reservation.
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return { state: "unauthenticated" };
  }

  if (response.status === 400 || response.status === 404) {
    const payload = await readJson(response);

    if (response.status === 400 && matchesApiError(payload, INVALID_PACKAGE_BOOKING_REFERENCE_ERROR)) {
      return { state: "invalid" };
    }

    if (response.status === 404 && matchesApiError(payload, PACKAGE_RESERVATION_NOT_FOUND_ERROR)) {
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

  const data = toReservationDetail(payload);

  if (!data) {
    return {
      state: "unavailable",
      reason: "The hotel API returned an unexpected package reservation response.",
    };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Changing one reservation's status
// ---------------------------------------------------------------------------

const INVALID_PACKAGE_RESERVATION_STATUS_ERROR = {
  code: "INVALID_PACKAGE_RESERVATION_STATUS",
  message: "Invalid package reservation status",
} as const;

const INVALID_PACKAGE_STATUS_TRANSITION_ERROR = {
  code: "INVALID_PACKAGE_RESERVATION_STATUS_TRANSITION",
  message: "Package reservation status transition is not allowed",
} as const;

/**
 * Seven outcomes, kept apart on purpose.
 *
 * A refused transition is not a missing reservation, a malformed reference is
 * not a malformed status, and none of them is an outage or a refused session.
 * A page may well render some of them the same way, but that is the page's
 * decision — this client reports what the API actually said.
 */
export type AdminPackageReservationStatusUpdateResult =
  | { state: "ok"; data: AdminPackageReservationDetail }
  | { state: "unauthenticated" }
  | { state: "invalid-reference" }
  | { state: "invalid-status" }
  | { state: "not-found" }
  | { state: "invalid-transition" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to confirm or cancel one package reservation.
 *
 * The body carries the target status and nothing else — no reference, no
 * pricing, no snapshot. Those are the API's to read from its own row, and a
 * request that offered them would be asking it to take this app's word for
 * facts it already holds.
 *
 * The reference is encoded into one path segment, exactly as the read does.
 *
 * On success the API returns the whole updated reservation, so the caller
 * never has to assume what the new status is: it is read back, not inferred
 * from what was asked for.
 */
export async function updateAdminPackageReservationStatus(
  bookingReference: string,
  status: AdminPackageReservationStatusTarget,
  cookie?: string,
): Promise<AdminPackageReservationStatusUpdateResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url = `${baseUrl}${ADMIN_PACKAGE_RESERVATIONS_PATH}/${encodeURIComponent(bookingReference)}/status`;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status }),
      cache: "no-store",
    });
  } catch {
    // The connection dropped. This is a mutation, so it may well have been
    // applied before it did: reported as unknown, never as a failure.
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return { state: "unauthenticated" };
  }

  if (response.status === 400 || response.status === 404 || response.status === 409) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_PACKAGE_BOOKING_REFERENCE_ERROR)) {
        return { state: "invalid-reference" };
      }
      if (matchesApiError(payload, INVALID_PACKAGE_RESERVATION_STATUS_ERROR)) {
        return { state: "invalid-status" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, PACKAGE_RESERVATION_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    if (response.status === 409 && matchesApiError(payload, INVALID_PACKAGE_STATUS_TRANSITION_ERROR)) {
      return { state: "invalid-transition" };
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

  const data = toReservationDetail(payload);

  if (!data) {
    return {
      state: "unavailable",
      reason: "The hotel API returned an unexpected package reservation response.",
    };
  }

  return { state: "ok", data };
}
