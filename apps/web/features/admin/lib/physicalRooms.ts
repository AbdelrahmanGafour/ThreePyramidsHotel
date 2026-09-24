/**
 * What a physical-room operation may report.
 *
 * Every one of these renders on the room type's detail page, beside the rooms
 * panel — a room has no page of its own in this release. They live apart from
 * the room-type notices because they describe a different object with a
 * different lifecycle: a room type is published or archived, a room is in
 * service or out of it.
 *
 * Fixed text, allowlisted tokens. No submitted room number, no API message and
 * no exception text ever reaches a query parameter — a notice says what
 * happened, not what was typed.
 *
 * Three tokens are shared deliberately, because the user-visible meaning is
 * identical however the operation reached it:
 *
 *   room-number-taken  adding a room and renaming one both mean "some room
 *                      already has that number".
 *   room-not-found     renaming and changing status both mean "that room is
 *                      no longer there under that number".
 *
 * Pure: no request context, no network, no `next/*`.
 */
export const PHYSICAL_ROOM_NOTICES = {
  "room-added": {
    tone: "done",
    message: "Room added. It is in service and can be allocated to new bookings.",
  },
  "room-add-refused": {
    tone: "warn",
    message:
      "The room was not added because the room number could not be accepted. Check it and try again.",
  },
  "room-add-uncertain": {
    // True for every cause of `unavailable` — a transport failure, a 5xx and an
    // unusable body alike — so it claims nothing about whether the API
    // answered, and promises no refreshed list, because the read that follows
    // can fail too.
    tone: "warn",
    message:
      "The result of adding that room could not be confirmed. It may or may not have been added. Review the current rooms before adding another; if the inventory is not shown below, reload it later and check first.",
  },
  "room-renamed": {
    tone: "done",
    message: "Room number changed. Bookings already allocated to it are unaffected.",
  },
  "room-rename-refused": {
    tone: "warn",
    message:
      "The room number was not changed because the new number could not be accepted. Check it and try again.",
  },
  "room-rename-uncertain": {
    tone: "warn",
    message:
      "The result of that rename could not be confirmed. It may or may not have been applied. Review the current rooms before making another change; if the inventory is not shown below, reload it later and check which number the room now has.",
  },
  "room-number-taken": {
    tone: "warn",
    message:
      "That room number is already in use. Room numbers are unique across the whole hotel, and two that differ only by capitalisation count as the same number.",
  },
  "room-not-found": {
    // Neutral about why: rooms are never deleted by this system, and guessing
    // at a cause would be inventing one.
    tone: "warn",
    message:
      "The room could not be found under that number. The inventory may have changed; review the current room list before making another change.",
  },
  "room-activated": {
    tone: "done",
    message: "Room returned to service. It can be allocated to new bookings again.",
  },
  "room-deactivated": {
    tone: "done",
    message: "Room taken out of service. It will not be allocated to new bookings.",
  },
  "room-status-refused": {
    tone: "warn",
    message: "The room was not changed because the request could not be accepted.",
  },
  "room-has-future-reservations": {
    // Deliberately no count, reference, date or guest: the API returns none,
    // and a refusal is not a place to read reservation data out of.
    //
    // "current or upcoming" and "still pending or confirmed" together state the
    // API's actual rule: a stay that has ended, and one that was cancelled, do
    // not block anything.
    tone: "warn",
    message:
      "The room was not taken out of service. It has a current or upcoming reservation that is still pending or confirmed, so guests are booked into it. The reservation is not shown here — review reservations separately if this needs to change. A stay cannot be moved to another room.",
  },
  "room-status-uncertain": {
    tone: "warn",
    message:
      "The result of that change could not be confirmed. It may or may not have been applied. Review the current rooms before making another change; if the inventory is not shown below, reload it later and check whether the room is in service.",
  },
} as const;

export type PhysicalRoomNotice = keyof typeof PHYSICAL_ROOM_NOTICES;

/**
 * A DOM-safe key for one room number, for element ids only.
 *
 * A room number may legitimately contain internal spaces — `Suite 4` is a
 * valid one — and ASCII whitespace is not permitted in an HTML id, so
 * `room-rename-Suite 4` would not reliably associate a label with its input.
 *
 * `encodeURIComponent` percent-escapes whitespace and is injective, so two
 * different room numbers can never collide on one id.
 *
 * This is a presentation detail and nothing more. The displayed number, the
 * submitted form value, the argument bound to the Server Action and every API
 * path all continue to use the exact original string — never trimmed, never
 * re-cased.
 */
export function roomNumberDomKey(roomNumber: string): string {
  return encodeURIComponent(roomNumber);
}

/**
 * What renaming a physical room actually does, as fixed operational copy.
 *
 * Deliberately not "bookings are unaffected". A reservation's room number is
 * read live from the room it is allocated to, so renaming does change the
 * number shown against stays already booked into it. What it does not do is
 * move the reservation, or touch its dates, its guests or the price agreed.
 * Saying only the first half would be reassuring and wrong.
 */
export const PHYSICAL_ROOM_RENAME_HINT =
  "Renaming changes the room number shown for reservations assigned to this physical room. " +
  "It does not move those reservations or change their dates, guests or booked price.";
