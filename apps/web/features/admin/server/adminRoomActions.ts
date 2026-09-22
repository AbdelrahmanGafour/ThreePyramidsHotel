"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseRoomNumberForm } from "../lib/inventoryForms";
import {
  planPhysicalRoomAdd,
  planPhysicalRoomRename,
  planPhysicalRoomStatus,
  type InventoryOutcome,
  type RevalidationScope,
} from "../lib/inventoryOutcomes";
import { ROOM_TYPES_PATH, roomTypeDetailHref } from "../lib/roomTypes";
import { createAdminPhysicalRoom, updateAdminPhysicalRoom } from "./adminRoomsApi";

// The three ways the administration UI changes the hotel's physical rooms.
//
// They run on the server and call Express directly through the server-only
// client, so the browser never learns the API's address and never holds a
// session token. Each form posts to Next, not to the API.
//
// Every one is narrow: one operation, one payload shape, one set of outcomes.
// There is deliberately no general "change this room" action — a rename and a
// status change fail in different ways and deserve different messages.
//
// The room type's slug and the room's *current* number are bound by the
// server-rendered page, never read from the submission. A Server Action is a
// public endpoint, and those two values decide which row is written.
//
// What each answer means — which notice, what to re-read — lives in
// `lib/inventoryOutcomes.ts`, which is pure and tested directly. These
// functions do what the plan says and nothing more.
//
// None of them retries. The client issues exactly one request; an answer that
// never arrived may still have committed, and repeating it could add a second
// room or rename something twice.

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
 * Carries out a plan. Always ends by throwing, because every path redirects.
 *
 * Every physical-room notice is shown on its room type's detail page — a room
 * has no page of its own in this release — so the surface is always the
 * detail path. The token is a fixed value from a closed set, and the slug is
 * one encoded path segment: no submitted room number reaches a query
 * parameter.
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
    // No notice: the detail page decides how an unresolvable resource reads,
    // rather than this action inventing a state for it.
    redirect(roomTypeDetailHref(slug));
  }

  redirect(`${roomTypeDetailHref(slug)}?action=${outcome.token}`);
}

/** Both room actions share this check on the bound room type. */
function requireBoundSlug(slug: string): void {
  // Treated as untrusted despite the bound type.
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(ROOM_TYPES_PATH);
  }
}

/**
 * Adds one physical room to a room type.
 *
 * The room number is sent exactly as submitted — the API trims it before
 * storage and refuses what it cannot store. Normalising it here would mean
 * creating a room with a number the administrator never typed.
 *
 * The room type may be active or a draft; adding inventory changes nothing
 * publicly either way, and nothing here publishes a room type.
 */
export async function addAdminPhysicalRoomAction(slug: string, formData: FormData): Promise<void> {
  requireBoundSlug(slug);

  const parsed = parseRoomNumberForm(formData);

  if (!parsed.ok) {
    // Refused before it became a request. Deliberately not reported as an API
    // failure: nothing was asked of the API.
    redirect(`${roomTypeDetailHref(slug)}?action=room-add-refused`);
  }

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await createAdminPhysicalRoom(slug, { roomNumber: parsed.value }, cookie);

  completeOutcome(planPhysicalRoomAdd(result.state), slug);
}

/**
 * Changes one physical room's number.
 *
 * `currentRoomNumber` is the room's number as the page rendered it, bound on
 * the server; the replacement comes from the form. If someone else renamed the
 * room in between, the API answers `not-found` and nothing is written — the
 * refreshed panel then shows what the rooms are actually called.
 *
 * A successful rename answers with a different number, which is expected.
 *
 * After an unconfirmed outcome the old number is never retried: the rename may
 * already have committed, in which case that number no longer resolves.
 */
export async function renameAdminPhysicalRoomAction(
  roomTypeSlug: string,
  currentRoomNumber: string,
  formData: FormData,
): Promise<void> {
  requireBoundSlug(roomTypeSlug);

  if (typeof currentRoomNumber !== "string" || currentRoomNumber.length === 0) {
    redirect(roomTypeDetailHref(roomTypeSlug));
  }

  const parsed = parseRoomNumberForm(formData);

  if (!parsed.ok) {
    redirect(`${roomTypeDetailHref(roomTypeSlug)}?action=room-rename-refused`);
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await updateAdminPhysicalRoom(
    currentRoomNumber,
    { roomNumber: parsed.value },
    cookie,
  );

  completeOutcome(planPhysicalRoomRename(result.state), roomTypeSlug);
}

/**
 * Takes one physical room in or out of service.
 *
 * `targetIsActive` is a bound server argument, not a form field: which
 * direction the button means is decided by the page that rendered it rather
 * than by an editable field. It is still re-checked below, because binding
 * keeps a value out of the form — it does not make it trustworthy.
 * `formData` is accepted so the action fits an ordinary
 * `<form action={boundAction}>`, and is deliberately never read.
 *
 * Taking a room out of service can be refused when guests are already booked
 * into it. That refusal carries no count, reference, date or guest — the API
 * returns none, and there is no way in this system to move a stay to another
 * room.
 */
export async function setAdminPhysicalRoomActiveAction(
  roomTypeSlug: string,
  roomNumber: string,
  targetIsActive: boolean,
  // Declared so the bound action matches what `<form action={…}>` passes, and
  // deliberately never read: the direction is a server argument, not a field.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<void> {
  requireBoundSlug(roomTypeSlug);

  if (typeof roomNumber !== "string" || roomNumber.length === 0) {
    redirect(roomTypeDetailHref(roomTypeSlug));
  }

  // A real boolean, from the server. Anything else is a wiring mistake, not a
  // request to interpret.
  if (typeof targetIsActive !== "boolean") {
    redirect(roomTypeDetailHref(roomTypeSlug));
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await updateAdminPhysicalRoom(roomNumber, { isActive: targetIsActive }, cookie);

  completeOutcome(planPhysicalRoomStatus(result.state, targetIsActive), roomTypeSlug);
}
