import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { PublicPackageDetail } from "@/features/packages/api/contracts";

export function PackageItinerary({ pkg }: { pkg: PublicPackageDetail }) {
  if (!pkg.itinerary.length) return null;
  return (
    <InfoSection title="Itinerary" intro="The published itinerary for this journey.">
      <ol className="relative">
        <span aria-hidden="true" className="absolute bottom-10 left-[5px] top-2 w-px bg-brass/50" />
        {pkg.itinerary.map((section, index) => (
          <li key={`${section.dayNumber ?? "section"}-${index}`} className={`relative pl-10 ${index === pkg.itinerary.length - 1 ? "" : "pb-9"}`}>
            <span aria-hidden="true" className="absolute left-0 top-1.5 h-[11px] w-[11px] rotate-45 bg-brass" />
            {section.dayNumber !== null ? <p className="text-[0.9375rem] font-bold text-[var(--brass-ink)]">Day {section.dayNumber}</p> : null}
            {section.heading ? <h3 className="display mt-1 text-[1.3rem] leading-[1.2] text-ink">{section.heading}</h3> : null}
            <p className="prose-body mt-2 max-w-[60ch]">{section.body}</p>
          </li>
        ))}
      </ol>
    </InfoSection>
  );
}
