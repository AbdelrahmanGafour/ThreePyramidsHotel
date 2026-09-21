// The room-type area's routes, and the one notice its pages understand.
//
// Pure and framework-independent: plain values in, a string or null out. It
// lives beside the paging helper for the reservations list for the same
// reason — a route spelled out in several files is several things to keep in
// step.

export const ROOM_TYPES_PATH = "/admin/room-types";

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
