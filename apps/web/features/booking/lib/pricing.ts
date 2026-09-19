import type { BookingCurrency, PriceBreakdown } from "@/features/booking/types";

// PRESENTATION CURRENCY — matches the USD ("$") demo prices shown on the Rooms
// and Journeys pages so the whole public flow reads consistently. Replace with
// the client's confirmed pricing and currency before launch.
export const BOOKING_CURRENCY: BookingCurrency = "USD";

type CalculatePriceInput = {
  nightlyRate: number;
  nights: number;
};

/**
 * V1 pricing for a one-room reservation: nightly room-type rate × nights.
 * Pure calculation, isolated from components — no math in JSX. The frontend
 * adds no taxes, fees, or room multipliers; the accepted price snapshot will
 * come from the backend once reservations are created there.
 */
export function calculatePriceBreakdown({ nightlyRate, nights }: CalculatePriceInput): PriceBreakdown {
  const safeNights = Math.max(0, nights);

  return {
    currency: BOOKING_CURRENCY,
    nightlyRate,
    nights: safeNights,
    total: nightlyRate * safeNights,
  };
}

/** English UI representation of a USD amount, e.g. "$4,500". No conversion is applied. */
export function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
