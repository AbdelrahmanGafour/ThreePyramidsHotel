import { RelatedJourneyRow } from "@/features/packages/components/RelatedJourneyRow";
import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { PublicPackageCard } from "@/features/packages/api/contracts";

export function RelatedPackages({ packages }: { packages: PublicPackageCard[] }) {
  if (!packages.length) return null;
  return <InfoSection title="Related journeys"><ul>{packages.map((pkg) => <RelatedJourneyRow key={pkg.slug} pkg={pkg} />)}</ul></InfoSection>;
}
