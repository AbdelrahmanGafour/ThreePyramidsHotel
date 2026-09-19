import type { Room } from "@/features/rooms/data/roomsData";

/**
 * Capacity eligibility only — this is NOT date or inventory availability.
 * It answers one question: can the selected room type hold the whole party,
 * according to the current demo room capacity data (`room.sleeps`)? Whether a
 * room is actually free for the chosen dates, and conflict prevention between
 * reservations, belong to the backend/API; the frontend never infers
 * availability from dates.
 *
 * V1 rule: one reservation = one room, so the full party (adults + children)
 * must fit in a single room of that type. Guests are never split across rooms.
 *
 * Rooms are never hidden: a room that can't hold the party is shown and marked
 * with the reason, rather than silently disappearing from the list.
 */
export function getRoomUnavailableReason(room: Room, partySize: number): string | null {
  if (room.sleeps && room.sleeps < partySize) {
    return `this room sleeps up to ${room.sleeps} guests, and your party is ${partySize}.`;
  }
  return null;
}

export function hasAnyEligibleRoom(rooms: Room[], partySize: number): boolean {
  return rooms.some((room) => !getRoomUnavailableReason(room, partySize));
}
