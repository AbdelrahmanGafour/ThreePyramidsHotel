import { PageOpening } from "@/shared/components/ui/PageOpening";
import type { PublicPackageCard } from "@/features/packages/api/contracts";
import { formatEgp, lowestPackageFrom } from "@/features/packages/lib/publicPresentation";

export function PackagesHero({ packages }: { packages: PublicPackageCard[] }) {
  const lowest = lowestPackageFrom(packages);
  return (
    <PageOpening
      eyebrow="Journeys and experiences"
      title="Curated journeys"
      meta={
        <>
          {packages.length} journey{packages.length === 1 ? "" : "s"}
          {lowest ? <> &middot; from {formatEgp(lowest)} per person</> : null}
        </>
      }
    >
      Explore day tours, excursions, multi-day journeys and Nile cruises, then send a reservation request for your preferred date.
    </PageOpening>
  );
}
