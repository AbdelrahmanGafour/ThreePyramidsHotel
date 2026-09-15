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
    <div className="border-t border-ink/10 pt-4">
      <div className="flex items-baseline justify-between gap-4 py-2 text-[0.86rem] text-ink/68">
        <span>
          {formatCurrency(breakdown.nightlyRate)} × {nightsLabel}
        </span>
        <span className="text-ink/86">{formatCurrency(breakdown.total)}</span>
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-ink/12 pt-3">
        <span className="text-[0.9rem] font-bold text-ink">Total</span>
        <span className="display text-[1.4rem] leading-none text-ink">{formatCurrency(breakdown.total)}</span>
      </div>

      <p className="mt-3 text-[0.7rem] text-ink/40">Demo pricing shown for review only — not a confirmed rate.</p>
    </div>
  );
}
