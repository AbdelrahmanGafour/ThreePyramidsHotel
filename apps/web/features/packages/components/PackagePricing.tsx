import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { Package } from "@/features/packages/types";

// Typographic columns divided by hairlines, not a SaaS pricing table with a
// highlighted "recommended" tier — no source data classifies one option as
// preferred, so none is visually favoured.
export function PackagePricing({ pkg }: { pkg: Package }) {
  if (!pkg.pricingOptions?.length) return null;

  return (
    <InfoSection title="Pricing">
      <div className="grid divide-y divide-ink/12 border-t border-ink/12 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {pkg.pricingOptions.map((option) => (
          <div key={option.label} className="py-4 sm:px-5 sm:py-1 sm:first:pl-0 sm:last:pr-0">
            <p className="text-[0.9375rem] font-semibold text-ink/80">{option.label}</p>
            <p className="display mt-2 text-[1.75rem] leading-none text-ink">${option.price}</p>
            <p className="mt-1.5 text-[0.9375rem] text-ink/75">{option.unit}</p>
          </div>
        ))}
      </div>

      {pkg.cancellationSummary ? <p className="prose-body mt-5">{pkg.cancellationSummary}</p> : null}
    </InfoSection>
  );
}
