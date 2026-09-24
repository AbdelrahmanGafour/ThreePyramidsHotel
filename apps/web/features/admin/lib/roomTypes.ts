// The room-type area's routes, and the one notice its pages understand.
//
// Pure and framework-independent: plain values in, a string or null out. It
// lives beside the paging helper for the reservations list for the same
// reason — a route spelled out in several files is several things to keep in
// step.

export const ROOM_TYPES_PATH = "/admin/room-types";

/** Where a room type is created. A page, not a modal — it is a real address. */
export const ROOM_TYPES_NEW_PATH = "/admin/room-types/new";

/**
 * The address of one room type.
 *
 * The slug is encoded as exactly one path segment: it is data, and a stray
 * slash in it must not become part of the URL's structure.
 */
export function roomTypeDetailHref(slug: string): string {
  return `${ROOM_TYPES_PATH}/${encodeURIComponent(slug)}`;
}

/**
 * What the detail page may report about the edit that just happened.
 *
 * `uncertain` is not a failure. It is what an administrator is told when the
 * connection to the API broke around a save: the change may have been written
 * or may not, and the honest answer is that nobody knows yet.
 */
export const ROOM_TYPE_NOTICES = {
  saved: {
    tone: "done",
    message: "Saved. The details below are the ones now stored.",
  },
  refused: {
    tone: "warn",
    message:
      "Those changes were not saved because one of the values could not be accepted. Check the fields below and try again.",
  },
  uncertain: {
    tone: "warn",
    message:
      "The result of that save could not be confirmed — the hotel API did not answer. The change may or may not have been stored. Review the details below, which have just been re-read, before saving again.",
  },
  created: {
    tone: "done",
    message:
      "Room type created. It is not shown to guests and cannot be booked until it has rooms and is published, which is done separately.",
  },
  "capacity-saved": {
    tone: "done",
    message: "Capacity saved. It applies to searches and bookings made from now on.",
  },
  "capacity-refused": {
    tone: "warn",
    message:
      "That capacity was not saved because the value could not be accepted. Check the number and try again.",
  },
  "capacity-conflict": {
    // Deliberately no count, reference, date or guest: the API returns none,
    // and inventing a number would be worse than saying none.
    //
    // "a current or upcoming reservation" rather than "upcoming stays": a
    // guest who checked in yesterday and leaves tomorrow blocks the change
    // too, and only the bookings that exceed the proposed capacity block it —
    // not every reservation on the room type.
    tone: "warn",
    message:
      "The capacity was not changed. It cannot be lowered to that value while a current or upcoming reservation is booked for more guests than the proposed capacity. Those bookings must be cancelled or honoured first.",
  },
  "capacity-uncertain": {
    // Worded to hold for every cause of `unavailable` — a transport failure, a
    // 5xx, and an unusable body alike — so it claims nothing about whether the
    // API answered. It also must not promise a refreshed capacity below,
    // because the read that follows the redirect can fail too.
    tone: "warn",
    message:
      "The result of that capacity change could not be confirmed. It may or may not have been applied. Review the current capacity before making another change; if the room type is not shown below, reload it later and check the capacity first.",
  },
} as const;

export type RoomTypeNotice = keyof typeof ROOM_TYPE_NOTICES;

/**
 * Reads `?action=`.
 *
 * Only the three tokens above are recognised, matched with `Object.hasOwn` so
 * an inherited property name cannot pass for one. Anything else — including a
 * repeated parameter, which arrives as an array — is simply no notice, never
 * text rendered from the URL.
 */
export function parseRoomTypeNotice(
  searchParams: Record<string, string | string[] | undefined>,
): RoomTypeNotice | null {
  const value = searchParams.action;

  if (typeof value !== "string" || !Object.hasOwn(ROOM_TYPE_NOTICES, value)) {
    return null;
  }

  return value as RoomTypeNotice;
}

/**
 * What the room-type **list** may report. Only one thing ends up here: a
 * creation whose outcome is unknown, because there is no detail page to send
 * the administrator to when the slug may or may not exist.
 */
export const ROOM_TYPE_LIST_NOTICES = {
  "create-uncertain": {
    tone: "warn",
    // Worded to be true in both states this page can be in. The catalogue is
    // re-read before the redirect, but that read can itself fail — so this
    // must not promise a refreshed list below, because there may not be one.
    // It also says nothing about why: `unavailable` covers no answer, a 5xx
    // and an unusable body alike.
    message:
      "The result of that creation could not be confirmed. The room type may or may not have been created. Review the current room types before submitting another creation request; if the catalogue is not shown below, reload it later and check whether the room type exists first.",
  },
} as const;

export type RoomTypeListNotice = keyof typeof ROOM_TYPE_LIST_NOTICES;

/** What the **create** page may report, both of which leave the form to retry. */
export const ROOM_TYPE_CREATE_NOTICES = {
  "create-refused": {
    tone: "warn",
    message:
      "The room type was not created because one of the values could not be accepted. Check the fields below and try again.",
  },
  "create-slug-taken": {
    tone: "warn",
    message:
      "The room type was not created because that reference is already in use. References are permanent, so choose a different one.",
  },
} as const;

export type RoomTypeCreateNotice = keyof typeof ROOM_TYPE_CREATE_NOTICES;

/**
 * Reads `?action=` against one allowlist.
 *
 * Shared by every notice surface. Only a token the map itself declares is
 * recognised, matched with `Object.hasOwn` so an inherited property name
 * cannot pass for one. Anything else — including a repeated parameter, which
 * arrives as an array — is simply no notice, never text rendered from the URL.
 */
export function parseNoticeToken<T extends string>(
  searchParams: Record<string, string | string[] | undefined>,
  notices: Record<T, unknown>,
): T | null {
  const value = searchParams.action;

  if (typeof value !== "string" || !Object.hasOwn(notices, value)) {
    return null;
  }

  return value as T;
}
