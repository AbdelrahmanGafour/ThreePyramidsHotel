import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { PublicPackageDetail } from "@/features/packages/api/contracts";
import { childRuleLabel, formatUsdMoney, ratePartyLabel } from "@/features/packages/lib/publicPresentation";

export function PackagePricing({ pkg }: { pkg: PublicPackageDetail }) {
  if (!pkg.variants.length) return null;
  return (
    <InfoSection title="Pricing" intro={pkg.requiresPriceConfirmation ? "Published rates are shown, but the final price requires confirmation." : "Adult rates are per person and depend on total party size."}>
      <div className="grid gap-7">
        {pkg.variants.map((variant) => {
          const childRule = childRuleLabel(variant);
          return <section key={variant.key} className="border-t border-ink/12 pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="group-title">{variant.label}</h3>{variant.isDefault ? <span className="fine-print">Default option</span> : null}</div>
            {variant.rates.length ? <dl className="mt-3 grid gap-2 sm:grid-cols-3">{variant.rates.map((rate) => <div key={`${rate.minPartySize}-${rate.maxPartySize ?? "plus"}`} className="border-t border-ink/10 pt-3"><dt className="text-[0.875rem] text-ink/68">{ratePartyLabel(rate)}</dt><dd className="mt-1 font-semibold">{formatUsdMoney(rate.adultUnitRate)} <span className="font-normal text-ink/70">per adult</span></dd></div>)}</dl> : <p className="prose-body mt-3">Price requires confirmation for this option.</p>}
            {childRule ? <p className="fine-print mt-3">{childRule}</p> : null}
          </section>;
        })}
      </div>
    </InfoSection>
  );
}
