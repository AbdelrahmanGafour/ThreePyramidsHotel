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
 * What an administrator may ask a reservation to become.
 *
 * Derived from the status union rather than restated, so the two cannot drift:
 * `pending` is where a booking starts, never somewhere it can be sent, and a
 * reservation that has been confirmed or cancelled never returns to it.
 */
export type AdminReservationStatusTarget = Exclude<AdminReservationStatus, "pending">;

/**
 * What the API reports after a status change: what changed, and what identifies
 * it. No ids, no guest, no room, no pricing, and no echo of the previous status
 * — a caller that asked for a change already knows what it asked from.
 */
export type AdminReservationStatusChange = {
  bookingReference: string;
  status: AdminReservationStatusTarget;
  /** ISO 8601 instant, as the API reported it. */
  updatedAt: string;
};

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

/**
 * One reservation in full, exactly as the API's detail endpoint returns it.
 *
 * Wider than the list item on purpose: a receptionist needs the guest's phone,
 * the party size, the special requests and which physical room was allocated.
 * That last one is exposed nowhere else — not by the list, and never to a
 * guest.
 *
 * Absent by design: the database `id`, `roomId` and `roomTypeId`, which are
 * internal join keys, and `updatedAt`, which stays meaningless until something
 * writes to it. Money is an exact decimal string and the stay dates are plain
 * calendar days; neither is ever a number or a Date.
 */
export type AdminReservationDetail = {
  bookingReference: string;
  status: AdminReservationStatus;
  guest: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    country: string;
  };
  stay: {
    /** "YYYY-MM-DD". */
    checkIn: string;
    /** "YYYY-MM-DD". Half-open: the guest leaves on this day. */
    checkOut: string;
    nights: number;
    adults: number;
    children: number;
  };
  roomType: {
    slug: string;
    name: string;
  };
  room: {
    number: string;
  };
  pricing: {
    /** The rate accepted at booking time, not the room type's rate today. */
    nightlyRate: string;
    totalAmount: string;
    currency: "EGP";
  };
  specialRequests: string | null;
  /** ISO 8601 instant. */
  createdAt: string;
};

/** The window a caller asks for. Validated before it reaches the API client. */
export type AdminReservationListWindow = {
  limit: number;
  offset: number;
};

/**
 * One row of the admin room-type list.
 *
 * `roomCount` is how many physical rooms belong to this type — inventory, not
 * availability. It says nothing about what is bookable tonight, and a type
 * showing zero can never be booked at all.
 *
 * Money and measurements are exact decimal strings, as the API returned them;
 * neither is ever a number.
 */
export type AdminRoomTypeListItem = {
  slug: string;
  name: string;
  capacity: number;
  baseNightlyRate: string;
  currency: "EGP";
  isActive: boolean;
  sortOrder: number;
  roomCount: number;
  /** ISO 8601 instant. */
  updatedAt: string;
};

/**
 * One room type in full. The database `id` is absent by design — it is an
 * internal join key with no meaning outside the database.
 */
export type AdminRoomTypeDetail = {
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  capacity: number;
  bedType: string | null;
  bedCount: number | null;
  sizeSqm: string | null;
  view: string | null;
  baseNightlyRate: string;
  currency: "EGP";
  isActive: boolean;
  sortOrder: number;
  roomCount: number;
  /** ISO 8601 instant. */
  createdAt: string;
  /** ISO 8601 instant. */
  updatedAt: string;
};

/**
 * What an administrator may change about a room type in V1: these nine fields
 * and nothing else.
 *
 * `slug`, `capacity` and `isActive` are absent by decision — the slug is the
 * public identifier, capacity governs availability and reservation limits, and
 * archiving is consequential enough to deserve its own action. `id`,
 * `currency`, `roomCount` and the timestamps are the server's own.
 */
export type AdminRoomTypeUpdate = {
  name?: string;
  shortDescription?: string | null;
  description?: string | null;
  bedType?: string | null;
  bedCount?: number | null;
  sizeSqm?: string | null;
  view?: string | null;
  baseNightlyRate?: string;
  sortOrder?: number;
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
