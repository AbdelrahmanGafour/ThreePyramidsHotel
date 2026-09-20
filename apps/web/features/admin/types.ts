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

/**
 * The signed-in administrator, exactly as the API's session endpoint reports
 * them — these two fields and nothing else. V1 has a single permission level,
 * so there is deliberately no role or permission field to model.
 */
export type AdminAccount = {
  email: string;
  displayName: string;
};

/**
 * The statuses a real reservation can hold, mirroring the database's
 * `reservations_status_check`.
 *
 * Deliberately narrower than `ReservationStatus` below, which is the demo
 * overview panels' richer operational vocabulary. The two are not the same set
 * and must not be merged until the backend actually models check-in/check-out.
 */
export type AdminReservationStatus = "pending" | "confirmed" | "cancelled";

/**
 * One row of the admin reservations list, exactly as the API returns it.
 *
 * Declared here rather than beside the server-only client so a table component
 * can use it without importing across the server boundary. Money is an exact
 * decimal string and the stay dates are plain calendar days — neither is ever a
 * number or a Date.
 */
export type AdminReservationListItem = {
  bookingReference: string;
  guestName: string;
  guestEmail: string;
  roomType: {
    slug: string;
    name: string;
  };
  /** "YYYY-MM-DD". */
  checkIn: string;
  /** "YYYY-MM-DD". */
  checkOut: string;
  status: AdminReservationStatus;
  totalAmount: string;
  currency: "EGP";
  /** ISO 8601 instant. */
  createdAt: string;
};

/** The window these rows came from. `total` counts every reservation, not the page. */
export type AdminReservationListPagination = {
  limit: number;
  offset: number;
  total: number;
};

export type AdminReservationList = {
  reservations: AdminReservationListItem[];
  pagination: AdminReservationListPagination;
};

/** The window a caller asks for. Validated before it reaches the API client. */
export type AdminReservationListWindow = {
  limit: number;
  offset: number;
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
