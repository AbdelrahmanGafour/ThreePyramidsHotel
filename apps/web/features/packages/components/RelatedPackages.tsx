import { RelatedJourneyRow } from "@/features/packages/components/RelatedJourneyRow";
import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { Package } from "@/features/packages/types";

// Compact rows, so this stays lightweight whether there are 2 other journeys
// or 19.
export function RelatedPackages({ packages }: { packages: Package[] }) {
  if (!packages.length) return null;

  return (
    <InfoSection title="Related journeys">
      <ul>
        {packages.map((pkg) => (
          <RelatedJourneyRow key={pkg.slug} pkg={pkg} />
        ))}
      </ul>
    </InfoSection>
  );
}
