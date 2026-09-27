import "server-only";

import { ApiConfigurationError, resolveApiBaseUrl } from "@/shared/server/apiBaseUrl";
import type {
  PackageCreateInput,
  PackageRateTierInput,
  PackageUpdateInput,
  PackageContentInput,
  PackageItinerarySectionInput,
  PackageVariantCreateInput,
  PackageVariantUpdateInput,
} from "../lib/packages";
import type {
  AdminPackageContent,
  AdminPackageDetail,
  AdminPackageImage,
  AdminPackageItinerarySection,
  AdminPackageList,
  AdminPackageListItem,
  AdminPackageManagementSource,
  AdminPackageRateTier,
  AdminPackageVariant,
} from "../types";

// Server-only client for the hotel API's admin package catalogue.
//
// The import above is the boundary: importing this module from client code
// fails the build, so the API address never reaches the browser bundle. It
// talks to Express directly and never to this app's own route handlers.
//
// It holds no state and decides nothing: it forwards the caller's Cookie
// header and reports what the API said.

const ADMIN_PACKAGES_PATH = "/api/v1/admin/packages";

const MANAGEMENT_SOURCES: readonly AdminPackageManagementSource[] = ["brochure", "admin"];

/**
 * Three outcomes, kept apart on purpose. An API that cannot be reached is a
 * server problem, and a refused session is an authentication problem — neither
 * is "this hotel offers no journeys".
 */
export type AdminPackageListResult =
  | { state: "ok"; data: AdminPackageList }
  | { state: "unauthenticated" }
  | { state: "unavailable"; reason: string };

// The two ways this client can fail before the API answers. Distinct on
// purpose: a wrong or missing API address is a deployment fault, not an
// outage. Neither reason carries the configured value or a hostname.
const MISCONFIGURED_REASON = "The hotel system is not configured correctly.";
const UNREACHABLE_REASON = "The hotel API could not be reached.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Narrows the payload's source to the contract's union by matching it rather
 * than asserting it: `find` returns the matched literal.
 */
function toManagementSource(value: unknown): AdminPackageManagementSource | null {
  return MANAGEMENT_SOURCES.find((candidate) => candidate === value) ?? null;
}

/**
 * Rebuilds one row from the payload, field by field.
 *
 * Nothing is spread through: a response is data from another process, and only
 * the fields this app has a use for are carried across. Anything missing,
 * mistyped or unexpected returns null, which the caller reports as an outage
 * rather than rendering half a row.
 */
function toListItem(value: unknown): AdminPackageListItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const { code, slug, title, summary, durationLabel, scheduleLabel } = value;

  if (typeof code !== "string" || typeof slug !== "string" || typeof title !== "string") {
    return null;
  }

  if (!isNullableString(summary) || !isNullableString(durationLabel) || !isNullableString(scheduleLabel)) {
    return null;
  }

  if (typeof value.requiresPriceConfirmation !== "boolean" || typeof value.isActive !== "boolean") {
    return null;
  }

  if (!isCount(value.sortOrder) || !isCount(value.variantCount)) {
    return null;
  }

  if (!isNullableString(value.defaultVariantLabel)) {
    return null;
  }

  const managementSource = toManagementSource(value.managementSource);

  if (!managementSource) {
    return null;
  }

  return {
    code,
    slug,
    title,
    summary,
    durationLabel,
    scheduleLabel,
    requiresPriceConfirmation: value.requiresPriceConfirmation,
    isActive: value.isActive,
    sortOrder: value.sortOrder,
    managementSource,
    variantCount: value.variantCount,
    defaultVariantLabel: value.defaultVariantLabel,
  };
}

/**
 * Rebuilds the list envelope. One unusable row invalidates the whole response
 * rather than being dropped: a catalogue silently missing an offering is worse
 * than one that says it could not be read.
 */
function toPackageList(payload: unknown): AdminPackageList | null {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.packages)) {
    return null;
  }

  const items: AdminPackageListItem[] = [];

  for (const raw of payload.data.packages) {
    const item = toListItem(raw);

    if (!item) {
      return null;
    }

    items.push(item);
  }

  return { packages: items };
}

/**
 * Asks the API for the whole catalogue on behalf of the signed-in
 * administrator.
 *
 * The Cookie header is forwarded verbatim: this app never parses it, names the
 * session cookie, or decides whether it is valid — Express and PostgreSQL do.
 *
 * Never redirects and never invents data. Both ways of failing before the API
 * answers are reported as `unavailable`, with distinct reasons, and neither
 * reason carries the configured value, a hostname or an error message.
 */
export async function fetchAdminPackages(cookie?: string): Promise<AdminPackageListResult> {
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
    response = await fetch(`${baseUrl}${ADMIN_PACKAGES_PATH}`, {
      method: "GET",
      headers,
      // Catalogue state is never cacheable: an offering withdrawn a moment ago
      // must not still read as active.
      cache: "no-store",
    });
  } catch {
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

  const data = toPackageList(payload);

  if (!data) {
    return { state: "unavailable", reason: "The hotel API returned an unexpected catalogue response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// One journey
// ---------------------------------------------------------------------------

// The two error bodies the detail endpoint is contracted to send. A 400 or 404
// that does not match one of these is some other failure wearing the same
// status, so it is reported as an outage rather than as an answer.
const INVALID_PACKAGE_SLUG_ERROR = {
  code: "INVALID_PACKAGE_SLUG",
  message: "Invalid package slug",
} as const;

const PACKAGE_NOT_FOUND_ERROR = {
  code: "PACKAGE_NOT_FOUND",
  message: "Package not found",
} as const;

const INVALID_PACKAGE_ERROR = {
  code: "INVALID_PACKAGE",
  message: "Invalid package details",
} as const;

/**
 * Five outcomes, kept apart on purpose.
 *
 * A malformed slug and an unknown one are different facts, and neither is an
 * outage or a refused session. A page may well render `invalid` and
 * `not-found` the same way, but that is the page's decision to make.
 */
export type AdminPackageDetailResult =
  | { state: "ok"; data: AdminPackageDetail }
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

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === "string") ? (value as string[]) : null;
}

function toRateTier(value: unknown): AdminPackageRateTier | null {
  if (!isRecord(value)) return null;

  const { minPartySize, maxPartySize, adultUnitRate, currency } = value;

  if (!isCount(minPartySize) || minPartySize < 1) return null;
  if (maxPartySize !== null && (!isCount(maxPartySize) || maxPartySize < minPartySize)) return null;
  // Money must stay the exact decimal string; a number would mean precision
  // had already been lost upstream.
  if (typeof adultUnitRate !== "string") return null;
  if (currency !== "USD") return null;

  return {
    minPartySize,
    maxPartySize: maxPartySize as number | null,
    adultUnitRate,
    currency: "USD",
  };
}

function toVariant(value: unknown): AdminPackageVariant | null {
  if (!isRecord(value)) return null;

  const { key, label, isDefault, sortOrder, childMinAge, childMaxAge, childDiscountPercent } = value;

  if (typeof key !== "string" || typeof label !== "string") return null;
  if (typeof isDefault !== "boolean" || !isCount(sortOrder)) return null;
  if (childMinAge !== null && !isCount(childMinAge)) return null;
  if (childMaxAge !== null && !isCount(childMaxAge)) return null;
  if (!isNullableString(childDiscountPercent)) return null;

  // The API states the trio is all-or-nothing; a payload that breaks it is not
  // something to render as half a child rule.
  const set = [childMinAge, childMaxAge, childDiscountPercent].filter((field) => field !== null).length;
  if (set !== 0 && set !== 3) return null;

  if (!Array.isArray(value.rates)) return null;

  const rates: AdminPackageRateTier[] = [];
  for (const raw of value.rates) {
    const tier = toRateTier(raw);
    if (!tier) return null;
    rates.push(tier);
  }

  return {
    key,
    label,
    isDefault,
    sortOrder,
    childMinAge: childMinAge as number | null,
    childMaxAge: childMaxAge as number | null,
    childDiscountPercent,
    rates,
  };
}

function toItinerary(value: unknown): AdminPackageItinerarySection[] | null {
  if (!Array.isArray(value)) return null;

  const sections: AdminPackageItinerarySection[] = [];

  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const { dayNumber, heading, body } = raw;
    if (dayNumber !== null && !isCount(dayNumber)) return null;
    if (!isNullableString(heading) || typeof body !== "string") return null;
    sections.push({ dayNumber: dayNumber as number | null, heading, body });
  }

  return sections;
}

function toContent(value: unknown): AdminPackageContent | null {
  if (!isRecord(value)) return null;

  const included = toStringArray(value.included);
  const excluded = toStringArray(value.excluded);
  const notes = toStringArray(value.notes);

  if (!included || !excluded || !notes) return null;

  return { included, excluded, notes };
}

/**
 * Rebuilds the detail from the payload, field by field.
 *
 * Built on `toListItem`, so every field the list carries — and every check
 * that guards it — applies here unchanged and the two cannot drift apart.
 * The API's ordering is preserved exactly: nothing here re-sorts a variant or
 * a tier, because the catalogue and the public site must agree on sequence.
 */
/**
 * The journey's image, or nothing.
 *
 * Fail-closed like every other mapper here: a body carrying an `image` that
 * is neither null nor the five-field object is a body this contract does not
 * describe, and the whole detail is refused rather than silently reported as
 * a journey with no picture. Nothing else about the object is read, so a
 * field the API does not send cannot appear by being passed through.
 */
function toPackageImage(value: unknown): AdminPackageImage | null | "invalid" {
  if (value === null) return null;
  if (!isRecord(value)) return "invalid";

  const { reference, url, altText, width, height } = value;

  if (typeof reference !== "string" || reference.length === 0) return "invalid";
  if (typeof url !== "string" || url.length === 0) return "invalid";
  if (!isNullableString(altText)) return "invalid";
  if (!isCount(width) || width <= 0) return "invalid";
  if (!isCount(height) || height <= 0) return "invalid";

  return { reference, url, altText, width, height };
}

function toPackageDetail(payload: unknown): AdminPackageDetail | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;

  const data = payload.data;
  const listItem = toListItem(data);

  if (!listItem) return null;

  if (!isNullableString(data.description)) return null;

  const operatingDays = data.operatingDays === null ? null : toStringArray(data.operatingDays);
  if (data.operatingDays !== null && !operatingDays) return null;

  const itinerary = toItinerary(data.itinerary);
  const content = toContent(data.content);

  if (!itinerary || !content) return null;

  if (!Array.isArray(data.variants)) return null;

  const variants: AdminPackageVariant[] = [];
  for (const raw of data.variants) {
    const variant = toVariant(raw);
    if (!variant) return null;
    variants.push(variant);
  }

  const image = toPackageImage(data.image);

  if (image === "invalid") return null;

  return {
    ...listItem,
    description: data.description,
    operatingDays,
    itinerary,
    content,
    variants,
    image,
  };
}

/**
 * Asks the API for one journey on behalf of the signed-in administrator.
 *
 * The slug is encoded, never concatenated raw: it comes from the URL, so a
 * value carrying a slash, a query string or a fragment must become one path
 * segment rather than changing which endpoint is called. Whether it is a slug
 * at all is the API's decision — validating it here as well would be a second
 * opinion that could disagree with the first.
 */
export async function fetchAdminPackage(
  slug: string,
  cookie?: string,
): Promise<AdminPackageDetailResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url = `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}`;
  const headers: Record<string, string> = {};

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, { method: "GET", headers, cache: "no-store" });
  } catch {
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return { state: "unauthenticated" };
  }

  if (response.status === 400 || response.status === 404) {
    const payload = await readJson(response);

    if (response.status === 400 && matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)) {
      return { state: "invalid" };
    }

    if (response.status === 404 && matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    // The right status but the wrong body: something other than this contract
    // answered, so it must not be reported as a decision about this journey.
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Creating a journey
// ---------------------------------------------------------------------------

const RESERVED_BROCHURE_IDENTITY_ERROR = {
  code: "RESERVED_BROCHURE_PACKAGE_IDENTITY",
  message: "That code or slug belongs to the brochure catalogue",
} as const;

const PACKAGE_CODE_IN_USE_ERROR = {
  code: "PACKAGE_CODE_IN_USE",
  message: "Another package already uses that code",
} as const;

const PACKAGE_SLUG_IN_USE_ERROR = {
  code: "PACKAGE_SLUG_IN_USE",
  message: "Another package already uses that slug",
} as const;

/**
 * Seven outcomes, kept apart on purpose.
 *
 * The three conflicts are distinct because an administrator must do something
 * different about each: pick a non-brochure identity, change the code, or
 * change the slug.
 */
export type AdminPackageCreateResult =
  | { state: "ok"; data: AdminPackageDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "reserved-brochure-identity" }
  | { state: "code-in-use" }
  | { state: "slug-in-use" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to create one journey.
 *
 * The body carries exactly the ten fields the endpoint accepts. Nothing about
 * publication or ownership is sent: a new journey is always created
 * unpublished and admin-owned, and that is the API's decision rather than a
 * value this app could offer.
 */
export async function createAdminPackage(
  input: PackageCreateInput,
  cookie?: string,
): Promise<AdminPackageCreateResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const headers: Record<string, string> = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(`${baseUrl}${ADMIN_PACKAGES_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    // The connection dropped. This is a creation, so it may well have been
    // applied before it did: reported as unknown, never as a failure.
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return { state: "unauthenticated" };
  }

  if (response.status === 400 || response.status === 409) {
    const payload = await readJson(response);

    if (response.status === 400 && matchesApiError(payload, INVALID_PACKAGE_ERROR)) {
      return { state: "invalid" };
    }

    if (response.status === 409) {
      if (matchesApiError(payload, RESERVED_BROCHURE_IDENTITY_ERROR)) {
        return { state: "reserved-brochure-identity" };
      }
      if (matchesApiError(payload, PACKAGE_CODE_IN_USE_ERROR)) {
        return { state: "code-in-use" };
      }
      if (matchesApiError(payload, PACKAGE_SLUG_IN_USE_ERROR)) {
        return { state: "slug-in-use" };
      }
    }

    // The right status but the wrong body: something other than this contract
    // answered, so it must not be reported as a decision about this journey.
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    // The journey may well have been created; this app simply cannot read the
    // answer, so the caller must not report either outcome as certain.
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Editing a journey
// ---------------------------------------------------------------------------

/**
 * Five outcomes, kept apart on purpose.
 *
 * There is no conflict state: an edit changes no identity, so nothing can
 * already be taken.
 */
export type AdminPackageUpdateResult =
  | { state: "ok"; data: AdminPackageDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "not-found" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to rewrite one journey's package-level fields.
 *
 * The body carries exactly the eight editable fields. The journey's identity,
 * its publication and its ownership are not sent: the API refuses a body that
 * offers any of them, and ownership moves as a consequence of the edit rather
 * than as something this app asks for.
 */
export async function updateAdminPackage(
  slug: string,
  input: PackageUpdateInput,
  cookie?: string,
): Promise<AdminPackageUpdateResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url = `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}`;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(input),
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

  if (response.status === 400 || response.status === 404) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_PACKAGE_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)) {
        return { state: "invalid" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    // The edit may well have been applied; this app simply cannot read the
    // answer, so the caller must not report either outcome as certain.
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Adding a variant to a journey
// ---------------------------------------------------------------------------

const PACKAGE_VARIANT_KEY_IN_USE_ERROR = {
  code: "PACKAGE_VARIANT_KEY_IN_USE",
  message: "This journey already has a variant with that key",
} as const;

const PACKAGE_VARIANT_ORDER_EXHAUSTED_ERROR = {
  code: "PACKAGE_VARIANT_ORDER_EXHAUSTED",
  message: "This journey has no ordering position left for another variant",
} as const;

// The two advisory refusals name remedies at length and may well be reworded,
// so they are matched on their code alone — the part that is contracted.
const PACKAGE_MUST_BE_INACTIVE_CODE = "PACKAGE_MUST_BE_INACTIVE";
const PACKAGE_VARIANT_DEFAULT_UNSAFE_CODE = "PACKAGE_VARIANT_DEFAULT_UNSAFE";

/**
 * Seven outcomes, and the four conflicts stay apart because an administrator
 * must do something different about each: pick another key, withdraw the
 * journey, flag the existing variant as the default, or renumber an ordering
 * that has run out. Folding them together would leave the screen telling
 * someone only that "it did not work".
 */
export type AdminPackageVariantCreateResult =
  | { state: "ok"; data: AdminPackageDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "key-in-use" }
  | { state: "package-inactive-required" }
  | { state: "default-unsafe" }
  | { state: "order-exhausted" }
  | { state: "package-not-found" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to add one variant to a journey.
 *
 * The body carries exactly the five fields the create contract accepts. The
 * default flag, the position and the rates are not sent — the API derives the
 * first two itself and refuses a body offering any of them — and neither is
 * anything about the journey's publication or ownership.
 *
 * The slug is encoded, so a value carrying a slash or a query string becomes
 * one path segment rather than changing which endpoint is called.
 */
export async function createAdminPackageVariant(
  slug: string,
  input: PackageVariantCreateInput,
  cookie?: string,
): Promise<AdminPackageVariantCreateResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url = `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}/variants`;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    // The connection dropped. This is a mutation, so the variant may well
    // have been created before it did: reported as unknown, never as a
    // failure.
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return { state: "unauthenticated" };
  }

  if (response.status === 400 || response.status === 404 || response.status === 409) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_PACKAGE_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)) {
        return { state: "invalid" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
      return { state: "package-not-found" };
    }

    if (response.status === 409) {
      if (matchesApiError(payload, PACKAGE_VARIANT_KEY_IN_USE_ERROR)) {
        return { state: "key-in-use" };
      }
      if (matchesApiError(payload, PACKAGE_VARIANT_ORDER_EXHAUSTED_ERROR)) {
        return { state: "order-exhausted" };
      }
      if (isRecord(payload) && isRecord(payload.error)) {
        if (payload.error.code === PACKAGE_MUST_BE_INACTIVE_CODE) {
          return { state: "package-inactive-required" };
        }
        if (payload.error.code === PACKAGE_VARIANT_DEFAULT_UNSAFE_CODE) {
          return { state: "default-unsafe" };
        }
      }
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    // The variant may well have been created; this app simply cannot read the
    // answer, so the caller must not report either outcome as certain.
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Replacing a journey's itinerary
// ---------------------------------------------------------------------------

/**
 * Five outcomes. There is no publication refusal and no conflict of any kind:
 * these rows are prose that no booking reads, and the write deletes the
 * itinerary before renumbering it, so the API has nothing else to say.
 */
export type AdminPackageItineraryResult =
  | { state: "ok"; data: AdminPackageDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "package-not-found" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to replace a journey's itinerary.
 *
 * The body carries `sections` and nothing else, and each section is rebuilt
 * field by field rather than spread, so nothing the caller happens to be
 * holding - a position, an id - can reach the wire.
 *
 * PUT, because the body states what the itinerary is: sending it twice leaves
 * the same rows, and the API answers the second as a success that wrote
 * nothing.
 */
export async function replaceAdminPackageItinerary(
  slug: string,
  sections: readonly PackageItinerarySectionInput[],
  cookie?: string,
): Promise<AdminPackageItineraryResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url = `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}/itinerary`;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        sections: sections.map((section) => ({
          dayNumber: section.dayNumber,
          heading: section.heading,
          body: section.body,
        })),
      }),
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

  if (response.status === 400 || response.status === 404) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_PACKAGE_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)) {
        return { state: "invalid" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
      return { state: "package-not-found" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    // The replacement may well have been applied; this app simply cannot read
    // the answer, so the caller must not report either outcome as certain.
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Replacing a journey's content lists
// ---------------------------------------------------------------------------

/**
 * Five outcomes. There is no publication refusal and no conflict of any kind:
 * these rows are prose that no booking reads, and the three named lists
 * cannot express an invalid kind, so the API has nothing else to say.
 */
export type AdminPackageContentResult =
  | { state: "ok"; data: AdminPackageDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "package-not-found" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to replace a journey's three content lists.
 *
 * The body carries exactly `included`, `excluded` and `notes` — the API
 * refuses any other field — so no position, kind, publication or ownership
 * value is sent. All three travel every time: this is a whole-set
 * replacement, and an omitted list would be ambiguous.
 *
 * PUT, because the body states what the lists are: sending it twice leaves
 * the same rows, and the API answers the second as a success that wrote
 * nothing.
 */
export async function replaceAdminPackageContent(
  slug: string,
  content: PackageContentInput,
  cookie?: string,
): Promise<AdminPackageContentResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url = `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}/content`;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PUT",
      headers,
      // Built field by field rather than spread, so nothing the caller
      // happens to be carrying can reach the wire.
      body: JSON.stringify({
        included: content.included,
        excluded: content.excluded,
        notes: content.notes,
      }),
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

  if (response.status === 400 || response.status === 404) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_PACKAGE_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)) {
        return { state: "invalid" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
      return { state: "package-not-found" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    // The replacement may well have been applied; this app simply cannot read
    // the answer, so the caller must not report either outcome as certain.
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Removing a whole journey
// ---------------------------------------------------------------------------

const PACKAGE_IS_BROCHURE_MANAGED_CODE = "PACKAGE_IS_BROCHURE_MANAGED";
const PACKAGE_HAS_RESERVATIONS_CODE = "PACKAGE_HAS_RESERVATIONS";

/**
 * Seven outcomes, and the three conflicts stay apart because each is a
 * different fact about the journey: it is still on sale, its identity belongs
 * to the brochure, or it has sold something. Only the first has a remedy the
 * administrator can reach from here.
 *
 * `ok` carries no journey. The API answers 204 because there is nothing left
 * to describe, and inventing a representation of a deleted row would be the
 * one dishonest thing this client could do.
 */
export type AdminPackageDeleteResult =
  | { state: "ok" }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "must-be-inactive" }
  | { state: "brochure-managed" }
  | { state: "has-reservations" }
  | { state: "package-not-found" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to remove one journey and everything it owns.
 *
 * No body and no content-type: the journey is named in the path, and a
 * removal has nothing else to say. The slug is encoded, so a value carrying a
 * slash or a query string becomes one path segment rather than changing which
 * endpoint is called.
 *
 * Whether the journey is a brochure identity, and whether it has ever been
 * booked, are deliberately not asked before this call. Only the backend can
 * answer either without a race, and the brochure question needs a catalogue
 * this app does not hold.
 */
export async function deleteAdminPackage(
  slug: string,
  cookie?: string,
): Promise<AdminPackageDeleteResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url = `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}`;
  const headers: Record<string, string> = {};

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, { method: "DELETE", headers, cache: "no-store" });
  } catch {
    // The connection dropped. This is a mutation, so the journey may well
    // have been removed before it did: reported as unknown, never as a
    // failure.
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return { state: "unauthenticated" };
  }

  // The success case, and the only one with no body to read.
  if (response.status === 204) {
    return { state: "ok" };
  }

  if (response.status === 400 || response.status === 404 || response.status === 409) {
    const payload = await readJson(response);

    if (response.status === 400 && matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)) {
      return { state: "invalid" };
    }

    if (response.status === 404 && matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
      return { state: "package-not-found" };
    }

    // All three conflicts are matched on their code alone: each names a
    // remedy at length and may be reworded without this client mistaking it
    // for an outage.
    if (response.status === 409 && isRecord(payload) && isRecord(payload.error)) {
      if (payload.error.code === PACKAGE_MUST_BE_INACTIVE_CODE) {
        return { state: "must-be-inactive" };
      }
      if (payload.error.code === PACKAGE_IS_BROCHURE_MANAGED_CODE) {
        return { state: "brochure-managed" };
      }
      if (payload.error.code === PACKAGE_HAS_RESERVATIONS_CODE) {
        return { state: "has-reservations" };
      }
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  // Any other status, including a 200 this endpoint should never send.
  return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
}

// ---------------------------------------------------------------------------
// Removing one variant from a journey
// ---------------------------------------------------------------------------

const PACKAGE_VARIANT_IS_DEFAULT_CODE = "PACKAGE_VARIANT_IS_DEFAULT";
const PACKAGE_VARIANT_HAS_RESERVATIONS_CODE = "PACKAGE_VARIANT_HAS_RESERVATIONS";

/**
 * Eight outcomes. The three conflicts stay apart because each asks the
 * administrator for something completely different: change the journey's
 * availability, choose another default, or nothing at all — a booked variant
 * can never be removed.
 */
export type AdminPackageVariantDeleteResult =
  | { state: "ok"; data: AdminPackageDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "package-inactive-required" }
  | { state: "variant-is-default" }
  | { state: "variant-has-reservations" }
  | { state: "package-not-found" }
  | { state: "variant-not-found" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to remove one variant from a journey.
 *
 * No body at all: the variant is named in the path, and a removal has nothing
 * else to say. Both segments are encoded, so a value carrying a slash or a
 * query string becomes one segment rather than changing which endpoint is
 * called.
 *
 * Whether the variant has ever been booked is deliberately not asked before
 * this call. Only the backend can answer it without a race, and a page old
 * enough to be showing a button is old enough to be wrong about it.
 */
export async function deleteAdminPackageVariant(
  slug: string,
  key: string,
  cookie?: string,
): Promise<AdminPackageVariantDeleteResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url =
    `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}` +
    `/variants/${encodeURIComponent(key)}`;
  const headers: Record<string, string> = {};

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    // No content-type and no body: there is nothing to send.
    response = await fetch(url, { method: "DELETE", headers, cache: "no-store" });
  } catch {
    // The connection dropped. This is a mutation, so the variant may well
    // have been removed before it did: reported as unknown, never as a
    // failure.
    return { state: "unavailable", reason: UNREACHABLE_REASON };
  }

  if (response.status === 401) {
    return { state: "unauthenticated" };
  }

  if (response.status === 400 || response.status === 404 || response.status === 409) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_VARIANT_KEY_ERROR)) {
        return { state: "invalid" };
      }
    }

    if (response.status === 404) {
      if (matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
        return { state: "package-not-found" };
      }
      if (matchesApiError(payload, PACKAGE_VARIANT_NOT_FOUND_ERROR)) {
        return { state: "variant-not-found" };
      }
    }

    // All three conflicts are matched on their code alone: each names a
    // remedy at length and may be reworded without this client mistaking it
    // for an outage.
    if (response.status === 409 && isRecord(payload) && isRecord(payload.error)) {
      if (payload.error.code === PACKAGE_MUST_BE_INACTIVE_CODE) {
        return { state: "package-inactive-required" };
      }
      if (payload.error.code === PACKAGE_VARIANT_IS_DEFAULT_CODE) {
        return { state: "variant-is-default" };
      }
      if (payload.error.code === PACKAGE_VARIANT_HAS_RESERVATIONS_CODE) {
        return { state: "variant-has-reservations" };
      }
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    // The removal may well have happened; this app simply cannot read the
    // answer, so the caller must not report either outcome as certain.
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Rearranging a journey's variants
// ---------------------------------------------------------------------------

const PACKAGE_VARIANT_SET_MISMATCH_CODE = "PACKAGE_VARIANT_SET_MISMATCH";

/**
 * Eight outcomes. The two stale cases stay apart in the type even though the
 * screen words them the same way, because they mean different things about
 * the request: one named a variant the journey does not have, the other left
 * one out.
 */
export type AdminPackageVariantOrderResult =
  | { state: "ok"; data: AdminPackageDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "set-mismatch" }
  | { state: "order-exhausted" }
  | { state: "package-not-found" }
  | { state: "variant-not-found" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to write a journey's variants into the order given.
 *
 * The body carries `variantKeys` and nothing else — the API refuses any other
 * field — so no position, default flag, rate or publication value is sent.
 * The keys travel exactly as the journey reported them.
 *
 * PUT, because the body states the whole order: sending it twice leaves the
 * same arrangement, and the API answers the second one as an idempotent
 * success that wrote nothing.
 */
export async function reorderAdminPackageVariants(
  slug: string,
  variantKeys: readonly string[],
  cookie?: string,
): Promise<AdminPackageVariantOrderResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url = `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}/variant-order`;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ variantKeys }),
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
      if (matchesApiError(payload, INVALID_PACKAGE_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)) {
        return { state: "invalid" };
      }
    }

    if (response.status === 404) {
      if (matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
        return { state: "package-not-found" };
      }
      if (matchesApiError(payload, PACKAGE_VARIANT_NOT_FOUND_ERROR)) {
        return { state: "variant-not-found" };
      }
    }

    // Both conflicts are matched on their code alone: each names a remedy at
    // length and may be reworded without this client mistaking it for an
    // outage.
    if (response.status === 409 && isRecord(payload) && isRecord(payload.error)) {
      if (payload.error.code === PACKAGE_VARIANT_SET_MISMATCH_CODE) {
        return { state: "set-mismatch" };
      }
      if (payload.error.code === PACKAGE_VARIANT_ORDER_EXHAUSTED_ERROR.code) {
        return { state: "order-exhausted" };
      }
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    // The reorder may well have been applied; this app simply cannot read the
    // answer, so the caller must not report either outcome as certain.
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Choosing which variant leads a journey
// ---------------------------------------------------------------------------

/**
 * Seven outcomes. `ok` covers the API's idempotent case too: asking for the
 * variant that already leads is a success there, and a stale page that asks
 * for it is harmless rather than an error to report.
 */
export type AdminPackageDefaultVariantResult =
  | { state: "ok"; data: AdminPackageDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "package-inactive-required" }
  | { state: "package-not-found" }
  | { state: "variant-not-found" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to make one variant the one its journey leads with.
 *
 * The body carries `variantKey` and nothing else — the API refuses any other
 * field — so no default flag, position, rate, publication or ownership value
 * is sent. PUT, because the request states which variant leads: sending it
 * twice leaves the same row leading.
 *
 * The slug is encoded, so a value carrying a slash or a query string becomes
 * one path segment rather than changing which endpoint is called. The key
 * travels in the body exactly as the journey reported it.
 */
export async function setAdminPackageDefaultVariant(
  slug: string,
  variantKey: string,
  cookie?: string,
): Promise<AdminPackageDefaultVariantResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url = `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}/default-variant`;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ variantKey }),
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
      if (matchesApiError(payload, INVALID_PACKAGE_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)) {
        return { state: "invalid" };
      }
    }

    if (response.status === 404) {
      if (matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
        return { state: "package-not-found" };
      }
      if (matchesApiError(payload, PACKAGE_VARIANT_NOT_FOUND_ERROR)) {
        return { state: "variant-not-found" };
      }
    }

    // Matched on the code alone: the message names a remedy at length and may
    // be reworded without this client mistaking it for an outage.
    if (response.status === 409
      && isRecord(payload) && isRecord(payload.error)
      && payload.error.code === PACKAGE_MUST_BE_INACTIVE_CODE) {
      return { state: "package-inactive-required" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    // The switch may well have been applied; this app simply cannot read the
    // answer, so the caller must not report either outcome as certain.
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Editing one variant
// ---------------------------------------------------------------------------

const PACKAGE_VARIANT_NOT_FOUND_ERROR = {
  code: "PACKAGE_VARIANT_NOT_FOUND",
  message: "Package variant not found",
} as const;

const INVALID_PACKAGE_VARIANT_KEY_ERROR = {
  code: "INVALID_PACKAGE_VARIANT_KEY",
  message: "Invalid package variant key",
} as const;

/**
 * Six outcomes. The two ways of not finding the variant stay apart because an
 * administrator who mistyped the journey needs to go somewhere different from
 * one who mistyped the variant — even though this app renders both as the
 * route-local not-found.
 */
export type AdminPackageVariantUpdateResult =
  | { state: "ok"; data: AdminPackageDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "package-not-found" }
  | { state: "variant-not-found" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to rewrite one variant's metadata.
 *
 * The body carries exactly the four editable fields. The variant's key, its
 * default state, its order and its rates are not sent — the API refuses a
 * body offering any of them — and neither is anything about ownership, which
 * moves as a consequence of the edit.
 *
 * Both path segments are encoded, so a value carrying a slash or a query
 * string becomes one segment rather than changing which endpoint is called.
 */
export async function updateAdminPackageVariant(
  slug: string,
  key: string,
  input: PackageVariantUpdateInput,
  cookie?: string,
): Promise<AdminPackageVariantUpdateResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url =
    `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}` +
    `/variants/${encodeURIComponent(key)}`;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(input),
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

  if (response.status === 400 || response.status === 404) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_PACKAGE_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_VARIANT_KEY_ERROR)) {
        return { state: "invalid" };
      }
    }

    if (response.status === 404) {
      if (matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
        return { state: "package-not-found" };
      }
      if (matchesApiError(payload, PACKAGE_VARIANT_NOT_FOUND_ERROR)) {
        return { state: "variant-not-found" };
      }
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    // The edit may well have been applied; this app simply cannot read the
    // answer, so the caller must not report either outcome as certain.
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Replacing one variant's rate tiers
// ---------------------------------------------------------------------------

const OVERLAPPING_RATE_TIERS_ERROR = {
  code: "OVERLAPPING_RATE_TIERS",
  message: "Rate tiers must not cover overlapping party sizes",
} as const;

const PACKAGE_RATES_REQUIRED_CODE = "PACKAGE_RATES_REQUIRED";

/**
 * Seven outcomes. The two conflicts stay apart because the administrator must
 * do something different about each: rearrange the tiers, or change the
 * journey's publication or pricing mode first.
 */
export type AdminPackageRatesResult =
  | { state: "ok"; data: AdminPackageDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "overlapping" }
  | { state: "rates-required" }
  | { state: "package-not-found" }
  | { state: "variant-not-found" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to replace one variant's whole rate set.
 *
 * The body carries `rates` and nothing else. No currency is sent: USD is the
 * server's, stated by a CHECK and written as a literal, and offering it would
 * be a value the API could only refuse.
 */
export async function replaceAdminPackageRates(
  slug: string,
  key: string,
  rates: readonly PackageRateTierInput[],
  cookie?: string,
): Promise<AdminPackageRatesResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url =
    `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}` +
    `/variants/${encodeURIComponent(key)}/rates`;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ rates }),
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
      if (matchesApiError(payload, INVALID_PACKAGE_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_VARIANT_KEY_ERROR)) {
        return { state: "invalid" };
      }
    }

    if (response.status === 404) {
      if (matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
        return { state: "package-not-found" };
      }
      if (matchesApiError(payload, PACKAGE_VARIANT_NOT_FOUND_ERROR)) {
        return { state: "variant-not-found" };
      }
    }

    if (response.status === 409) {
      if (matchesApiError(payload, OVERLAPPING_RATE_TIERS_ERROR)) {
        return { state: "overlapping" };
      }
      // The rates-required message names two remedies and may be reworded;
      // matched on its code alone, which is the part that is contracted.
      if (isRecord(payload) && isRecord(payload.error)
        && payload.error.code === PACKAGE_RATES_REQUIRED_CODE) {
        return { state: "rates-required" };
      }
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    // The replacement may well have been applied; this app simply cannot read
    // the answer, so the caller must not report either outcome as certain.
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}

// ---------------------------------------------------------------------------
// Offering a journey, or withdrawing it
// ---------------------------------------------------------------------------

const INVALID_PACKAGE_STATUS_ERROR = {
  code: "INVALID_PACKAGE_STATUS",
  message: "Invalid package status",
} as const;

/**
 * Five outcomes, kept apart on purpose.
 *
 * There is deliberately no conflict state: the API treats asking for the
 * state a journey already holds as an ordinary success, so a second click is
 * never an error here either.
 */
export type AdminPackageStatusUpdateResult =
  | { state: "ok"; data: AdminPackageDetail }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "not-found" }
  | { state: "unavailable"; reason: string };

/**
 * Asks the API to offer one journey to guests, or to withdraw it.
 *
 * The body carries `isActive` and nothing else — no slug, no wording, no
 * ownership. Those are the API's to read from its own row, and a request that
 * offered them would be asking it to take this app's word for facts it holds.
 *
 * The slug is encoded into one path segment, exactly as the read does.
 *
 * On success the API returns the whole updated journey, so the caller never
 * has to assume the new state: it is read back, not inferred from what was
 * asked for.
 */
export async function updateAdminPackageStatus(
  slug: string,
  isActive: boolean,
  cookie?: string,
): Promise<AdminPackageStatusUpdateResult> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { state: "unavailable", reason: MISCONFIGURED_REASON };
    }

    throw error;
  }

  const url = `${baseUrl}${ADMIN_PACKAGES_PATH}/${encodeURIComponent(slug)}/status`;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ isActive }),
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

  if (response.status === 400 || response.status === 404) {
    const payload = await readJson(response);

    if (response.status === 400) {
      if (matchesApiError(payload, INVALID_PACKAGE_SLUG_ERROR)
        || matchesApiError(payload, INVALID_PACKAGE_STATUS_ERROR)) {
        return { state: "invalid" };
      }
    }

    if (response.status === 404 && matchesApiError(payload, PACKAGE_NOT_FOUND_ERROR)) {
      return { state: "not-found" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  const payload = await readJson(response);

  if (payload === undefined) {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const data = toPackageDetail(payload);

  if (!data) {
    return { state: "unavailable", reason: "The hotel API returned an unexpected journey response." };
  }

  return { state: "ok", data };
}
