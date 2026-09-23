import type {
  AdminRoomTypeImageAltTextResult,
  AdminRoomTypeImageCoverResult,
  AdminRoomTypeImageDeleteResult,
  AdminRoomTypeImageMoveResult,
  AdminRoomTypeImageUploadResult,
} from "../server/adminRoomTypeImagesApi";

/**
 * What a room-type image Server Action should do about each answer the media
 * API client gave.
 *
 * Pure: no request context, no network, no `next/*`. A Server Action cannot
 * be imported under a plain Node test without Next's request context, so the
 * part that *decides* — which notice, whether to revalidate — lives here and
 * is tested directly, matching `inventoryOutcomes.ts` exactly. The action
 * does exactly what the plan says and nothing more.
 *
 * A dedicated module rather than added branches in `inventoryOutcomes.ts`:
 * every image outcome redirects to exactly one surface — the room-type detail
 * page — and revalidates at most that one path, so the general "list / new /
 * detail" surface and "list / detail / list-and-detail" revalidation
 * vocabulary those room-type and physical-room planners need does not apply
 * here. Images currently have no effect on the room-type list's own contract
 * (no count, no field on that response changes because a gallery changed), so
 * "list" is not a revalidation option this module offers at all.
 */

/** Only ever the room-type detail path, or nothing. */
export type RoomTypeImageRevalidation = "none" | "detail";

/**
 * Where a room-type image action ends up, and with what fixed notice.
 *
 * `stale` carries no notice, matching the T01/T02 convention exactly: when the
 * room type itself no longer resolves, the detail page renders its own
 * not-found rather than this module inventing a state for it. `notice` is
 * every other outcome, each with one token from the closed set below.
 */
export type RoomTypeImageOutcome =
  | { kind: "login" }
  | { kind: "stale"; revalidate: RoomTypeImageRevalidation }
  | { kind: "notice"; token: RoomTypeImageNotice; revalidate: RoomTypeImageRevalidation };

/**
 * The closed set of image-specific notices the room-type detail page may
 * show. Every token is prefixed `image-` so it cannot collide with the
 * existing room-type, capacity or physical-room tokens already recognised by
 * that page's notice surface — none of which carries this prefix today.
 *
 * This module defines the set and its wording; wiring it into the detail
 * page's own notice resolution is a later step. Until then these tokens exist
 * fully formed and fully tested, unreachable only because nothing yet points
 * a browser at them.
 */
export const ROOM_TYPE_IMAGE_NOTICES = {
  "image-uploaded": {
    tone: "done",
    message: "Image uploaded. It has been added to this room type's gallery.",
  },
  "image-updated": {
    tone: "done",
    message: "Alt text saved.",
  },
  "image-cover-updated": {
    tone: "done",
    message: "Cover image updated.",
  },
  "image-order-updated": {
    tone: "done",
    message: "Image order updated.",
  },
  "image-deleted": {
    tone: "done",
    message: "Image deleted.",
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
  "image-limit-reached": {
    tone: "warn",
    message: "This room type already has the maximum number of images.",
  },
  "image-update-refused": {
    tone: "warn",
    message: "That change was not saved because the value could not be accepted. Check the field and try again.",
  },
  "image-reorder-invalid": {
    tone: "warn",
    message: "That reorder request could not be accepted. Reload the page and try again.",
  },
  "image-not-found": {
    // Deliberately silent about *why*: a reference that never existed and one
    // that belongs to another room type are answered identically by the API,
    // and this wording says nothing about ownership or authorization for
    // exactly that reason.
    tone: "warn",
    message: "That image is no longer available. Review the current images below.",
  },
  "image-storage-unavailable": {
    tone: "warn",
    message: "Image storage is temporarily unavailable.",
  },
  "image-delivery-unavailable": {
    tone: "warn",
    message: "Image delivery is temporarily unavailable.",
  },
  "image-operation-failed": {
    tone: "warn",
    message: "The image operation could not be completed safely. Review the current images before retrying.",
  },
  "image-outcome-uncertain": {
    // Locked wording, mirroring the API's own uncertain-commit doctrine:
    // never "failed", never "rolled back", never "not created", never
    // "deleted successfully" — none of those is known. The refreshed gallery
    // below is how an administrator finds out what is actually true.
    tone: "warn",
    message: "The API could not confirm the image operation. Review the current images below before retrying.",
  },
  "image-unavailable": {
    // Worded to hold for every cause of `unavailable` — a transport failure,
    // a 5xx, an unusable body — so it claims nothing about whether the
    // request reached the API, matching the existing admin doctrine exactly.
    tone: "warn",
    message:
      "The result of that image change could not be confirmed. It may or may not have been applied. Review the current images before making another change.",
  },
} as const;

export type RoomTypeImageNotice = keyof typeof ROOM_TYPE_IMAGE_NOTICES;

/**
 * Reads `?action=` against this module's own closed map.
 *
 * Matched with `Object.hasOwn` so an inherited property name cannot pass for
 * one. Anything else — including a repeated parameter, which arrives as an
 * array — is simply no notice, never text rendered from the URL.
 */
export function parseRoomTypeImageNotice(
  searchParams: Record<string, string | string[] | undefined>,
): RoomTypeImageNotice | null {
  const value = searchParams.action;

  if (typeof value !== "string" || !Object.hasOwn(ROOM_TYPE_IMAGE_NOTICES, value)) {
    return null;
  }

  return value as RoomTypeImageNotice;
}

const notice = (token: RoomTypeImageNotice, revalidate: RoomTypeImageRevalidation): RoomTypeImageOutcome => ({
  kind: "notice",
  token,
  revalidate,
});

const STALE: RoomTypeImageOutcome = { kind: "stale", revalidate: "detail" };
const LOGIN: RoomTypeImageOutcome = { kind: "login" };

/**
 * A malformed or foreign image reference, from the API's own body-matched
 * classification. Answered identically to `image-not-found`: from an
 * administrator's side, a reference this room type has never heard of and one
 * that could not have been issued at all mean the same thing, and telling
 * them apart would only be possible by explaining that the request was
 * tampered with — which is not information this surface exists to give.
 */
const IMAGE_UNREACHABLE = notice("image-not-found", "detail");

export function planRoomTypeImageUpload(state: AdminRoomTypeImageUploadResult["state"]): RoomTypeImageOutcome {
  switch (state) {
    case "ok":
      return notice("image-uploaded", "detail");

    case "unauthenticated":
      return LOGIN;

    case "invalid-reference":
    case "not-found":
      return STALE;

    case "invalid-image":
      return notice("image-invalid", "none");

    case "unsupported-type":
      return notice("image-unsupported-type", "none");

    case "too-large":
      return notice("image-too-large", "none");

    case "limit-reached":
      return notice("image-limit-reached", "detail");

    case "storage-unavailable":
      return notice("image-storage-unavailable", "none");

    case "delivery-unavailable":
      return notice("image-delivery-unavailable", "none");

    case "operation-failed":
      return notice("image-operation-failed", "detail");

    case "outcome-uncertain":
      return notice("image-outcome-uncertain", "detail");

    case "unavailable":
      return notice("image-unavailable", "detail");
  }
}

export function planRoomTypeImageAltText(state: AdminRoomTypeImageAltTextResult["state"]): RoomTypeImageOutcome {
  switch (state) {
    case "ok":
      return notice("image-updated", "detail");

    case "unauthenticated":
      return LOGIN;

    case "invalid-reference":
    case "not-found":
      return STALE;

    case "invalid-image-reference":
    case "image-not-found":
      return IMAGE_UNREACHABLE;

    case "invalid-update":
      return notice("image-update-refused", "none");

    case "outcome-uncertain":
      return notice("image-outcome-uncertain", "detail");

    case "unavailable":
      return notice("image-unavailable", "detail");
  }
}

export function planRoomTypeImageCover(state: AdminRoomTypeImageCoverResult["state"]): RoomTypeImageOutcome {
  switch (state) {
    case "ok":
      return notice("image-cover-updated", "detail");

    case "unauthenticated":
      return LOGIN;

    case "invalid-reference":
    case "not-found":
      return STALE;

    case "invalid-image-reference":
    case "image-not-found":
      return IMAGE_UNREACHABLE;

    case "outcome-uncertain":
      return notice("image-outcome-uncertain", "detail");

    case "unavailable":
      return notice("image-unavailable", "detail");
  }
}

/**
 * `ok` covers a real move and a boundary no-op identically — the API answers
 * both with the same 204, so the client already has no way to tell them
 * apart, and this planner does not invent one either.
 */
export function planRoomTypeImageMove(state: AdminRoomTypeImageMoveResult["state"]): RoomTypeImageOutcome {
  switch (state) {
    case "ok":
      return notice("image-order-updated", "detail");

    case "unauthenticated":
      return LOGIN;

    case "invalid-reference":
    case "not-found":
      return STALE;

    case "invalid-image-reference":
    case "image-not-found":
      return IMAGE_UNREACHABLE;

    case "invalid-direction":
      return notice("image-reorder-invalid", "none");

    case "outcome-uncertain":
      return notice("image-outcome-uncertain", "detail");

    case "unavailable":
      return notice("image-unavailable", "detail");
  }
}

/**
 * A successful delete is reported as deleted, full stop — never conditioned
 * on whatever the API's internal, unexposed storage-cleanup outcome was. An
 * uncertain commit is never reported as `image-deleted`: whether the rows are
 * actually gone is exactly what is not known, and the wording must not imply
 * otherwise.
 */
export function planRoomTypeImageDelete(state: AdminRoomTypeImageDeleteResult["state"]): RoomTypeImageOutcome {
  switch (state) {
    case "ok":
      return notice("image-deleted", "detail");

    case "unauthenticated":
      return LOGIN;

    case "invalid-reference":
    case "not-found":
      return STALE;

    case "invalid-image-reference":
    case "image-not-found":
      return IMAGE_UNREACHABLE;

    case "outcome-uncertain":
      return notice("image-outcome-uncertain", "detail");

    case "unavailable":
      return notice("image-unavailable", "detail");
  }
}
