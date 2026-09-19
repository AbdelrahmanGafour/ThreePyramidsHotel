// Shared types for the hotel administration area — the integration boundary a
// backend can target later. Components read only through these shapes.

export type AdminNavKey =
  | "overview"
  | "reservations"
  | "rooms"
  | "journeys"
  | "inquiries"
  | "content"
  | "media"
  | "settings";

export type AdminNavItem = {
  key: AdminNavKey;
  label: string;
  href: string;
  /** One line describing what this area will manage. */
  description: string;
  /** False until the module is built — rendered as a non-link, never a dead link. */
  available: boolean;
};

export type ReservationStatus = "confirmed" | "pending" | "cancelled" | "checked-in" | "checked-out";
export type RoomAvailability = "available" | "occupied" | "blocked";
export type InquiryStatus = "new" | "in-progress" | "replied";
export type InquiryKind = "journey" | "stay" | "general";

export type AdminReservation = {
  id: string;
  guestName: string;
  guestCount: number;
  roomSlug: string;
  /** ISO date (YYYY-MM-DD). */
  arrival: string;
  /** ISO date (YYYY-MM-DD). */
  departure: string;
  status: ReservationStatus;
};

/** Physical inventory for one room type. */
export type AdminRoomInventory = {
  roomSlug: string;
  totalUnits: number;
  occupiedUnits: number;
  blockedUnits: number;
};

export type AdminInquiry = {
  id: string;
  guestName: string;
  kind: InquiryKind;
  /** Set when `kind` is "journey". */
  journeySlug?: string;
  /** Hotel wall-clock time, ISO without offset (YYYY-MM-DDTHH:mm). */
  receivedAt: string;
  status: InquiryStatus;
};
