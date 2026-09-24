// ═══════════════════════════════════════════════════════════════════════════
// DEMO BOOKING DATA — replace with backend/API integration before production.
// Every value in this file is provisional and exists so the booking UI can be
// built and reviewed without a live reservations system. Room inventory
// itself is NOT duplicated here — it's read from the real
// `features/rooms/data/roomsData.ts` source of truth (see `lib/eligibility.ts`).
// ═══════════════════════════════════════════════════════════════════════════

/** DEMO — countries list for the guest-details form. Not hotel data. */
export const DEMO_COUNTRIES = [
  "Egypt",
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Kuwait",
  "Jordan",
  "Lebanon",
  "United Kingdom",
  "Ireland",
  "France",
  "Germany",
  "Italy",
  "Spain",
  "Netherlands",
  "Switzerland",
  "Sweden",
  "Norway",
  "United States",
  "Canada",
  "Australia",
  "New Zealand",
  "India",
  "China",
  "Japan",
  "South Korea",
  "Singapore",
  "South Africa",
  "Brazil",
  "Other",
] as const;

// WFI-T06: DEMO_ARRIVAL_WINDOWS and generateDemoBookingReference were removed
// here. `arrivalTime` has no backend contract field and was dropped from the
// guest model (see features/booking/types.ts). The fake local booking
// reference was the review page's fabricated success path — removed with it
// (see features/booking/components/BookingSummary.tsx); a real reference
// will come only from a successful POST /api/v1/reservations in a later
// ticket.
