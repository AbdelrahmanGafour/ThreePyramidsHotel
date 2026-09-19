import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackageAddOns } from "@/features/packages/components/PackageAddOns";
import { PackageBreadcrumb } from "@/features/packages/components/PackageBreadcrumb";
import { PackageDetailOpening } from "@/features/packages/components/PackageDetailOpening";
import { PackageFacts } from "@/features/packages/components/PackageFacts";
import { PackageInclusions } from "@/features/packages/components/PackageInclusions";
import { PackageInquiry } from "@/features/packages/components/PackageInquiry";
import { PackageItinerary } from "@/features/packages/components/PackageItinerary";
import { PackagePricing } from "@/features/packages/components/PackagePricing";
import { PackagesClosing } from "@/features/packages/components/PackagesClosing";
import { RelatedPackages } from "@/features/packages/components/RelatedPackages";
import { packages } from "@/features/packages/data/packagesDemoData";

type PackageDetailPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return packages.map((pkg) => ({ slug: pkg.slug }));
}

export async function generateMetadata({ params }: PackageDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const pkg = packages.find((item) => item.slug === slug);
  if (!pkg) return {};

  return {
    title: `${pkg.title} | Three Pyramids Boutique Hotel`,
    description: pkg.summary,
  };
}

export default async function PackageDetailPage({ params }: PackageDetailPageProps) {
  const { slug } = await params;
  const pkg = packages.find((item) => item.slug === slug);
  if (!pkg) notFound();

  const relatedPackages = packages.filter((item) => item.slug !== slug);

  return (
    <main id="main-content">
      <PackageBreadcrumb pkg={pkg} />
      <PackageDetailOpening pkg={pkg} />
      <PackageFacts pkg={pkg} />
      <PackageItinerary pkg={pkg} />
      <PackageInclusions pkg={pkg} />
      <PackageAddOns pkg={pkg} />
      <PackagePricing pkg={pkg} />
      <PackageInquiry pkg={pkg} />
      <RelatedPackages packages={relatedPackages} />
      <PackagesClosing
        title={`Ready to enquire about ${pkg.shortTitle}?`}
        text="Send a short inquiry and the hotel will follow up to shape the journey around your dates."
        href="#inquire"
        actionLabel="Enquire about this journey"
      />
    </main>
  );
}
