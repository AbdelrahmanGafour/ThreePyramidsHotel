import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackageBreadcrumb } from "@/features/packages/components/PackageBreadcrumb";
import { PackageDetailOpening } from "@/features/packages/components/PackageDetailOpening";
import { PackageFacts } from "@/features/packages/components/PackageFacts";
import { PackageInclusions } from "@/features/packages/components/PackageInclusions";
import { PackageItinerary } from "@/features/packages/components/PackageItinerary";
import { PackagePricing } from "@/features/packages/components/PackagePricing";
import { PackageReservationForm } from "@/features/packages/components/PackageReservationForm";
import { PackagesClosing } from "@/features/packages/components/PackagesClosing";
import { RelatedPackages } from "@/features/packages/components/RelatedPackages";
import { InfoSection } from "@/shared/components/ui/InfoSection";
import { loadPublicPackage, loadPublicPackages } from "@/features/packages/server/publicPackages";

type PackageDetailPageProps = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PackageDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadPublicPackage(slug);
  if (result.kind !== "success") return {};
  return {
    title: `${result.package.title} | Three Pyramids Boutique Hotel`,
    description: result.package.summary ?? result.package.description ?? undefined,
  };
}

export default async function PackageDetailPage({ params }: PackageDetailPageProps) {
  const { slug } = await params;
  const detail = await loadPublicPackage(slug);
  if (detail.kind === "not_found") notFound();
  if (detail.kind === "unavailable") {
    return <main id="main-content"><InfoSection title="Journey temporarily unavailable"><p className="prose-body">We could not load this journey right now. Please try again later or return to the journeys page.</p></InfoSection></main>;
  }

  const list = await loadPublicPackages();
  const related = list.kind === "success" ? list.packages.filter((item) => item.slug !== slug).slice(0, 3) : [];
  const pkg = detail.package;

  return (
    <main id="main-content">
      <PackageBreadcrumb pkg={pkg} />
      <PackageDetailOpening pkg={pkg} />
      <PackageFacts pkg={pkg} />
      {pkg.description && pkg.description !== pkg.summary ? <InfoSection title="About this journey"><p className="prose-body max-w-[65ch]">{pkg.description}</p></InfoSection> : null}
      <PackageItinerary pkg={pkg} />
      <PackageInclusions pkg={pkg} />
      <PackagePricing pkg={pkg} />
      <PackageReservationForm pkg={pkg} />
      <RelatedPackages packages={related} />
      <PackagesClosing
        title={`Questions about ${pkg.title}?`}
        text="Contact the hotel if you need help before sending another reservation request."
        href="#reserve"
        actionLabel="Request this journey"
      />
    </main>
  );
}
