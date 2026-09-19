import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { Package } from "@/features/packages/types";

// Label above value, in a plain grid — the quick facts a guest checks before
// reading the itinerary.
export function PackageFacts({ pkg }: { pkg: Package }) {
  const facts = [
    { label: "Duration", value: pkg.duration },
    { label: "Nights at the hotel", value: String(pkg.nights) },
    { label: "Route", value: pkg.route.join(" · ") },
    pkg.groupType ? { label: "Group type", value: pkg.groupType } : null,
    pkg.languages?.length ? { label: "Languages", value: pkg.languages.join(", ") } : null,
    pkg.pickup ? { label: "Pickup", value: pkg.pickup } : null,
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact));

  if (!facts.length) return null;

  return (
    <InfoSection title="Journey at a glance">
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label} className="border-t border-ink/12 pt-3">
            <dt className="text-[0.875rem] text-ink/68">{fact.label}</dt>
            <dd className="mt-0.5 text-[1.0625rem] font-semibold text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </InfoSection>
  );
}
