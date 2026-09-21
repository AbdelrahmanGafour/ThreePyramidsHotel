// Shared types for the frontend booking flow. This is the integration
// boundary a backend/API team can target: swap the DEMO data/lib functions
// elsewhere in `features/booking/` for real calls without changing these
// shapes, and the UI components keep working unchanged.

// WFI-T06: fields limited to exactly what the reservation contract needs
// (roomTypeSlug/dates/adults/children live elsewhere in BookingState).
// `arrivalTime` was removed — it has no equivalent in
// apps/api/src/modules/reservations/reservations.types.ts and must not be
// sent as, or replaced by, an unsupported field.
export type GuestDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  specialRequests: string;
};

export const emptyGuestDetails: GuestDetails = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  country: "",
  specialRequests: "",
};

/**
 * WFI-T07: exactly the backend's 201 response from POST /api/v1/reservations
 * (see features/booking/lib/reservations.ts's CreatedReservation) — nothing
 * added, calculated, or fabricated by the frontend.
 */
export type BookingConfirmation = {
  bookingReference: string;
  status: "pending";
  roomType: { slug: string; name: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  /** Backend's exact decimal string — never parsed to a number. */
  nightlyRate: string;
  /** Backend's exact decimal string — never parsed to a number. */
  totalAmount: string;
  currency: "EGP";
};

/**
 * WFI-T05: the last live GET /api/v1/availability result for the selected
 * room, captured at the moment of selection â€” informational/display-only for
 * later steps. NEVER proof the room is still available and NEVER an
 * authoritative price: the backend re-checks both at reservation creation.
 * Cleared whenever the stay (dates/guests) changes, since a snapshot tied to
 * different search criteria can no longer be trusted even for display.
 */
export type AvailabilitySnapshot = {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  roomTypeSlug: string;
  roomName: string;
  /** Backend's exact decimal string â€” never parsed to a number. */
  nightlyRate: string;
  /** Backend's exact decimal string â€” never parsed to a number. */
  totalAmount: string;
  currency: "EGP";
  nights: number;
};

/**
 * V1 reservation: exactly one room of one room type per booking. There is no
 * room count â€” a larger party books separate reservations.
 */
export type BookingState = {
  /** ISO "YYYY-MM-DD" or null while unset. */
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  children: number;
  /**
   * The canonical backend room-type slug. Named `selectedRoomSlug` (not the
   * sprint's `roomTypeSlug` terminology) as a deliberate WFI-T05 compatibility
   * decision: renaming would also require touching booking review/
   * confirmation, which this ticket is explicitly scoped to leave untouched.
   * The value itself is already the real backend slug â€” only the field name
   * is legacy.
   */
  selectedRoomSlug: string | null;
  /** Live display snapshot for the selected slug; cleared when stay criteria change while the slug may remain as a provisional selection. */
  availabilitySnapshot: AvailabilitySnapshot | null;
  guest: GuestDetails;
  termsAccepted: boolean;
  confirmation: BookingConfirmation | null;
  /**
   * PR #17: set when a reservation submission from this session came back
   * `uncertain` (the client could not prove whether PostgreSQL committed it).
   * Persisted (not local component state) so the lock survives a
   * BookingSummary remount/navigation/refresh within the same session — an
   * uncertain reservation may already exist, and editing fields afterward
   * does not prove that it doesn't. Cleared only by a full reset or a
   * subsequent successful confirmation.
   */
  reservationSubmissionUncertain: boolean;
};

/** V1 presentation pricing is shown in USD only, matching the Rooms and Journeys demo data. */
export type BookingCurrency = "USD";

/** V1 price for one room: `total = nightlyRate Ã— nights`. No taxes, fees, or multi-room pricing. */
export type PriceBreakdown = {
  currency: BookingCurrency;
  nightlyRate: number;
  nights: number;
  total: number;
};
