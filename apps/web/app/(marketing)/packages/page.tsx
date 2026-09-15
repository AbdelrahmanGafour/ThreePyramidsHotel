import type { Metadata } from "next";
import { JourneyNavigator } from "@/features/packages/components/JourneyNavigator";
import { PackagesClosing } from "@/features/packages/components/PackagesClosing";
import { PackagesHero } from "@/features/packages/components/PackagesHero";
import { PackagesTrustBand } from "@/features/packages/components/PackagesTrustBand";
import { packages } from "@/features/packages/data/packagesDemoData";

export const metadata: Metadata = {
  title: "Curated Journeys | Three Pyramids Boutique Hotel",
  description:
    "Curated journeys from Three Pyramids Boutique Hotel in Giza — a stay paired with a route composed around light, sequence, and stillness.",
};

export default function PackagesPage() {
  return (
    <main id="main-content">
      <PackagesHero />
      <JourneyNavigator packages={packages} />
      <PackagesTrustBand />
      <PackagesClosing copy="Every journey begins with a conversation about your dates and pace — enquire and the route is shaped around you." />
    </main>
  );
}
