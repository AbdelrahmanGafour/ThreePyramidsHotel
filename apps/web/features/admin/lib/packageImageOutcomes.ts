import type { AdminPackageImageWriteState } from "../server/adminPackageImagesApi";

/**
 * What a journey-image Server Action should do about each answer the media
 * API client gave.
 *
 * Pure: no request context, no network, no `next/*`. A Server Action cannot
 * be imported under a plain Node test without Next's request context, so the
 * part that *decides* — which notice, whether to re-read the journey — lives
 * here and is tested directly, matching `imageOutcomes.ts` exactly. The
 * action does what the plan says and nothing more.
 *
 * Every journey-image outcome lands on one surface, the journey's own detail
 * page, so there is no choice of destination to make — only whether that
 * page must be re-read before it is shown.
 */

/** Only ever the journey's detail path, or nothing. */
export type PackageImageRevalidation = "none" | "detail";

export type PackageImageOutcome =
  | { kind: "login" }
  | { kind: "stale"; revalidate: PackageImageRevalidation }
  | { kind: "notice"; token: PackageImageNotice; revalidate: PackageImageRevalidation };

/**
 * The closed set of image notices the journey detail page may show.
 *
 * Every token is prefixed `image-` so it cannot collide with the status,
 * default-variant, variant-order, variant-delete, content, itinerary or
 * delete tokens that page already recognises — none of which carries this
 * prefix.
 */
export const PACKAGE_IMAGE_NOTICES = {
  "image-uploaded": {
    tone: "done",
    message: "Image uploaded. It is now this journey's picture.",
  },
  "image-replaced": {
    tone: "done",
    message: "Image replaced. The description was kept.",
  },
  "image-deleted": {
    tone: "done",
    message: "Image deleted. This journey has no picture.",
  },
  "image-alt-text-updated": {
    tone: "done",
    message: "Description saved.",
  },
  "image-invalid": {
    tone: "warn",
    message: "The selected file could not be accepted as a valid image.",
  },
  "image-unsupported-type": {
    tone: "warn",
    message: "Choose a JPEG, PNG, or WebP image.",
  },
  "image-too-large": {
    tone: "warn",
    message: "The selected image is too large. Choose an image no larger than 8 MiB.",
  },
  "image-exists": {
    // A stale page: this journey gained a picture since the page was
    // rendered. The re-read below is what shows the administrator what is
    // actually there, so the wording points at it rather than explaining.
    tone: "warn",
    message: "This journey already has an image. The current one is shown below — replace it instead.",
  },
  "image-missing": {
    // The other half of the same staleness, and worded the same way: the
    // picture went between the page rendering and the button being pressed.
    tone: "warn",
    message: "This journey has no image to change. Upload one below.",
  },
  "image-description-refused": {
    tone: "warn",
    message: "That description was not saved. It must be 240 characters or fewer.",
  },
  "image-storage-unavailable": {
    tone: "warn",
    message: "Image storage is temporarily unavailable. Nothing was changed.",
  },
  "image-operation-failed": {
    tone: "warn",
    message: "The image operation could not be completed safely. Review the journey below before retrying.",
  },
  "image-outcome-uncertain": {
    // Locked wording, mirroring the API's own uncertain-commit doctrine:
    // never "failed", never "not uploaded", never "deleted" — none of those
    // is known, and claiming one would be worse than saying so. The
    // re-read journey below is how an administrator finds out what is true.
    tone: "warn",
    message:
      "The API could not confirm the image operation. Review the journey below before retrying — it may or may not have been applied.",
  },
  "image-unavailable": {
    // Worded to hold for every cause of `unavailable` — a transport
    // failure, a 5xx, an unusable body — so it claims nothing about whether
    // the request reached the API.
    tone: "warn",
    message:
      "The result of that image change could not be confirmed. It may or may not have been applied. Review the journey before making another change.",
  },
} as const;

export type PackageImageNotice = keyof typeof PACKAGE_IMAGE_NOTICES;

/**
 * Reads `?image=` against this module's own closed map.
 *
 * Matched with `Object.hasOwn` so an inherited property name cannot pass for
 * one. Anything else — including a repeated parameter, which arrives as an
 * array — is simply no notice, never text rendered from the URL.
 */
export function parsePackageImageNotice(
  value: string | string[] | undefined,
): PackageImageNotice | null {
  if (typeof value !== "string" || !Object.hasOwn(PACKAGE_IMAGE_NOTICES, value)) {
    return null;
  }

  return value as PackageImageNotice;
}

const notice = (
  token: PackageImageNotice,
  revalidate: PackageImageRevalidation,
): PackageImageOutcome => ({ kind: "notice", token, revalidate });

const STALE: PackageImageOutcome = { kind: "stale", revalidate: "detail" };
const LOGIN: PackageImageOutcome = { kind: "login" };

/**
 * The states every journey-image write shares, mapped once.
 *
 * `null` means this state means something different depending on which
 * operation asked, and the caller decides.
 *
 * Note which of these re-read the journey. Anything that changed the
 * database does, obviously — but so does every answer that means the page
 * was showing something stale (`image-exists`, `image-not-found`) and every
 * answer where nobody knows what happened (`outcome-uncertain`,
 * `unavailable`, `operation-failed`). Those are exactly the cases where what
 * an administrator is looking at may no longer be true, so the page is read
 * again before they see it.
 */
function planShared(state: AdminPackageImageWriteState): PackageImageOutcome | null {
  switch (state) {
    case "ok":
      return null;

    case "unauthenticated":
      return LOGIN;

    case "invalid-reference":
    case "not-found":
      // The journey itself is gone. The detail page renders its own
      // not-found rather than this module inventing a state for it.
      return STALE;

    case "image-exists":
      return notice("image-exists", "detail");

    case "image-not-found":
      return notice("image-missing", "detail");

    case "invalid-image":
      return notice("image-invalid", "none");

    case "invalid-update":
      return notice("image-description-refused", "none");

    case "unsupported-type":
      return notice("image-unsupported-type", "none");

    case "too-large":
      return notice("image-too-large", "none");

    case "storage-unavailable":
      return notice("image-storage-unavailable", "none");

    case "operation-failed":
      return notice("image-operation-failed", "detail");

    case "outcome-uncertain":
      return notice("image-outcome-uncertain", "detail");

    case "unavailable":
      return notice("image-unavailable", "detail");
  }
}

export function planPackageImageUpload(state: AdminPackageImageWriteState): PackageImageOutcome {
  return planShared(state) ?? notice("image-uploaded", "detail");
}

export function planPackageImageReplace(state: AdminPackageImageWriteState): PackageImageOutcome {
  return planShared(state) ?? notice("image-replaced", "detail");
}

export function planPackageImageDelete(state: AdminPackageImageWriteState): PackageImageOutcome {
  return planShared(state) ?? notice("image-deleted", "detail");
}

export function planPackageImageAltText(state: AdminPackageImageWriteState): PackageImageOutcome {
  return planShared(state) ?? notice("image-alt-text-updated", "detail");
}
