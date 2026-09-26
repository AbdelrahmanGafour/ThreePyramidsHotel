"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  InvalidPackageSubmissionError,
  PACKAGES_NEW_PATH,
  PACKAGES_PATH,
  packageDetailHref,
  packageEditHref,
  parsePackageCreateForm,
  OverlappingRateRowsError,
  packageRatesHref,
  packageContentHref,
  packageItineraryHref,
  packageVariantEditHref,
  packageVariantNewHref,
  parsePackageEditForm,
  parsePackageRatesForm,
  parsePackageContentForm,
  parsePackageItineraryForm,
  parsePackageVariantCreateForm,
  parsePackageVariantEditForm,
  type PackageCreateInput,
  type PackageUpdateInput,
  type PackageRateTierInput,
  type PackageContentInput,
  type PackageItinerarySectionInput,
  TooManyItinerarySectionsError,
  TooManyContentEntriesError,
  type PackageVariantCreateInput,
  type PackageVariantUpdateInput,
} from "../lib/packages";
import {
  createAdminPackage,
  replaceAdminPackageContent,
  replaceAdminPackageItinerary,
  createAdminPackageVariant,
  deleteAdminPackage,
  deleteAdminPackageVariant,
  reorderAdminPackageVariants,
  setAdminPackageDefaultVariant,
  replaceAdminPackageRates,
  updateAdminPackage,
  updateAdminPackageStatus,
  updateAdminPackageVariant,
} from "./adminPackagesApi";

// The one way the administration UI offers or withdraws a journey.
//
// It runs on the server and calls Express directly through the server-only
// client, so the browser never learns the API's address and never holds a
// session token. The form that triggers it posts to Next, not to the API.
//
// It decides nothing about what is allowed: the backend holds that, and this
// action reports what it answered. The button a page renders is a hint from a
// state that may already be seconds out of date.

/** Display hints this action may hand back to the page. Never anything else. */
export type PackageStatusNotice = "updated" | "uncertain" | "invalid";

function noticeHref(slug: string, notice: PackageStatusNotice): string {
  // The slug stays one encoded path segment; the notice is a fixed token from
  // the union above, never caller text.
  return `${packageDetailHref(slug)}?statusAction=${notice}`;
}

/**
 * Re-reads both places this journey appears, so whatever the page shows next
 * comes from the database rather than from a cached copy taken before the
 * change.
 */
function revalidateJourney(slug: string): void {
  revalidatePath(packageDetailHref(slug));
  revalidatePath(PACKAGES_PATH);
}

/**
 * Offers one journey to guests, or withdraws it.
 *
 * Bound per form to a slug and a target the server itself rendered, but both
 * arguments are still checked here: a Server Action is a public endpoint, and
 * a narrow TypeScript type is a compile-time promise that says nothing about
 * what actually arrives over the wire.
 *
 * Neither value is normalised. The slug is passed through untouched — the API
 * owns what a slug is — and the target must be an actual boolean.
 *
 * Every path ends in a redirect back to the journey, so the state on screen is
 * always freshly read rather than assumed from what was asked for. The updated
 * journey the API returns is deliberately not rendered from here: re-reading
 * is one code path instead of two, and it cannot show a state that disagrees
 * with what the next reader would see.
 *
 * Only whether guests can see the journey changes. Its wording, its variants,
 * its rates and who manages it are untouched by this action and are not sent.
 */
export async function updatePackageStatusAction(slug: string, isActive: boolean): Promise<void> {
  // Treated as untrusted despite the types above.
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(PACKAGES_PATH);
  }

  if (typeof isActive !== "boolean") {
    redirect(noticeHref(slug, "invalid"));
  }

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await updateAdminPackageStatus(slug, isActive, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      // Includes the same-state case: the API treats asking for the state a
      // journey already holds as a success, and so does this.
      revalidateJourney(slug);
      redirect(noticeHref(slug, "updated"));

    case "unauthenticated":
      // The session ended between the page rendering and the button being
      // pressed. Nothing changed.
      redirect("/admin/login");

    case "invalid":
    case "not-found":
      // Either there is no such journey or its address is not one. The detail
      // page decides how that reads — it renders the route-local not-found —
      // rather than this action inventing a state for it.
      revalidatePath(PACKAGES_PATH);
      redirect(packageDetailHref(slug));

    case "unavailable":
      // Deliberately not reported as a failure. A mutation whose connection
      // dropped may well have been applied first, so the only honest answer is
      // that the outcome is unknown — and the refreshed page is the place to
      // find out. Never retried automatically.
      revalidateJourney(slug);
      redirect(noticeHref(slug, "uncertain"));
  }
}

/**
 * Display hints the create action may hand back to the form. Never anything
 * else, and never the value that was refused.
 */
export type PackageCreateNotice =
  | "invalid"
  | "reserved"
  | "code-in-use"
  | "slug-in-use"
  | "uncertain";

function createNoticeHref(notice: PackageCreateNotice): string {
  return `${PACKAGES_NEW_PATH}?created=${notice}`;
}

/**
 * Creates one journey from the submitted form.
 *
 * The form posts here, not to the API: the browser never learns the API's
 * address and never holds a session token. The Cookie header is forwarded
 * verbatim, exactly as every other admin write does.
 *
 * Only the ten fields the create contract accepts are read. `isActive` and
 * anything about ownership are not read even if a crafted submission adds
 * them — a new journey is always created unpublished and admin-owned, and the
 * API writes both as literals regardless of what is sent.
 *
 * On success the administrator lands on the new journey, addressed by the slug
 * the API returned rather than the one that was typed: if the two ever differ,
 * the server's answer is the true one.
 *
 * An uncertain outcome is deliberately NOT reported as a failure. A creation
 * whose connection dropped may well have been applied, so the only honest
 * answer is that the outcome is unknown; nothing is retried, and the notice
 * sends the administrator to look.
 */
export async function createPackageAction(form: FormData): Promise<void> {
  let input: PackageCreateInput;

  try {
    input = parsePackageCreateForm(form);
  } catch (error) {
    if (error instanceof InvalidPackageSubmissionError) {
      redirect(createNoticeHref("invalid"));
    }

    throw error;
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await createAdminPackage(input, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      revalidatePath(PACKAGES_PATH);
      // Addressed by the slug the API reported, never the submitted one.
      redirect(packageDetailHref(result.data.slug));

    case "unauthenticated":
      // The session ended between the form rendering and its submission.
      redirect("/admin/login");

    case "invalid":
      redirect(createNoticeHref("invalid"));

    case "reserved-brochure-identity":
      redirect(createNoticeHref("reserved"));

    case "code-in-use":
      redirect(createNoticeHref("code-in-use"));

    case "slug-in-use":
      redirect(createNoticeHref("slug-in-use"));

    case "unavailable":
      // The catalogue is re-read because the journey may in fact exist; the
      // notice says the outcome is unknown rather than claiming either way.
      revalidatePath(PACKAGES_PATH);
      redirect(createNoticeHref("uncertain"));
  }
}

/** Display hints the edit action may hand back to the form. Never anything else. */
export type PackageEditNotice = "invalid" | "uncertain";

function editNoticeHref(slug: string, notice: PackageEditNotice): string {
  return `${packageEditHref(slug)}?saved=${notice}`;
}

/**
 * Rewrites one journey's package-level fields from the submitted form.
 *
 * Bound per form to the slug the server itself rendered, but it is still
 * checked here: a Server Action is a public endpoint, and a narrow TypeScript
 * type says nothing about what arrives over the wire.
 *
 * Only the eight editable fields are read. The journey's identity, its
 * publication and its ownership are not — and could not be applied even if
 * they were, because the API refuses a body that offers them.
 *
 * Saving a brochure-owned journey makes it admin-managed. That happens in the
 * API, in the same write as the edit, so there is no moment at which the
 * journey is edited but still owned by the catalogue seed.
 *
 * An uncertain outcome is deliberately NOT reported as a failure: an edit
 * whose connection dropped may well have been applied, so the notice says the
 * outcome is unknown and nothing is retried.
 */
export async function editPackageAction(slug: string, form: FormData): Promise<void> {
  // Treated as untrusted despite the types above.
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(PACKAGES_PATH);
  }

  let input: PackageUpdateInput;

  try {
    input = parsePackageEditForm(form);
  } catch (error) {
    if (error instanceof InvalidPackageSubmissionError) {
      redirect(editNoticeHref(slug, "invalid"));
    }

    throw error;
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await updateAdminPackage(slug, input, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      revalidateJourney(slug);
      // Addressed by the slug the API reported. An edit cannot change it, but
      // reading it back means this never depends on that staying true.
      redirect(packageDetailHref(result.data.slug));

    case "unauthenticated":
      redirect("/admin/login");

    case "invalid":
      redirect(editNoticeHref(slug, "invalid"));

    case "not-found":
      // The journey is gone. The detail page decides how that reads — it
      // renders the route-local not-found — rather than this action inventing
      // a state for it.
      revalidatePath(PACKAGES_PATH);
      redirect(packageDetailHref(slug));

    case "unavailable":
      // Not reported as a failure: the edit may have been applied. Both views
      // are re-read so whatever comes back is freshly true.
      revalidateJourney(slug);
      redirect(editNoticeHref(slug, "uncertain"));
  }
}

/** Display hints the variant edit action may hand back. Never anything else. */
export type PackageVariantEditNotice = "invalid" | "uncertain";

function variantNoticeHref(
  slug: string,
  key: string,
  notice: PackageVariantEditNotice,
): string {
  return `${packageVariantEditHref(slug, key)}?saved=${notice}`;
}

/**
 * Rewrites one variant's metadata from the submitted form.
 *
 * Bound per form to the slug and key the server itself rendered, so the
 * submission carries no identity to substitute. Both are still checked here:
 * a Server Action is a public endpoint.
 *
 * Only the four editable fields are read. Saving a brochure-owned journey
 * makes the whole journey admin-managed — that happens in the API, in the
 * same transaction as the edit, so there is no moment at which an edited
 * variant belongs to a journey the seed still reconciles.
 *
 * An uncertain outcome is deliberately NOT reported as a failure, and nothing
 * is retried: an edit whose connection dropped may well have been applied.
 */
export async function editPackageVariantAction(
  slug: string,
  key: string,
  form: FormData,
): Promise<void> {
  // Treated as untrusted despite the types above.
  if (typeof slug !== "string" || slug.length === 0 || typeof key !== "string" || key.length === 0) {
    redirect(PACKAGES_PATH);
  }

  let input: PackageVariantUpdateInput;

  try {
    input = parsePackageVariantEditForm(form);
  } catch (error) {
    if (error instanceof InvalidPackageSubmissionError) {
      redirect(variantNoticeHref(slug, key, "invalid"));
    }

    throw error;
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await updateAdminPackageVariant(slug, key, input, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      revalidateJourney(slug);
      redirect(packageDetailHref(result.data.slug));

    case "unauthenticated":
      redirect("/admin/login");

    case "invalid":
      redirect(variantNoticeHref(slug, key, "invalid"));

    case "package-not-found":
    case "variant-not-found":
      // Either the journey or the variant is gone. The edit page decides how
      // that reads — it renders the route-local not-found — rather than this
      // action inventing a state for it.
      revalidateJourney(slug);
      redirect(packageVariantEditHref(slug, key));

    case "unavailable":
      // Not reported as a failure: the edit may have been applied. Both views
      // are re-read so whatever comes back is freshly true.
      revalidateJourney(slug);
      redirect(variantNoticeHref(slug, key, "uncertain"));
  }
}

/** Display hints the itinerary action may hand back. Never anything else. */
export type PackageItineraryNotice = "invalid" | "too-many" | "uncertain";

function itineraryNoticeHref(slug: string, notice: PackageItineraryNotice): string {
  // The slug stays one encoded path segment; the notice is a fixed token from
  // the union above, never caller text.
  return `${packageItineraryHref(slug)}?saved=${notice}`;
}

/**
 * Replaces a journey's itinerary.
 *
 * The slug is bound server-side, so the only thing the browser decides is the
 * sections themselves. The whole itinerary travels every time, because this
 * replaces the set - the form cannot express "leave the rest alone", and
 * neither can the API.
 *
 * Nothing about publication travels, and nothing here changes it: the
 * itinerary is prose on the detail page, so editing it on a live journey is
 * safe and is deliberately allowed.
 */
export async function replacePackageItineraryAction(
  slug: string,
  form: FormData,
): Promise<void> {
  // Treated as untrusted despite the type above.
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(PACKAGES_PATH);
  }

  let sections: PackageItinerarySectionInput[];

  try {
    sections = parsePackageItineraryForm(form);
  } catch (error) {
    if (error instanceof TooManyItinerarySectionsError) {
      redirect(itineraryNoticeHref(slug, "too-many"));
    }

    if (error instanceof InvalidPackageSubmissionError) {
      redirect(itineraryNoticeHref(slug, "invalid"));
    }

    throw error;
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await replaceAdminPackageItinerary(slug, sections, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      // Includes the no-op: the API treats resubmitting the same itinerary as
      // a success that wrote nothing, and so does this.
      revalidateJourney(slug);
      redirect(`${packageDetailHref(result.data.slug)}?itinerary=updated`);

    case "unauthenticated":
      redirect("/admin/login");

    case "invalid":
      redirect(itineraryNoticeHref(slug, "invalid"));

    case "package-not-found":
      // The journey is gone. The itinerary page decides how that reads - it
      // renders the route-local not-found - rather than this action inventing
      // a state for it.
      revalidateJourney(slug);
      redirect(packageItineraryHref(slug));

    case "unavailable":
      // Not reported as a failure: the replacement may have been applied.
      // Both views are re-read so whatever comes back is freshly true, and
      // nothing is resubmitted.
      revalidateJourney(slug);
      redirect(itineraryNoticeHref(slug, "uncertain"));
  }
}

/** Display hints the content action may hand back. Never anything else. */
export type PackageContentNotice = "invalid" | "too-many" | "uncertain";

function contentNoticeHref(slug: string, notice: PackageContentNotice): string {
  // The slug stays one encoded path segment; the notice is a fixed token from
  // the union above, never caller text.
  return `${packageContentHref(slug)}?saved=${notice}`;
}

/**
 * Replaces a journey's three content lists.
 *
 * The slug is bound server-side, so the only thing the browser decides is the
 * three lists themselves. All three are submitted every time, because this
 * replaces the whole set — the form cannot express "leave that one alone",
 * and neither can the API.
 *
 * Nothing about publication travels, and nothing here changes it: these rows
 * are prose on the detail page, so editing them on a live journey is safe and
 * is deliberately allowed.
 */
export async function replacePackageContentAction(slug: string, form: FormData): Promise<void> {
  // Treated as untrusted despite the type above.
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(PACKAGES_PATH);
  }

  let content: PackageContentInput;

  try {
    content = parsePackageContentForm(form);
  } catch (error) {
    if (error instanceof TooManyContentEntriesError) {
      redirect(contentNoticeHref(slug, "too-many"));
    }

    if (error instanceof InvalidPackageSubmissionError) {
      redirect(contentNoticeHref(slug, "invalid"));
    }

    throw error;
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await replaceAdminPackageContent(slug, content, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      // Includes the no-op: the API treats resubmitting the same lists as a
      // success that wrote nothing, and so does this.
      revalidateJourney(slug);
      redirect(`${packageDetailHref(result.data.slug)}?content=updated`);

    case "unauthenticated":
      redirect("/admin/login");

    case "invalid":
      redirect(contentNoticeHref(slug, "invalid"));

    case "package-not-found":
      // The journey is gone. The content page decides how that reads — it
      // renders the route-local not-found — rather than this action
      // inventing a state for it.
      revalidateJourney(slug);
      redirect(packageContentHref(slug));

    case "unavailable":
      // Not reported as a failure: the replacement may have been applied.
      // Both views are re-read so whatever comes back is freshly true, and
      // nothing is resubmitted.
      revalidateJourney(slug);
      redirect(contentNoticeHref(slug, "uncertain"));
  }
}

/** Display hints the journey delete action may hand back. Never anything else. */
export type PackageDeleteNotice =
  | "must-be-inactive"
  | "brochure-managed"
  | "has-reservations"
  | "invalid"
  | "uncertain";

function packageDeleteNoticeHref(slug: string, notice: PackageDeleteNotice): string {
  // The slug stays one encoded path segment; the notice is a fixed token from
  // the union above, never caller text.
  return `${packageDetailHref(slug)}?packageDelete=${notice}`;
}

/**
 * Removes one journey and everything it owns.
 *
 * The slug is bound server-side, so the form posts nothing at all and the
 * request carries no body.
 *
 * Every rule stays with the backend, and two of them could not live here even
 * if that were wanted: whether the journey's identity belongs to the brochure
 * needs a catalogue this app does not hold, and whether it has ever been
 * booked can only be asked safely while no new booking can be taken.
 */
export async function deletePackageAction(slug: string): Promise<void> {
  // Treated as untrusted despite the type above.
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(PACKAGES_PATH);
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await deleteAdminPackage(slug, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      // The journey is gone, so there is no detail page to return to. Only
      // the catalogue is revalidated; the detail path no longer resolves.
      revalidatePath(PACKAGES_PATH);
      redirect(`${PACKAGES_PATH}?deleted=1`);

    case "unauthenticated":
      redirect("/admin/login");

    case "must-be-inactive":
      // The journey was offered again between this page rendering and the
      // button being pressed. It is never withdrawn on the administrator's
      // behalf, so this only says so.
      revalidateJourney(slug);
      redirect(packageDeleteNoticeHref(slug, "must-be-inactive"));

    case "brochure-managed":
      revalidateJourney(slug);
      redirect(packageDeleteNoticeHref(slug, "brochure-managed"));

    case "has-reservations":
      // Permanent, not a race to retry: bookings are never removed by this
      // system, so this journey can never be deleted.
      revalidateJourney(slug);
      redirect(packageDeleteNoticeHref(slug, "has-reservations"));

    case "package-not-found":
      // Already gone. The catalogue is the honest place to land, and the
      // notice is neutral rather than triumphant: this administrator may not
      // be the one who deleted it.
      revalidatePath(PACKAGES_PATH);
      redirect(`${PACKAGES_PATH}?deleted=gone`);

    case "invalid":
      revalidateJourney(slug);
      redirect(packageDeleteNoticeHref(slug, "invalid"));

    case "unavailable":
      // Not reported as a failure: the journey may well have been removed.
      // Both views are re-read so the administrator can see for themselves,
      // and nothing is resubmitted.
      revalidatePath(PACKAGES_PATH);
      revalidateJourney(slug);
      redirect(packageDeleteNoticeHref(slug, "uncertain"));
  }
}

/** Display hints the variant delete action may hand back. Never anything else. */
export type PackageVariantDeleteNotice =
  | "deleted"
  | "must-be-inactive"
  | "is-default"
  | "has-reservations"
  | "gone"
  | "uncertain";

function variantDeleteNoticeHref(slug: string, notice: PackageVariantDeleteNotice): string {
  // The slug stays one encoded path segment; the notice is a fixed token from
  // the union above, never caller text.
  return `${packageDetailHref(slug)}?variantDelete=${notice}`;
}

/**
 * Removes one variant from a journey.
 *
 * Both the journey and the variant are bound server-side, so the form posts
 * nothing at all — there is no field a crafted submission could substitute,
 * and the request carries no body.
 *
 * Every rule stays with the backend. This page renders a button from state
 * that may be seconds out of date, and three of the refusals below exist
 * precisely because the button can be wrong: the journey may have been
 * published since, another variant may have been added, or a guest may have
 * booked this one. None of them is guessed at here.
 */
export async function deletePackageVariantAction(slug: string, key: string): Promise<void> {
  // Treated as untrusted despite the types above.
  if (typeof slug !== "string" || slug.length === 0 || typeof key !== "string" || key.length === 0) {
    redirect(PACKAGES_PATH);
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await deleteAdminPackageVariant(slug, key, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      revalidateJourney(slug);
      redirect(variantDeleteNoticeHref(slug, "deleted"));

    case "unauthenticated":
      redirect("/admin/login");

    case "package-inactive-required":
      // The journey was published between this page rendering and the button
      // being pressed. It is never withdrawn on the administrator's behalf.
      revalidateJourney(slug);
      redirect(variantDeleteNoticeHref(slug, "must-be-inactive"));

    case "variant-is-default":
      // A sibling appeared since, so this variant now leads a journey with
      // others in it. The remedy is theirs to choose.
      revalidateJourney(slug);
      redirect(variantDeleteNoticeHref(slug, "is-default"));

    case "variant-has-reservations":
      // Permanent, not a race to retry: bookings are never removed by this
      // system, so this variant can never be deleted.
      revalidateJourney(slug);
      redirect(variantDeleteNoticeHref(slug, "has-reservations"));

    case "variant-not-found":
    case "invalid":
      // Already gone, or an address that was never one. Either way there is
      // nothing left to remove, and the refreshed page shows what remains.
      revalidateJourney(slug);
      redirect(variantDeleteNoticeHref(slug, "gone"));

    case "package-not-found":
      // The journey itself is gone. The detail page decides how that reads —
      // it renders the route-local not-found.
      revalidateJourney(slug);
      redirect(packageDetailHref(slug));

    case "unavailable":
      // Not reported as a failure: the variant may well have been removed.
      // Both views are re-read so the administrator can see whether it is
      // still there, and nothing is resubmitted.
      revalidateJourney(slug);
      redirect(variantDeleteNoticeHref(slug, "uncertain"));
  }
}

/** Display hints the reorder action may hand back. Never anything else. */
export type PackageVariantOrderNotice =
  | "updated"
  | "stale"
  | "order-exhausted"
  | "uncertain";

function variantOrderNoticeHref(slug: string, notice: PackageVariantOrderNotice): string {
  // The slug stays one encoded path segment; the notice is a fixed token from
  // the union above, never caller text.
  return `${packageDetailHref(slug)}?variantOrder=${notice}`;
}

/**
 * Writes a journey's variants into a new order.
 *
 * The journey and the COMPLETE new order are both bound server-side, so the
 * form posts nothing at all. Each button carries the whole arrangement that
 * pressing it would produce, computed by the tested helper at render time —
 * never a key and a direction for the server to interpret against whatever
 * it happens to find.
 *
 * That is also what makes a stale page safe. The list was built from the
 * variants this page rendered, so if the set has changed since, the API
 * refuses it as a mismatch rather than applying a rearrangement that means
 * something different now. Nothing is appended and nothing is inferred.
 */
export async function reorderPackageVariantsAction(
  slug: string,
  variantKeys: readonly string[],
): Promise<void> {
  // Treated as untrusted despite the types above.
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(PACKAGES_PATH);
  }

  if (!Array.isArray(variantKeys) || variantKeys.length === 0
    || variantKeys.some((key) => typeof key !== "string" || key.length === 0)) {
    redirect(variantOrderNoticeHref(slug, "stale"));
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await reorderAdminPackageVariants(slug, variantKeys, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      // Includes the idempotent case: the API treats an order a journey
      // already has as a success, and so does this.
      revalidateJourney(slug);
      redirect(variantOrderNoticeHref(slug, "updated"));

    case "unauthenticated":
      redirect("/admin/login");

    case "set-mismatch":
    case "variant-not-found":
    case "invalid":
      // The journey's variants are not what this page was rendered from.
      // Both views are re-read so the order shown next is the stored one,
      // and the administrator is asked to look before trying again.
      revalidateJourney(slug);
      redirect(variantOrderNoticeHref(slug, "stale"));

    case "order-exhausted":
      revalidateJourney(slug);
      redirect(variantOrderNoticeHref(slug, "order-exhausted"));

    case "package-not-found":
      // The journey is gone. The detail page decides how that reads — it
      // renders the route-local not-found — rather than this action
      // inventing a state for it.
      revalidateJourney(slug);
      redirect(packageDetailHref(slug));

    case "unavailable":
      // Not reported as a failure: the reorder may have been applied. Both
      // views are re-read so whatever comes back is freshly true, and nothing
      // is resubmitted.
      revalidateJourney(slug);
      redirect(variantOrderNoticeHref(slug, "uncertain"));
  }
}

/** Display hints the default-variant action may hand back. Never anything else. */
export type PackageDefaultVariantNotice =
  | "updated"
  | "must-be-inactive"
  | "gone"
  | "uncertain";

function defaultVariantNoticeHref(slug: string, notice: PackageDefaultVariantNotice): string {
  // The slug stays one encoded path segment; the notice is a fixed token from
  // the union above, never caller text.
  return `${packageDetailHref(slug)}?defaultVariant=${notice}`;
}

/**
 * Makes one variant the one its journey leads with.
 *
 * Both the journey and the variant are bound server-side, so the form posts
 * nothing at all: there is no field a crafted submission could substitute,
 * and no default flag, position, rate or publication value travels.
 *
 * The button that triggers this is a hint from a page that may already be
 * seconds out of date. The backend holds every rule — including whether the
 * journey is still inactive — and this action reports what it answered.
 *
 * Asking for the variant that already leads is a success at the API and a
 * success here, so a stale page whose button has since become meaningless
 * does nothing rather than failing.
 */
export async function makePackageVariantDefaultAction(
  slug: string,
  variantKey: string,
): Promise<void> {
  // Treated as untrusted despite the types above.
  if (typeof slug !== "string" || slug.length === 0
    || typeof variantKey !== "string" || variantKey.length === 0) {
    redirect(PACKAGES_PATH);
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await setAdminPackageDefaultVariant(slug, variantKey, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      // Includes the idempotent case: the API treats asking for the variant
      // that already leads as a success, and so does this.
      revalidateJourney(slug);
      redirect(defaultVariantNoticeHref(slug, "updated"));

    case "unauthenticated":
      // The session ended between the page rendering and the button being
      // pressed. Nothing changed.
      redirect("/admin/login");

    case "package-inactive-required":
      // The journey was offered again between the page rendering and the
      // button being pressed. It is never withdrawn on the administrator's
      // behalf, so this only says so.
      revalidateJourney(slug);
      redirect(defaultVariantNoticeHref(slug, "must-be-inactive"));

    case "invalid":
    case "package-not-found":
    case "variant-not-found":
      // Either the journey or the variant is gone, or its address was never
      // one. The detail page decides how each reads — a missing journey
      // renders the route-local not-found, a missing variant simply stops
      // being listed — rather than this action inventing a state for it.
      revalidateJourney(slug);
      redirect(defaultVariantNoticeHref(slug, "gone"));

    case "unavailable":
      // Deliberately not reported as a failure. A mutation whose connection
      // dropped may well have been applied first, so the only honest answer
      // is that the outcome is unknown — and the refreshed page is the place
      // to look. Nothing is resubmitted.
      revalidateJourney(slug);
      redirect(defaultVariantNoticeHref(slug, "uncertain"));
  }
}

/** Display hints the variant create action may hand back. Never anything else. */
export type PackageVariantCreateNotice =
  | "invalid"
  | "key-in-use"
  | "must-be-inactive"
  | "default-unsafe"
  | "order-exhausted"
  | "uncertain";

function variantCreateNoticeHref(slug: string, notice: PackageVariantCreateNotice): string {
  // The slug stays one encoded path segment; the notice is a fixed token from
  // the union above, never caller text.
  return `${packageVariantNewHref(slug)}?saved=${notice}`;
}

/**
 * Adds one variant to a journey.
 *
 * The slug is bound server-side, so the form posts no identity at all: the
 * only thing the browser decides is the five fields of the variant itself.
 * The default flag and the position are the API's to assign and appear in no
 * request this action can make.
 *
 * Every refusal is reported as itself. The four conflicts the API can raise
 * each need a different answer from the administrator, so each gets its own
 * notice rather than a shared "that did not work".
 *
 * An unknown outcome is not reported as a failure. The connection may have
 * dropped after the variant was created, so both views are re-read and the
 * administrator is asked to look before trying again — nothing is retried on
 * their behalf, because a repeat could add a second variant.
 */
export async function createPackageVariantAction(slug: string, form: FormData): Promise<void> {
  // Treated as untrusted despite the type above.
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(PACKAGES_PATH);
  }

  let input: PackageVariantCreateInput;

  try {
    input = parsePackageVariantCreateForm(form);
  } catch (error) {
    if (error instanceof InvalidPackageSubmissionError) {
      redirect(variantCreateNoticeHref(slug, "invalid"));
    }

    throw error;
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await createAdminPackageVariant(slug, input, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      revalidateJourney(slug);
      redirect(packageDetailHref(result.data.slug));

    case "unauthenticated":
      redirect("/admin/login");

    case "invalid":
      redirect(variantCreateNoticeHref(slug, "invalid"));

    case "key-in-use":
      redirect(variantCreateNoticeHref(slug, "key-in-use"));

    case "package-inactive-required":
      // The journey is live. It is never withdrawn on the administrator's
      // behalf, so this only says so and sends them back to the form.
      revalidateJourney(slug);
      redirect(variantCreateNoticeHref(slug, "must-be-inactive"));

    case "default-unsafe":
      revalidateJourney(slug);
      redirect(variantCreateNoticeHref(slug, "default-unsafe"));

    case "order-exhausted":
      redirect(variantCreateNoticeHref(slug, "order-exhausted"));

    case "package-not-found":
      // The journey is gone. The page decides how that reads — it renders the
      // route-local not-found — rather than this action inventing a state.
      revalidateJourney(slug);
      redirect(packageVariantNewHref(slug));

    case "unavailable":
      // Not reported as a failure: the variant may have been created. Both
      // views are re-read so whatever comes back is freshly true, and nothing
      // is resubmitted — a repeat could add a second variant.
      revalidateJourney(slug);
      redirect(variantCreateNoticeHref(slug, "uncertain"));
  }
}

/** Display hints the rates action may hand back. Never anything else. */
export type PackageRatesNotice = "invalid" | "overlapping" | "rates-required" | "uncertain";

function ratesNoticeHref(slug: string, key: string, notice: PackageRatesNotice): string {
  return `${packageRatesHref(slug, key)}?saved=${notice}`;
}

/**
 * Replaces one variant's whole rate set from the submitted rows.
 *
 * Bound per form to the slug, the key and whether this journey may have no
 * rates at all — all three rendered by the server. `allowEmpty` is a hint
 * taken when the page was drawn, so it is used only to refuse early with a
 * useful explanation; the API re-checks it against the row it locks and
 * remains the authority.
 *
 * The body carries `rates` and nothing else. No currency is sent: USD is the
 * server's to state.
 *
 * An uncertain outcome is deliberately NOT reported as a failure, and nothing
 * is retried: a replacement whose connection dropped may well have been
 * applied.
 */
export async function replacePackageRatesAction(
  slug: string,
  key: string,
  allowEmpty: boolean,
  form: FormData,
): Promise<void> {
  // Treated as untrusted despite the types above.
  if (typeof slug !== "string" || slug.length === 0 || typeof key !== "string" || key.length === 0) {
    redirect(PACKAGES_PATH);
  }

  let rates: PackageRateTierInput[];

  try {
    rates = parsePackageRatesForm(form);
  } catch (error) {
    if (error instanceof OverlappingRateRowsError) {
      redirect(ratesNoticeHref(slug, key, "overlapping"));
    }

    if (error instanceof InvalidPackageSubmissionError) {
      redirect(ratesNoticeHref(slug, key, "invalid"));
    }

    throw error;
  }

  // Refused here so the administrator is told why rather than watching a
  // round trip fail. The journey is never deactivated on their behalf.
  if (rates.length === 0 && allowEmpty !== true) {
    redirect(ratesNoticeHref(slug, key, "rates-required"));
  }

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await replaceAdminPackageRates(slug, key, rates, cookie);

  // redirect() works by throwing, so every branch below is deliberately
  // outside any try/catch.
  switch (result.state) {
    case "ok":
      revalidateJourney(slug);
      redirect(packageDetailHref(result.data.slug));

    case "unauthenticated":
      redirect("/admin/login");

    case "invalid":
      redirect(ratesNoticeHref(slug, key, "invalid"));

    case "overlapping":
      redirect(ratesNoticeHref(slug, key, "overlapping"));

    case "rates-required":
      redirect(ratesNoticeHref(slug, key, "rates-required"));

    case "package-not-found":
    case "variant-not-found":
      // Either the journey or the variant is gone. The editor decides how
      // that reads — it renders the route-local not-found.
      revalidateJourney(slug);
      redirect(packageRatesHref(slug, key));

    case "unavailable":
      // Not reported as a failure: the replacement may have been applied.
      revalidateJourney(slug);
      redirect(ratesNoticeHref(slug, key, "uncertain"));
  }
}
