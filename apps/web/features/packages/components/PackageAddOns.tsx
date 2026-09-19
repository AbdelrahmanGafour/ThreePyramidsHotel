import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { Package } from "@/features/packages/types";

// A plain list, not a shopping cart — add-ons are mentioned so a guest knows
// to ask, not selected or priced inline here.
export function PackageAddOns({ pkg }: { pkg: Package }) {
  if (!pkg.addOns?.length) return null;

  return (
    <InfoSection title="Optional additions" intro="Extras you can add to this journey.">
      <ul className="grid gap-x-8 sm:grid-cols-2">
        {pkg.addOns.map((addOn, index) => (
          <li
            key={addOn.label}
            className={`border-t border-ink/12 py-3 ${index === 0 ? "border-t-0 pt-0" : ""} ${index === 1 ? "sm:border-t-0 sm:pt-0" : ""}`}
          >
            <p className="text-[1.0625rem] font-semibold text-ink">{addOn.label}</p>
            {addOn.description ? <p className="mt-1 text-[0.9375rem] text-ink/75">{addOn.description}</p> : null}
          </li>
        ))}
      </ul>
      <p className="fine-print mt-4">Ask when you enquire — pricing depends on your dates and group.</p>
    </InfoSection>
  );
}
