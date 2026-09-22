import type { Metadata } from "next";
import { JourneyList } from "@/features/packages/components/JourneyList";
import { PackagesClosing } from "@/features/packages/components/PackagesClosing";
import { PackagesHero } from "@/features/packages/components/PackagesHero";
import { PackagesTrustBand } from "@/features/packages/components/PackagesTrustBand";
import { InfoSection } from "@/shared/components/ui/InfoSection";
import { loadPublicPackages } from "@/features/packages/server/publicPackages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Curated Journeys | Three Pyramids Boutique Hotel",
  description: "Browse public tours, excursions, multi-day packages and Nile cruises from Three Pyramids Boutique Hotel.",
};

export default async function PackagesPage() {
  const result = await loadPublicPackages();
  const packages = result.kind === "success" ? result.packages : [];

  return (
    <main id="main-content">
      <PackagesHero packages={packages} />
      {result.kind === "success" ? (
        <JourneyList packages={packages} />
      ) : (
        <InfoSection title="Journeys temporarily unavailable">
          <p className="prose-body">We could not load the current package catalogue. Please try again later or contact the hotel.</p>
        </InfoSection>
      )}
      <PackagesTrustBand />
      <PackagesClosing
        title="Need help choosing a journey?"
        text="Contact the hotel if you need help before sending a reservation request."
      />
    </main>
  );
}
