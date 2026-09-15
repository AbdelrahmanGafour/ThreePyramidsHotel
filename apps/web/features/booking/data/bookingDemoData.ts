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

/** DEMO — optional arrival-time bands; not a real front-desk schedule. */
export const DEMO_ARRIVAL_WINDOWS = [
  "Before 2:00 PM",
  "2:00 PM – 6:00 PM",
  "6:00 PM – 10:00 PM",
  "After 10:00 PM (late arrival)",
] as const;

/**
 * DEMO — FRONTEND-ONLY PLACEHOLDER. Generates a fake reservation reference so
 * the confirmation screen can be reviewed. It reserves nothing, checks no
 * availability, and is not unique. A real reference must come from the
 * backend once a reservation is actually created.
 */
export function generateDemoBookingReference(): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TPH-${random}`;
}
