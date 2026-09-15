import type { BookingCurrency, PriceBreakdown } from "@/features/booking/types";

export const BOOKING_CURRENCY: BookingCurrency = "EGP";

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

/** English UI representation of an EGP amount, e.g. "EGP 4,500". No conversion is applied. */
export function formatCurrency(amount: number): string {
  return `${BOOKING_CURRENCY} ${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
