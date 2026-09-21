// Pure contract/validation module for the backend's created-reservation shape
// (apps/api/src/modules/reservations/reservations.types.ts's `CreatedReservation`,
// returned by POST /api/v1/reservations, and mirrored by
// apps/api/src/modules/reservations/booking-reference.ts's reference format).
//
// This is the ONE validator for that shape. Both the POST 201 response
// (features/booking/lib/reservations.ts) and the sessionStorage confirmation
// hydration (features/booking/context/BookingContext.tsx) call
// `isCreatedReservation` so the two can never drift apart. No network, no
// storage, no React — safe to unit-test directly.

/** Mirrors apps/api/src/modules/reservations/reservations.types.ts's CreatedReservation exactly. */
export type CreatedReservation = {
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

// Mirrors apps/api/src/modules/reservations/booking-reference.ts's ALPHABET/
// TOKEN_LENGTH/PREFIX. Kept in sync manually — that module is server-only
// (imports node:crypto) and isn't reachable from the browser bundle.
const BOOKING_REFERENCE_PATTERN = /^TPH-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;

// Mirrors reservations.service.ts's CALENDAR_DATE_PATTERN.
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Backend money is always emitted by fromMinorUnits() as a non-negative
// integer part plus exactly two decimal digits (numeric(12,2) columns,
// snapshotted rates and totals are never negative). Stricter than "any
// decimal string" on purpose: a negative or oddly-scaled value here is
// malformed, not a legitimate reservation.
const MONEY_PATTERN = /^\d+\.\d{2}$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isFiniteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

/**
 * Parses a calendar date as UTC midnight, rejecting impossible dates (e.g.
 * "2026-02-30") that `Date` would otherwise roll over into a different day.
 * Mirrors reservations.service.ts's parseCalendarDate round-trip check.
 * Returns the UTC timestamp, or null if the string isn't a real calendar date.
 */
export function parseCalendarDateUTC(value: string): number | null {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }

  return timestamp;
}

/**
 * Structurally validates the backend's created-reservation shape. Deliberately
 * strict — a value that merely "looks close" is rejected, since a caller that
 * treats a malformed value as real would show the guest a fabricated
 * reference, price or status. Never fabricates or normalizes anything itself.
 */
export function isCreatedReservation(value: unknown): value is CreatedReservation {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;

  if (typeof r.bookingReference !== "string" || !BOOKING_REFERENCE_PATTERN.test(r.bookingReference)) return false;
  if (r.status !== "pending") return false;

  const roomType = r.roomType as Record<string, unknown> | null | undefined;
  if (typeof roomType !== "object" || roomType === null) return false;
  if (typeof roomType.slug !== "string" || roomType.slug.trim().length === 0) return false;
  if (typeof roomType.name !== "string" || roomType.name.trim().length === 0) return false;

  if (typeof r.checkIn !== "string" || typeof r.checkOut !== "string") return false;
  const checkInTs = parseCalendarDateUTC(r.checkIn);
  const checkOutTs = parseCalendarDateUTC(r.checkOut);
  if (checkInTs === null || checkOutTs === null) return false;
  if (checkOutTs <= checkInTs) return false;

  if (!isFiniteInt(r.nights) || r.nights <= 0) return false;
  // The backend derives nights from exact calendar-day arithmetic between the
  // two UTC-midnight timestamps — the response must agree with its own dates.
  if (r.nights !== (checkOutTs - checkInTs) / MS_PER_DAY) return false;

  if (!isFiniteInt(r.adults) || r.adults < 1) return false;
  if (!isFiniteInt(r.children) || r.children < 0) return false;
  if (!Number.isSafeInteger(r.adults + r.children)) return false;

  if (typeof r.nightlyRate !== "string" || !MONEY_PATTERN.test(r.nightlyRate)) return false;
  if (typeof r.totalAmount !== "string" || !MONEY_PATTERN.test(r.totalAmount)) return false;

  if (r.currency !== "EGP") return false;

  return true;
}
