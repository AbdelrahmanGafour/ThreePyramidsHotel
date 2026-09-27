"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseAltTextForm, parseImageUploadForm } from "../lib/imageForms";
import {
  planPackageImageAltText,
  planPackageImageDelete,
  planPackageImageReplace,
  planPackageImageUpload,
  type PackageImageOutcome,
  type PackageImageRevalidation,
} from "../lib/packageImageOutcomes";
import { PACKAGES_PATH, packageDetailHref } from "../lib/packages";
import {
  deleteAdminPackageImage,
  replaceAdminPackageImage,
  updateAdminPackageImageAltText,
  uploadAdminPackageImage,
} from "./adminPackageImagesApi";

// The mutation boundary between the journey image panel and the server-only
// media API client. It runs on the server, calls Express directly, and never
// lets the browser learn the API's address or hold a session token — the
// same shape as `adminPackageActions.ts` and `adminRoomTypeImageActions.ts`.
//
// Every image outcome lands on one page, the journey's own detail page, so
// nothing here chooses between surfaces. What each API answer means lives in
// `lib/packageImageOutcomes.ts`, which is pure and tested directly; these
// functions do what the plan says and nothing more.
//
// Nothing is retried. An upload whose outcome is unknown is reported as
// unknown and the journey is re-read, never sent again on the
// administrator's behalf.

/** Re-reads the journey's detail page when the plan calls for it. */
function applyRevalidation(scope: PackageImageRevalidation, slug: string): void {
  if (scope === "detail") {
    revalidatePath(packageDetailHref(slug));
  }
}

/**
 * The address a planned notice is shown at: the detail page, with a fixed
 * token from the closed set in `packageImageOutcomes.ts`, never caller text.
 */
function outcomeHref(token: string, slug: string): string {
  return `${packageDetailHref(slug)}?image=${token}`;
}

/**
 * Carries out a plan. Always ends by throwing, because every path redirects.
 *
 * `redirect()` works by throwing, so this is deliberately called outside any
 * try/catch, exactly like `completeOutcome` in the room-type image actions.
 */
function completeOutcome(outcome: PackageImageOutcome, slug: string): never {
  if (outcome.kind === "login") {
    // The session ended between the page rendering and the button being
    // pressed. Never retried automatically after signing in again.
    redirect("/admin/login");
  }

  applyRevalidation(outcome.revalidate, slug);

  if (outcome.kind === "stale") {
    // No notice: the detail page renders its own not-found rather than this
    // action inventing a state for it.
    redirect(packageDetailHref(slug));
  }

  redirect(outcomeHref(outcome.token, slug));
}

/** The browser's own Cookie header, forwarded verbatim. Never parsed here. */
async function cookieHeader(): Promise<string | undefined> {
  return (await headers()).get("cookie") ?? undefined;
}

/** Treated as untrusted despite the bound type: a Server Action is public. */
function requireSlug(slug: string): void {
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(PACKAGES_PATH);
  }
}

/**
 * Adds the one image a journey does not have yet.
 *
 * Bound per form to the slug the server itself rendered, never read from the
 * submission. A missing or non-`File` field is refused before it becomes a
 * request, reusing `planPackageImageUpload("invalid-image")` rather than a
 * second locally-invented notice, so a local refusal and the API's own
 * `INVALID_IMAGE_UPLOAD` read identically to an administrator.
 *
 * No local size or type check. The API alone decides what counts as too
 * large or unsupported, at the moment it actually reads the bytes — the same
 * decision the room-type upload action already made, and the reason a second
 * ceiling cannot drift from the first.
 */
export async function uploadPackageImageAction(slug: string, formData: FormData): Promise<void> {
  requireSlug(slug);

  const parsed = await parseImageUploadForm(formData);

  if (!parsed.ok) {
    completeOutcome(planPackageImageUpload("invalid-image"), slug);
  }

  const cookie = await cookieHeader();
  const result = await uploadAdminPackageImage(slug, parsed.value, cookie);

  completeOutcome(planPackageImageUpload(result.state), slug);
}

/**
 * Swaps the image a journey already has.
 *
 * A separate action from the upload rather than one that guesses: the API
 * refuses `POST` when an image exists and `PUT` when none does, and keeping
 * those apart is what turns a stale page into a clear conflict instead of a
 * silent overwrite.
 */
export async function replacePackageImageAction(slug: string, formData: FormData): Promise<void> {
  requireSlug(slug);

  const parsed = await parseImageUploadForm(formData);

  if (!parsed.ok) {
    completeOutcome(planPackageImageReplace("invalid-image"), slug);
  }

  const cookie = await cookieHeader();
  const result = await replaceAdminPackageImage(slug, parsed.value, cookie);

  completeOutcome(planPackageImageReplace(result.state), slug);
}

/** Removes a journey's image. The form posts no body at all. */
export async function deletePackageImageAction(slug: string): Promise<void> {
  requireSlug(slug);

  const cookie = await cookieHeader();
  const result = await deleteAdminPackageImage(slug, cookie);

  completeOutcome(planPackageImageDelete(result.state), slug);
}

/**
 * Replaces the image's description.
 *
 * The submitted text is passed on exactly as typed. Trimming, and turning
 * anything empty into "no description", is `normalizeAltText`'s decision in
 * the API — repeating it here would be a second copy able to disagree with
 * the first, and the value the panel shows afterwards is the one the API
 * stored rather than the one the browser sent.
 *
 * An absent field is refused rather than read as a request to clear the
 * description: leaving a field out and asking to clear it are different
 * requests, and a form that lost its input should not erase somebody's work.
 */
export async function updatePackageImageAltTextAction(
  slug: string,
  formData: FormData,
): Promise<void> {
  requireSlug(slug);

  const parsed = parseAltTextForm(formData);

  if (!parsed.ok) {
    completeOutcome(planPackageImageAltText("invalid-update"), slug);
  }

  const cookie = await cookieHeader();
  const result = await updateAdminPackageImageAltText(slug, parsed.value, cookie);

  completeOutcome(planPackageImageAltText(result.state), slug);
}
