import type { PhysicalRoomNotice } from "./physicalRooms";
import type { RoomTypeCreateNotice, RoomTypeListNotice, RoomTypeNotice } from "./roomTypes";

/**
 * What a Server Action should do about each answer an API client gave.
 *
 * Pure: no request context, no network, no `next/*`. A Server Action cannot be
 * imported under a plain Node test without Next's request context, so the part
 * that *decides* — which notice, which page, what to re-read — lives here and
 * is tested directly. The action does exactly what the plan says and nothing
 * more.
 *
 * Deliberately not a second copy of the client's classification: these take a
 * state the client already decided and say what follows from it.
 */

/** Which canonical admin paths a successful or uncertain outcome invalidates. */
export type RevalidationScope = "none" | "list" | "detail" | "list-and-detail";

/** Where the administrator ends up, and with what fixed notice. */
export type InventoryOutcome =
  | { kind: "login" }
  /**
   * The resource named is not one the API will resolve. No notice: the page
   * being redirected to decides how that reads — the detail route renders its
   * own not-found — rather than the action inventing a state for it. Matches
   * the T01 convention exactly.
   */
  | { kind: "stale"; revalidate: RevalidationScope }
  | {
      kind: "notice";
      surface: "list" | "new" | "detail";
      token: RoomTypeNotice | RoomTypeListNotice | RoomTypeCreateNotice | PhysicalRoomNotice;
      revalidate: RevalidationScope;
    };

/** The states `createAdminRoomType` can return. */
type CreateState = "ok" | "unauthenticated" | "invalid-create" | "slug-taken" | "unavailable";

/**
 * Creating a room type.
 *
 * The uncertain case is the one that differs from every other operation here:
 * there is no detail page to send anyone to, because the slug may or may not
 * exist. The refreshed list is the only place the answer can be found, so that
 * is where they go.
 */
export function planRoomTypeCreate(state: CreateState): InventoryOutcome {
  switch (state) {
    case "ok":
      return { kind: "notice", surface: "detail", token: "created", revalidate: "list-and-detail" };

    case "unauthenticated":
      return { kind: "login" };

    case "invalid-create":
      // Nothing was asked of the API, or the API refused the body. Either way
      // the form is where the fix is.
      return { kind: "notice", surface: "new", token: "create-refused", revalidate: "none" };

    case "slug-taken":
      return { kind: "notice", surface: "new", token: "create-slug-taken", revalidate: "none" };

    case "unavailable":
      // The POST may already have committed. Never reported as a failure, and
      // never retried.
      return { kind: "notice", surface: "list", token: "create-uncertain", revalidate: "list" };
  }
}

/** The states `updateAdminRoomTypeCapacity` can return. */
type CapacityState =
  | "ok"
  | "unauthenticated"
  | "invalid-reference"
  | "invalid-capacity"
  | "not-found"
  | "capacity-conflict"
  | "unavailable";

export function planRoomTypeCapacity(state: CapacityState): InventoryOutcome {
  switch (state) {
    case "ok":
      return {
        kind: "notice",
        surface: "detail",
        token: "capacity-saved",
        revalidate: "list-and-detail",
      };

    case "unauthenticated":
      return { kind: "login" };

    case "invalid-capacity":
      return { kind: "notice", surface: "detail", token: "capacity-refused", revalidate: "none" };

    case "capacity-conflict":
      // Nothing was written. The refreshed page shows what is actually stored.
      return { kind: "notice", surface: "detail", token: "capacity-conflict", revalidate: "detail" };

    case "invalid-reference":
    case "not-found":
      return { kind: "stale", revalidate: "list" };

    case "unavailable":
      return {
        kind: "notice",
        surface: "detail",
        token: "capacity-uncertain",
        revalidate: "list-and-detail",
      };
  }
}

/** The states `updateAdminRoomTypeStatus` can return. */
type RoomTypeStatusState =
  | "ok"
  | "unauthenticated"
  | "invalid-reference"
  | "invalid-status"
  | "not-found"
  | "no-active-rooms"
  | "unavailable";

/**
 * Publishing or unpublishing a room type.
 *
 * The success token depends on which direction was asked for, so this takes
 * the target as well as the state — the same shape `planPhysicalRoomStatus`
 * uses for the same reason.
 *
 * Both the list and the detail are re-read on success: a room type appearing
 * or disappearing from the public site is a change the catalogue row shows
 * too.
 *
 * `no-active-rooms` is the only refusal an administrator can act on, and it
 * re-reads the detail so the rooms panel beside the notice shows what is
 * actually in service — which is where the fix is.
 */
export function planRoomTypeStatus(
  state: RoomTypeStatusState,
  targetIsActive: boolean,
): InventoryOutcome {
  switch (state) {
    case "ok":
      return {
        kind: "notice",
        surface: "detail",
        token: targetIsActive ? "published" : "unpublished",
        revalidate: "list-and-detail",
      };

    case "unauthenticated":
      return { kind: "login" };

    case "invalid-status":
      // The API refused the body. Nothing was written, and nothing about the
      // room type changed, so there is nothing to re-read.
      return { kind: "notice", surface: "detail", token: "status-refused", revalidate: "none" };

    case "no-active-rooms":
      return {
        kind: "notice",
        surface: "detail",
        token: "status-no-active-rooms",
        revalidate: "detail",
      };

    case "invalid-reference":
    case "not-found":
      return { kind: "stale", revalidate: "list" };

    case "unavailable":
      // The PATCH may already have committed. Never reported as a failure,
      // and never retried.
      return {
        kind: "notice",
        surface: "detail",
        token: "status-uncertain",
        revalidate: "list-and-detail",
      };
  }
}

/** The states `createAdminPhysicalRoom` can return. */
type AddRoomState =
  | "ok"
  | "unauthenticated"
  | "invalid-reference"
  | "invalid-create"
  | "not-found"
  | "room-number-taken"
  | "unavailable";

export function planPhysicalRoomAdd(state: AddRoomState): InventoryOutcome {
  switch (state) {
    case "ok":
      // The list is re-read too: a room type's roomCount changed.
      return { kind: "notice", surface: "detail", token: "room-added", revalidate: "list-and-detail" };

    case "unauthenticated":
      return { kind: "login" };

    case "invalid-create":
      return { kind: "notice", surface: "detail", token: "room-add-refused", revalidate: "none" };

    case "room-number-taken":
      return { kind: "notice", surface: "detail", token: "room-number-taken", revalidate: "none" };

    case "invalid-reference":
    case "not-found":
      return { kind: "stale", revalidate: "list" };

    case "unavailable":
      return {
        kind: "notice",
        surface: "detail",
        token: "room-add-uncertain",
        revalidate: "list-and-detail",
      };
  }
}

/** The states `updateAdminPhysicalRoom` can return. */
type RoomUpdateState =
  | "ok"
  | "unauthenticated"
  | "invalid-reference"
  | "invalid-update"
  | "not-found"
  | "room-number-taken"
  | "has-future-reservations"
  | "unavailable";

/**
 * Renaming a room.
 *
 * A successful rename answers with a *different* room number, which is
 * expected and is why the client does not check it against the request. Only
 * the room type's detail page needs re-reading: a rename changes no count on
 * the list.
 */
export function planPhysicalRoomRename(state: RoomUpdateState): InventoryOutcome {
  switch (state) {
    case "ok":
      return { kind: "notice", surface: "detail", token: "room-renamed", revalidate: "detail" };

    case "unauthenticated":
      return { kind: "login" };

    case "invalid-update":
      return { kind: "notice", surface: "detail", token: "room-rename-refused", revalidate: "none" };

    case "room-number-taken":
      return { kind: "notice", surface: "detail", token: "room-number-taken", revalidate: "none" };

    case "not-found":
      // Someone else renamed it between the page rendering and the submission.
      // The refreshed panel shows what the rooms are called now.
      return { kind: "notice", surface: "detail", token: "room-not-found", revalidate: "detail" };

    case "has-future-reservations":
      // Unreachable for a rename — the API only refuses this for a
      // deactivation — but mapped rather than left to fall through silently.
      return {
        kind: "notice",
        surface: "detail",
        token: "room-has-future-reservations",
        revalidate: "detail",
      };

    case "invalid-reference":
      return { kind: "stale", revalidate: "detail" };

    case "unavailable":
      // The rename may already have committed, so the old number may no longer
      // resolve. Never retried against it.
      return {
        kind: "notice",
        surface: "detail",
        token: "room-rename-uncertain",
        revalidate: "detail",
      };
  }
}

/**
 * Taking a room in or out of service.
 *
 * The success token depends on which direction was asked for, so this one
 * takes the target as well as the state.
 */
export function planPhysicalRoomStatus(
  state: RoomUpdateState,
  targetIsActive: boolean,
): InventoryOutcome {
  switch (state) {
    case "ok":
      return {
        kind: "notice",
        surface: "detail",
        token: targetIsActive ? "room-activated" : "room-deactivated",
        revalidate: "detail",
      };

    case "unauthenticated":
      return { kind: "login" };

    case "invalid-update":
      return { kind: "notice", surface: "detail", token: "room-status-refused", revalidate: "none" };

    case "has-future-reservations":
      // Nothing was written, and there is no way in this system to move a stay
      // to another room. A refusal, not a warning.
      return {
        kind: "notice",
        surface: "detail",
        token: "room-has-future-reservations",
        revalidate: "detail",
      };

    case "not-found":
      return { kind: "notice", surface: "detail", token: "room-not-found", revalidate: "detail" };

    case "room-number-taken":
      // Unreachable for a status-only change, which sends no room number, but
      // mapped rather than left to fall through silently.
      return { kind: "notice", surface: "detail", token: "room-number-taken", revalidate: "none" };

    case "invalid-reference":
      return { kind: "stale", revalidate: "detail" };

    case "unavailable":
      return {
        kind: "notice",
        surface: "detail",
        token: "room-status-uncertain",
        revalidate: "detail",
      };
  }
}
