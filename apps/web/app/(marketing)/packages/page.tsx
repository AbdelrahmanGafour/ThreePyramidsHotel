import type { Metadata } from "next";
import { JourneyList } from "@/features/packages/components/JourneyList";
import { PackagesClosing } from "@/features/packages/components/PackagesClosing";
import { PackagesHero } from "@/features/packages/components/PackagesHero";
import { PackagesTrustBand } from "@/features/packages/components/PackagesTrustBand";
import { packages } from "@/features/packages/data/packagesDemoData";

export const metadata: Metadata = {
  title: "Curated Journeys | Three Pyramids Boutique Hotel",
  description:
    "Curated journeys from Three Pyramids Boutique Hotel in Giza — a stay paired with a planned route of places and experiences. See the duration, route, and price per person for each.",
};

export default function PackagesPage() {
  return (
    <main id="main-content">
      <PackagesHero />
      <JourneyList packages={packages} />
      <PackagesTrustBand />
      <PackagesClosing
        title="Not sure which journey suits you?"
        text="Tell us your dates and interests and the hotel will suggest a journey and shape it around you."
      />
    </main>
  );
}
