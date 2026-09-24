"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseCapacityForm, parseRoomTypeCreateForm } from "../lib/inventoryForms";
import {
  planRoomTypeCapacity,
  planRoomTypeCreate,
  type InventoryOutcome,
  type RevalidationScope,
} from "../lib/inventoryOutcomes";
import { ROOM_TYPES_NEW_PATH, ROOM_TYPES_PATH, roomTypeDetailHref } from "../lib/roomTypes";
import type { AdminRoomTypeUpdate } from "../types";
import {
  createAdminRoomType,
  updateAdminRoomType,
  updateAdminRoomTypeCapacity,
} from "./adminRoomTypesApi";

// The one way the administration UI edits a room type.
//
// It runs on the server and calls Express directly through the server-only
// client, so the browser never learns the API's address and never holds a
// session token. The form posts to Next, not to the API.
//
// The API remains the authority on what may be edited and what a valid value
// is; the checks here exist only to stop an obviously bad submission before it
// becomes a round trip, and to turn form strings into the typed shape the
// client expects.

/** Display hints this action may hand back to the page. Never anything else. */
export type RoomTypeActionNotice = "saved" | "refused" | "uncertain";

const MAX_LENGTHS = {
  name: 120,
  shortDescription: 300,
  description: 2000,
  bedType: 60,
  view: 120,
} as const;

// Mirrored from the API's own validator, so an obviously invalid value is
// caught here rather than after a round trip. The API still decides.
const BASE_NIGHTLY_RATE_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;
const SIZE_SQM_PATTERN = /^\d{1,4}(?:\.\d{1,2})?$/;
const HAS_NON_ZERO_DIGIT = /[1-9]/;
const WHOLE_NUMBER_PATTERN = /^\d+$/;

/** Raised only for a submission this action can already see is unusable. */
class InvalidSubmissionError extends Error {}

function field(form: FormData, name: string): string {
  const value = form.get(name);

  // A file, or a field the form never carried, is not a value this form sends.
  if (typeof value !== "string") {
    throw new InvalidSubmissionError();
  }

  return value;
}

/** Required text: trimmed, then required to still say something. */
function requiredText(form: FormData, name: string, maxLength: number): string {
  const trimmed = field(form, name).trim();

  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new InvalidSubmissionError();
  }

  return trimmed;
}

/**
 * Optional text: an empty box means "no value", not an empty string. The API
 * stores null for both, so the form says so plainly.
 */
function optionalText(form: FormData, name: string, maxLength: number): string | null {
  const trimmed = field(form, name).trim();

  if (trimmed.length > maxLength) {
    throw new InvalidSubmissionError();
  }

  return trimmed.length === 0 ? null : trimmed;
}

function optionalCount(form: FormData, name: string, minimum: number): number | null {
  const raw = field(form, name).trim();

  if (raw.length === 0) {
    return null;
  }

  if (!WHOLE_NUMBER_PATTERN.test(raw)) {
    throw new InvalidSubmissionError();
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new InvalidSubmissionError();
  }

  return parsed;
}

function requiredCount(form: FormData, name: string, minimum: number): number {
  const value = optionalCount(form, name, minimum);

  if (value === null) {
    throw new InvalidSubmissionError();
  }

  return value;
}

/**
 * A decimal carried as a string from the form to PostgreSQL.
 *
 * Never parsed with `Number`: the point of a `numeric` column is that 1234.55
 * is exactly 1234.55, and routing it through a float to check it would be the
 * one place that stops being true. The pattern bounds the digits on each side
 * of the point, which is the precision check.
 */
function requiredDecimal(form: FormData, name: string, pattern: RegExp): string {
  const raw = field(form, name).trim();

  if (raw.length === 0 || !pattern.test(raw)) {
    throw new InvalidSubmissionError();
  }

  return raw;
}

/**
 * The same, but an empty box means "not recorded". `positive` rejects a value
 * whose digits are all zero, for a column whose CHECK requires more than none.
 */
function optionalDecimal(
  form: FormData,
  name: string,
  pattern: RegExp,
  options: { positive: boolean },
): string | null {
  const raw = field(form, name).trim();

  if (raw.length === 0) {
    return null;
  }

  if (!pattern.test(raw)) {
    throw new InvalidSubmissionError();
  }

  if (options.positive && !HAS_NON_ZERO_DIGIT.test(raw)) {
    throw new InvalidSubmissionError();
  }

  return raw;
}

/**
 * Builds the update from an explicit allowlist of the nine editable fields.
 *
 * Nothing is read from the submission except these names, so no extra input a
 * page happened to carry — and nothing a crafted post added — can reach the
 * API. `slug`, `capacity`, `isActive`, `id`, `roomCount`, `currency` and the
 * timestamps are not read at all.
 */
function buildUpdate(form: FormData): AdminRoomTypeUpdate {
  return {
    name: requiredText(form, "name", MAX_LENGTHS.name),
    shortDescription: optionalText(form, "shortDescription", MAX_LENGTHS.shortDescription),
    description: optionalText(form, "description", MAX_LENGTHS.description),
    bedType: optionalText(form, "bedType", MAX_LENGTHS.bedType),
    bedCount: optionalCount(form, "bedCount", 1),
    sizeSqm: optionalDecimal(form, "sizeSqm", SIZE_SQM_PATTERN, { positive: true }),
    view: optionalText(form, "view", MAX_LENGTHS.view),
    // Zero is a legitimate base rate — a type may be priced on request — so
    // this one is not required to be positive, only to be a valid decimal.
    baseNightlyRate: requiredDecimal(form, "baseNightlyRate", BASE_NIGHTLY_RATE_PATTERN),
    sortOrder: requiredCount(form, "sortOrder", 0),
  };
}

function noticeHref(slug: string, notice: RoomTypeActionNotice): string {
  // The slug stays one encoded path segment; the notice is a fixed token from
  // the union above, never caller text.
  return `${roomTypeDetailHref(slug)}?action=${notice}`;
}

/**
 * Re-reads both places this room type appears, so whatever the page shows next
 * comes from the database rather than from a cached copy taken before the
 * change.
 */
function revalidateRoomType(slug: string): void {
  revalidatePath(roomTypeDetailHref(slug));
  revalidatePath(ROOM_TYPES_PATH);
}

/**
 * Saves changes to one room type.
 *
 * Bound per form to the slug the server itself rendered, never read from the
 * submission — a Server Action is a public endpoint, and the slug decides
 * which room type is written.
 *
 * Every path ends in a redirect back to the room type, so what appears on
 * screen afterwards is always freshly read rather than assumed from what was
 * asked for.
 */
export async function updateRoomTypeAction(slug: string, formData: FormData): Promise<void> {
  // Treated as untrusted despite the bound type.
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(ROOM_TYPES_PATH);
  }

  let update: AdminRoomTypeUpdate;

  try {
    update = buildUpdate(formData);
  } catch (error) {
    // Only a value this action could already see was unusable. Anything else
    // is a fault, not a rejected submission, and is left to surface as one
    // rather than being explained to an administrator as a bad entry.
    if (!(error instanceof InvalidSubmissionError)) {
      throw error;
    }

    // Refused before it became a request. Deliberately not reported as an API
    // failure: nothing was asked of the API.
    redirect(noticeHref(slug, "refused"));
  }

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await updateAdminRoomType(slug, update, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      revalidateRoomType(slug);
      redirect(noticeHref(slug, "saved"));

    case "unauthenticated":
      // The session ended between the page rendering and Save being pressed.
      // Nothing was changed.
      redirect("/admin/login");

    case "invalid-update":
      redirect(noticeHref(slug, "refused"));

    case "invalid-reference":
    case "not-found":
      // Either there is no such room type or its slug is not one. The detail
      // page decides how that reads — it renders the route-local not-found —
      // rather than this action inventing a state for it.
      revalidatePath(ROOM_TYPES_PATH);
      redirect(roomTypeDetailHref(slug));

    case "unavailable":
      // Deliberately not reported as a failure. A PATCH whose connection
      // dropped may well have committed first, so the only honest answer is
      // that the outcome is unknown — and the refreshed page is where to find
      // out. Never retried automatically.
      revalidateRoomType(slug);
      redirect(noticeHref(slug, "uncertain"));
  }
}

// ---------------------------------------------------------------------------
// Creating a room type, and changing its capacity.
//
// Both follow the pattern established above: read the browser's own Cookie
// server-side, build the payload from an explicit allowlist, call the
// server-only client once, and end in a redirect so what appears on screen
// afterwards is freshly read rather than assumed.
//
// What each answer means — which notice, which page, what to re-read — lives
// in `lib/inventoryOutcomes.ts`, which is pure and tested directly. These
// functions do what the plan says and nothing more.
// ---------------------------------------------------------------------------

/** Re-reads whichever canonical admin paths the plan named. */
function applyRevalidation(scope: RevalidationScope, slug: string): void {
  if (scope === "list" || scope === "list-and-detail") {
    revalidatePath(ROOM_TYPES_PATH);
  }

  if (scope === "detail" || scope === "list-and-detail") {
    revalidatePath(roomTypeDetailHref(slug));
  }
}

/**
 * The address a planned notice is shown at.
 *
 * The token is a fixed value from a closed set, never caller text, and the
 * slug is one encoded path segment. Nothing an administrator typed is put into
 * a query parameter to make a message dynamic.
 */
function outcomeHref(outcome: Extract<InventoryOutcome, { kind: "notice" }>, slug: string): string {
  switch (outcome.surface) {
    case "list":
      return `${ROOM_TYPES_PATH}?action=${outcome.token}`;
    case "new":
      return `${ROOM_TYPES_NEW_PATH}?action=${outcome.token}`;
    case "detail":
      return `${roomTypeDetailHref(slug)}?action=${outcome.token}`;
  }
}

/**
 * Carries out a plan. Always ends by throwing, because every path redirects.
 *
 * `redirect()` works by throwing, so this is deliberately called outside any
 * try/catch.
 */
function completeOutcome(outcome: InventoryOutcome, slug: string): never {
  if (outcome.kind === "login") {
    // The session ended between the page rendering and the button being
    // pressed. Never retried automatically after signing in again.
    redirect("/admin/login");
  }

  applyRevalidation(outcome.revalidate, slug);

  if (outcome.kind === "stale") {
    // No notice: the detail page renders its own not-found rather than this
    // action inventing a state for it.
    redirect(roomTypeDetailHref(slug));
  }

  redirect(outcomeHref(outcome, slug));
}

/**
 * Creates one room type.
 *
 * The API stores it as an inactive draft with no physical rooms; nothing here
 * asks for that, and `isActive` is not a field this form can carry.
 *
 * On confirmed success the administrator lands on the new room type, because
 * adding rooms is what comes next. On an unconfirmed outcome they land on the
 * refreshed list instead — it is the only place that can answer whether the
 * room type exists.
 */
export async function createAdminRoomTypeAction(formData: FormData): Promise<void> {
  const parsed = parseRoomTypeCreateForm(formData);

  if (!parsed.ok) {
    // Refused before it became a request. Deliberately not reported as an API
    // failure: nothing was asked of the API.
    redirect(`${ROOM_TYPES_NEW_PATH}?action=create-refused`);
  }

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await createAdminRoomType(parsed.value, cookie);

  // The slug the API confirmed on success, so the redirect never points at a
  // room type the caller merely asked for; the submitted one otherwise, which
  // is only ever used to build a path that carries no slug.
  const slug = result.state === "ok" ? result.data.slug : parsed.value.slug;

  completeOutcome(planRoomTypeCreate(result.state), slug);
}

/**
 * Changes one room type's capacity.
 *
 * Bound per form to the slug the server itself rendered, never read from the
 * submission — a Server Action is a public endpoint, and the slug decides
 * which room type is written.
 *
 * A refusal because upcoming stays are booked for more guests carries no
 * count, reference, date or guest: the API returns none, and a refusal is not
 * a place to read reservation data out of.
 */
export async function updateAdminRoomTypeCapacityAction(
  slug: string,
  formData: FormData,
): Promise<void> {
  // Treated as untrusted despite the bound type.
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(ROOM_TYPES_PATH);
  }

  const parsed = parseCapacityForm(formData);

  if (!parsed.ok) {
    redirect(`${roomTypeDetailHref(slug)}?action=capacity-refused`);
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await updateAdminRoomTypeCapacity(slug, parsed.value, cookie);

  completeOutcome(planRoomTypeCapacity(result.state), slug);
}
