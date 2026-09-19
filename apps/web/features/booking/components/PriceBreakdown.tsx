import { formatCurrency } from "@/features/booking/lib/pricing";
import type { PriceBreakdown as PriceBreakdownType } from "@/features/booking/types";

type PriceBreakdownProps = {
  breakdown: PriceBreakdownType;
};

// Presentational only — every number here is computed upstream by
// `lib/pricing.ts`, never in this component's JSX. V1: one room, nightly rate × nights.
export function PriceBreakdown({ breakdown }: PriceBreakdownProps) {
  const nightsLabel = `${breakdown.nights} night${breakdown.nights === 1 ? "" : "s"}`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 py-2 text-[1rem] text-ink/80">
        <span>
          {formatCurrency(breakdown.nightlyRate)} per night &times; {nightsLabel}
        </span>
        <span className="font-semibold text-ink">{formatCurrency(breakdown.total)}</span>
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-ink/20 pt-3">
        <span className="text-[1.0625rem] font-bold text-ink">Total for your stay</span>
        <span className="display text-[1.75rem] leading-none text-ink">{formatCurrency(breakdown.total)}</span>
      </div>

      <p className="fine-print mt-3">
        No payment is taken online. Payment is arranged directly with the hotel. Demo pricing shown for review only — not a
        confirmed rate.
      </p>
    </div>
  );
}
