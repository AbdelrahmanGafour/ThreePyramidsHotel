import { JourneyRow } from "@/features/packages/components/JourneyRow";
import type { Package } from "@/features/packages/types";

type JourneyListProps = {
  packages: Package[];
};

// A calm, always-scannable list, not a navigator to switch between — every
// journey's facts, summary, price, and actions are visible at rest. No
// hover-driven image swap, no expand/collapse, no per-row animation.
export function JourneyList({ packages }: JourneyListProps) {
  return (
    <section aria-labelledby="journey-list-title" className="bg-ivory pb-[clamp(2.5rem,4.5vw,3.5rem)] pt-[clamp(1.5rem,3vw,2.25rem)] text-ink">
      <div className="page-grid">
        <div className="col-span-10 col-start-2 max-md:col-span-full">
          <h2 id="journey-list-title" className="section-title">
            Choose a journey
          </h2>
          <ol className="mt-4">
            {packages.map((pkg) => (
              <li key={pkg.slug} className="border-t border-ink/15 first:border-t-0">
                <JourneyRow pkg={pkg} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
