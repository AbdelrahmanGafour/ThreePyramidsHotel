import type { Package } from "@/features/packages/types";

type PackagePricingProps = {
  pkg: Package;
};

// Typographic columns divided by hairlines, not a SaaS pricing-table with a
// highlighted "recommended" tier — no source data classifies one option as
// preferred, so none is visually favored.
export function PackagePricing({ pkg }: PackagePricingProps) {
  if (!pkg.pricingOptions?.length) return null;

  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(2.5rem,4.5vw,3.5rem)] text-ink">
      <div className="page-grid">
        <div className="col-span-10 col-start-2 max-md:col-span-full">
          <h2 className="label text-aged-gold">Pricing</h2>

          <div className="mt-6 grid divide-y divide-ink/10 border-t border-ink/12 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {pkg.pricingOptions.map((option) => (
              <div key={option.label} className="py-5 sm:px-6 sm:first:pl-0 sm:last:pr-0">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-ink/56">{option.label}</p>
                <p className="display mt-3 text-[1.65rem] leading-none text-ink">${option.price}</p>
                <p className="mt-1.5 text-[0.76rem] text-ink/48">{option.unit}</p>
              </div>
            ))}
          </div>

          {pkg.cancellationSummary ? (
            <p className="mt-5 text-[0.76rem] text-ink/44">{pkg.cancellationSummary}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
