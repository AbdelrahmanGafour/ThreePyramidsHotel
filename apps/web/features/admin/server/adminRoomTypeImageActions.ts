"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseAltTextForm, parseImageUploadForm, parseOrderDirection } from "../lib/imageForms";
import {
  planRoomTypeImageAltText,
  planRoomTypeImageCover,
  planRoomTypeImageDelete,
  planRoomTypeImageMove,
  planRoomTypeImageUpload,
  type RoomTypeImageOutcome,
  type RoomTypeImageRevalidation,
} from "../lib/imageOutcomes";
import { ROOM_TYPES_PATH, roomTypeDetailHref } from "../lib/roomTypes";
import {
  deleteAdminRoomTypeImage,
  moveAdminRoomTypeImage,
  setAdminRoomTypeImageCover,
  updateAdminRoomTypeImageAltText,
  uploadAdminRoomTypeImage,
} from "./adminRoomTypeImagesApi";

// The mutation boundary between a future admin Images panel and the
// server-only media API client. It runs on the server, calls Express
// directly, and never lets the browser learn the API's address or hold a
// session token — the same shape as `adminRoomTypeActions.ts`.
//
// Every image outcome ever lands on one page — the room type's own detail
// page — so unlike the room-type actions above, nothing here chooses between
// several surfaces or revalidation scopes. What each API answer means lives
// in `lib/imageOutcomes.ts`, which is pure and tested directly; these
// functions do what the plan says and nothing more.
//
// No Images panel, file input, or `<Image>` usage exists yet to call these.
// They exist fully formed and fully tested ahead of that UI.

/** Re-reads the room type's detail page when the plan calls for it. */
function applyRevalidation(scope: RoomTypeImageRevalidation, slug: string): void {
  if (scope === "detail") {
    revalidatePath(roomTypeDetailHref(slug));
  }
}

/**
 * The address a planned notice is shown at: the detail page, with a fixed
 * token from the closed set in `imageOutcomes.ts`, never caller text.
 */
function outcomeHref(token: string, slug: string): string {
  return `${roomTypeDetailHref(slug)}?action=${token}`;
}

/**
 * Carries out a plan. Always ends by throwing, because every path redirects.
 *
 * `redirect()` works by throwing, so this is deliberately called outside any
 * try/catch, exactly like `completeOutcome` in `adminRoomTypeActions.ts`.
 */
function completeOutcome(outcome: RoomTypeImageOutcome, slug: string): never {
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

  redirect(outcomeHref(outcome.token, slug));
}

/** The browser's own Cookie header, forwarded verbatim. Never parsed here. */
async function cookieHeader(): Promise<string | undefined> {
  return (await headers()).get("cookie") ?? undefined;
}

/**
 * Uploads one image to a room type's gallery.
 *
 * Bound per form to the slug the server itself rendered, never read from the
 * submission. A missing or non-`File` `image` field is refused before it
 * becomes a request — reusing `planRoomTypeImageUpload("invalid-image")`
 * rather than a second, locally-invented notice, so a client-side refusal and
 * the API's own `INVALID_IMAGE_UPLOAD` read identically to an administrator.
 * Local file-size checking is deliberately absent: the API alone decides what
 * counts as too large, at the moment it actually reads the bytes.
 */
export async function uploadAdminRoomTypeImageAction(slug: string, formData: FormData): Promise<void> {
  // Treated as untrusted despite the bound type.
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(ROOM_TYPES_PATH);
  }

  const parsed = await parseImageUploadForm(formData);

  if (!parsed.ok) {
    completeOutcome(planRoomTypeImageUpload("invalid-image"), slug);
  }

  const cookie = await cookieHeader();
  const result = await uploadAdminRoomTypeImage(slug, parsed.value, cookie);

  completeOutcome(planRoomTypeImageUpload(result.state), slug);
}

/**
 * Replaces one image's alt text.
 *
 * `imageReference` is a second bound value, no less untrusted than `slug`: a
 * Server Action is a public endpoint, and both are serialised into the
 * request rather than protected by having been "already chosen" in a
 * rendered page. A locally malformed reference is answered with the same
 * `image-not-found`-style notice the API's own `invalid-image-reference`
 * produces — reusing the plan for that state rather than inventing a
 * duplicate one, since neither this process nor the API can tell a garbled
 * reference apart from one that simply does not exist.
 */
export async function updateAdminRoomTypeImageAltTextAction(
  slug: string,
  imageReference: string,
  formData: FormData,
): Promise<void> {
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(ROOM_TYPES_PATH);
  }

  if (typeof imageReference !== "string" || imageReference.length === 0) {
    completeOutcome(planRoomTypeImageAltText("invalid-image-reference"), slug);
  }

  const parsed = parseAltTextForm(formData);

  if (!parsed.ok) {
    completeOutcome(planRoomTypeImageAltText("invalid-update"), slug);
  }

  const cookie = await cookieHeader();
  const result = await updateAdminRoomTypeImageAltText(slug, imageReference, parsed.value, cookie);

  completeOutcome(planRoomTypeImageAltText(result.state), slug);
}

/**
 * Makes one image the room type's cover. No mutable payload: the route names
 * the action, so there is nothing here for a form to submit beyond the two
 * bound identifiers.
 */
export async function setAdminRoomTypeImageCoverAction(slug: string, imageReference: string): Promise<void> {
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(ROOM_TYPES_PATH);
  }

  if (typeof imageReference !== "string" || imageReference.length === 0) {
    completeOutcome(planRoomTypeImageCover("invalid-image-reference"), slug);
  }

  const cookie = await cookieHeader();
  const result = await setAdminRoomTypeImageCover(slug, imageReference, cookie);

  completeOutcome(planRoomTypeImageCover(result.state), slug);
}

/**
 * Moves one image one step through its gallery.
 *
 * `direction` arrives as a third bound value, typed as a plain `string`
 * rather than `MediaOrderDirection`: a bound argument is not a security
 * boundary, so this action must be able to receive — and refuse — a value
 * that is neither `"up"` nor `"down"` rather than assuming the type system
 * already ruled that out. `parseOrderDirection` is the one check that
 * happens before the API ever sees it; the API remains authoritative on
 * whether a move is actually possible at the requested boundary.
 */
export async function moveAdminRoomTypeImageAction(
  slug: string,
  imageReference: string,
  direction: string,
): Promise<void> {
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(ROOM_TYPES_PATH);
  }

  if (typeof imageReference !== "string" || imageReference.length === 0) {
    completeOutcome(planRoomTypeImageMove("invalid-image-reference"), slug);
  }

  const parsedDirection = parseOrderDirection(direction);

  if (parsedDirection === null) {
    completeOutcome(planRoomTypeImageMove("invalid-direction"), slug);
  }

  const cookie = await cookieHeader();
  const result = await moveAdminRoomTypeImage(slug, imageReference, parsedDirection, cookie);

  completeOutcome(planRoomTypeImageMove(result.state), slug);
}

/**
 * Removes one image from a room type. No request body: there is nothing a
 * form could submit beyond the two bound identifiers. A confirmed deletion
 * is reported as deleted regardless of the API's own, unexposed
 * storage-cleanup outcome — this action does not interpret a 204 as a
 * guarantee that the underlying object left R2, because the API's own
 * contract makes no such guarantee either.
 */
export async function deleteAdminRoomTypeImageAction(slug: string, imageReference: string): Promise<void> {
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(ROOM_TYPES_PATH);
  }

  if (typeof imageReference !== "string" || imageReference.length === 0) {
    completeOutcome(planRoomTypeImageDelete("invalid-image-reference"), slug);
  }

  const cookie = await cookieHeader();
  const result = await deleteAdminRoomTypeImage(slug, imageReference, cookie);

  completeOutcome(planRoomTypeImageDelete(result.state), slug);
}
