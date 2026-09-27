// Shared types for the hotel administration area — the integration boundary a
// backend can target later. Components read only through these shapes.

export type AdminNavKey =
  | "overview"
  | "reservations"
  | "packageReservations"
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

/**
 * A new room type, as the API accepts it.
 *
 * `isActive` is absent because it is not a choice. A room type is created with
 * no physical rooms, so it cannot be allocated to anyone; the API writes
 * `false` itself and rejects a body that tries to say otherwise. Making a room
 * type public is a separate decision, and not one this release offers.
 *
 * The four required fields are required because their columns have no useful
 * default — and because two of them cannot be corrected afterwards: the slug is
 * the permanent public identifier, and capacity has its own guarded endpoint.
 *
 * The optional fields are `| null` rather than optional: "omitted" and "empty"
 * both mean not recorded, and the form resolves that once so nothing
 * downstream has to ask again.
 */
export type AdminRoomTypeCreate = {
  slug: string;
  name: string;
  capacity: number;
  /** Exact decimal string, never a number. */
  baseNightlyRate: string;
  sortOrder: number;
  shortDescription: string | null;
  description: string | null;
  bedType: string | null;
  bedCount: number | null;
  /** Exact decimal string, never a number. */
  sizeSqm: string | null;
  view: string | null;
};

/**
 * One physical room — what the hotel allocates, as against the room type a
 * guest books.
 *
 * The database `id` and `roomTypeId` are absent by design: both are internal
 * join keys with no meaning outside the database. A room is addressed by its
 * number, which is unique across the whole hotel.
 */
export type AdminPhysicalRoom = {
  roomNumber: string;
  isActive: boolean;
  /** ISO 8601 instant. */
  createdAt: string;
  /** ISO 8601 instant. */
  updatedAt: string;
};

/**
 * A new physical room. It carries no room type: which type a room belongs to
 * comes from the route it is created under, never from the body.
 */
export type AdminPhysicalRoomCreate = {
  roomNumber: string;
};

/**
 * A change to one physical room: its number, whether it is in service, or
 * both. At least one must be present, which the API enforces.
 *
 * `roomTypeId` is deliberately absent — moving a room between types is not
 * something this system does.
 */
export type AdminPhysicalRoomUpdate = {
  roomNumber?: string;
  isActive?: boolean;
};

/**
 * One image of one room type, exactly as the API's admin-safe DTO returns it.
 *
 * `reference` is the image's public identity — a canonical UUID, and the only
 * identifier this shape ever carries. Deliberately absent: `storageKey`,
 * `checksumSha256`, and both internal database ids (`media_assets.id`,
 * `room_type_images.id`) — none of them ever left the API in the first place,
 * so there is nothing to strip here; this type simply never grows a field for
 * them.
 *
 * `url` is the public image URL exactly as the API composed it. It is data
 * this app reads and passes to `next/image`, never something built here from
 * a hostname or an environment variable — `MEDIA_PUBLIC_BASE_URL` only tells
 * `next/image` which remote origin it may optimize, and has no bearing on
 * what this field's value actually is for one image.
 */
export type AdminRoomTypeImage = {
  reference: string;
  url: string;
  contentType: "image/webp";
  byteSize: number;
  width: number;
  height: number;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
  /** ISO 8601 instant. */
  createdAt: string;
  /** ISO 8601 instant. */
  updatedAt: string;
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

// ---------------------------------------------------------------------------
// Package reservations
//
// Deliberately separate from the room reservation types above. The two look
// alike and are not the same thing: a package reservation consumes no room
// inventory, is priced in USD, and may legitimately carry no total at all.
// ---------------------------------------------------------------------------

export type AdminPackageReservationStatus = "pending" | "confirmed" | "cancelled";

/**
 * What an administrator may ask a package reservation to become.
 *
 * Derived from the status union rather than restated, so the two cannot drift.
 * The API is stricter still: only a `pending` reservation may move at all, and
 * both `confirmed` and `cancelled` are terminal. That rule lives there, and
 * this type only says which words a request may carry.
 */
export type AdminPackageReservationStatusTarget = Exclude<
  AdminPackageReservationStatus,
  "pending"
>;

/**
 * Whether the stored total is a real quote or a promise to quote later.
 *
 * `requires_confirmation` is not an error and not a missing value: the API
 * returns `totalAmountSnapshot: null` for exactly these, which must be shown
 * as "to be confirmed" and never as zero.
 */
export type AdminPackageReservationPricingStatus = "quoted" | "requires_confirmation";

/**
 * One row of the admin package reservations list, exactly as the API returns
 * it. Declared here rather than beside the server-only client so a table
 * component can use it without importing across the server boundary.
 *
 * No database id of any kind: a reservation is identified by its booking
 * reference, and a package or variant by slug and key.
 */
export type AdminPackageReservationListItem = {
  bookingReference: string;
  package: {
    code: string;
    slug: string;
    title: string;
  };
  variant: {
    key: string;
    label: string;
  };
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  /** "YYYY-MM-DD". */
  tourDate: string;
  adults: number;
  children: number;
  status: AdminPackageReservationStatus;
  pricingStatus: AdminPackageReservationPricingStatus;
  currency: "USD";
  /** The exact decimal string, or null when the total awaits confirmation. */
  totalAmountSnapshot: string | null;
  /** ISO 8601 instant. */
  createdAt: string;
};

/** No pagination yet: the API returns every reservation, newest first. */
export type AdminPackageReservationList = {
  reservations: AdminPackageReservationListItem[];
};

/**
 * One package reservation in full.
 *
 * Defined as the list item plus the rest, so "the detail shows everything the
 * list shows" is true by construction and cannot drift as either changes.
 * Still no database id of any kind.
 */
export type AdminPackageReservationDetail = AdminPackageReservationListItem & {
  guestCountry: string;
  /** One age per child, or null when exact child pricing never needed them. */
  childAges: number[] | null;
  specialRequests: string | null;
  /** The exact decimal strings the reservation was quoted at, never recomputed. */
  adultUnitRateSnapshot: string;
  childUnitRateSnapshot: string | null;
};

// ---------------------------------------------------------------------------
// Package catalogue
// ---------------------------------------------------------------------------

/**
 * Who authors a package row.
 *
 * The API reports this; the database's own `seed_managed` boolean never
 * reaches this app. `brochure` means the catalogue seed still reconciles the
 * offering, so an edit would be overwritten until ownership moves; `admin`
 * means an administrator owns it and the seed leaves it alone.
 */
export type AdminPackageManagementSource = "brochure" | "admin";

/**
 * One row of the admin catalogue list, exactly as the API returns it.
 *
 * Declared here rather than beside the server-only client so a table
 * component can use it without importing across the server boundary. No
 * database id of any kind: a package is addressed by `code` and `slug`.
 */
export type AdminPackageListItem = {
  code: string;
  /** Kept for the detail route this list will link to once that page exists. */
  slug: string;
  title: string;
  summary: string | null;
  durationLabel: string | null;
  scheduleLabel: string | null;
  requiresPriceConfirmation: boolean;
  isActive: boolean;
  sortOrder: number;
  managementSource: AdminPackageManagementSource;
  variantCount: number;
  defaultVariantLabel: string | null;
};

/** No pagination yet: the API returns the whole catalogue in running order. */
export type AdminPackageList = {
  packages: AdminPackageListItem[];
};

/** One party-size tier, exactly as the API stored it. No figure is computed. */
export type AdminPackageRateTier = {
  minPartySize: number;
  /** null means unbounded — a "3 or more" tier. */
  maxPartySize: number | null;
  adultUnitRate: string;
  currency: "USD";
};

/**
 * One variant of a journey. The child-pricing trio is all-or-nothing: the
 * three fields are null together or set together.
 */
export type AdminPackageVariant = {
  key: string;
  label: string;
  isDefault: boolean;
  sortOrder: number;
  childMinAge: number | null;
  childMaxAge: number | null;
  childDiscountPercent: string | null;
  rates: AdminPackageRateTier[];
};

export type AdminPackageItinerarySection = {
  /** null for a section about the whole journey rather than one day. */
  dayNumber: number | null;
  heading: string | null;
  body: string;
};

/** The content items, already grouped by the API into the three kinds. */
export type AdminPackageContent = {
  included: string[];
  excluded: string[];
  notes: string[];
};

/**
 * One journey in full.
 *
 * Defined as the list item plus the rest, so "the detail shows everything the
 * list shows" is true by construction. Still no database id of any kind.
 */
/**
 * The journey's one image, as the admin API reports it.
 *
 * Five fields, and deliberately no more. There is no storage key, no
 * checksum, no content type, no byte size and no database id in this type,
 * so none of them can reach a component even if a future response carried
 * one. `reference` is the opaque identifier the media endpoints address an
 * image by; `url` is what an `<Image>` loads.
 */
export type AdminPackageImage = {
  reference: string;
  url: string;
  altText: string | null;
  width: number;
  height: number;
};

export type AdminPackageDetail = AdminPackageListItem & {
  description: string | null;
  operatingDays: string[] | null;
  itinerary: AdminPackageItinerarySection[];
  content: AdminPackageContent;
  variants: AdminPackageVariant[];
  /** The journey's image, or `null` when none has been uploaded. */
  image: AdminPackageImage | null;
};
