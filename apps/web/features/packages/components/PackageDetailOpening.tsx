import Image from "next/image";
import Link from "next/link";
import type { PublicPackageDetail } from "@/features/packages/api/contracts";
import { getPackageMedia } from "@/features/packages/data/packageMedia";
import { packagePriceSummary } from "@/features/packages/lib/publicPresentation";

export function PackageDetailOpening({ pkg }: { pkg: PublicPackageDetail }) {
  const media = getPackageMedia(pkg.slug);
  const price = packagePriceSummary(pkg);
  return (
    <section className="stone-section pb-[clamp(1.75rem,3vw,2.5rem)] pt-[clamp(0.25rem,1vw,0.75rem)] text-ink">
      <div className="page-grid"><div className="col-span-10 col-start-2 max-md:col-span-full lg:grid lg:grid-cols-[3fr_2fr] lg:items-start lg:gap-10">
        <div className="image-frame relative aspect-[4/3] lg:aspect-[16/10] lg:max-h-[540px]">
          <Image src={media.image} alt={media.imageAlt} fill priority sizes="(max-width: 1024px) 92vw, 58vw" className="object-cover" style={{ objectPosition: media.position }} />
        </div>
        <div className="mt-6 lg:mt-0">
          <p className="eyebrow">{pkg.code}</p>
          <h1 className="page-title mt-2 text-[clamp(1.9rem,3.2vw,2.4rem)]!">{pkg.title}</h1>
          {pkg.summary || pkg.description ? <p className="prose-body mt-3">{pkg.summary ?? pkg.description}</p> : null}
          <dl className="mt-5 grid gap-y-2 border-t border-ink/12 pt-4 text-[0.9375rem]">
            {pkg.durationLabel ? <div className="flex gap-2"><dt className="text-ink/68">Duration:</dt><dd className="font-semibold">{pkg.durationLabel}</dd></div> : null}
            {pkg.scheduleLabel ? <div className="flex gap-2"><dt className="text-ink/68">Schedule:</dt><dd className="font-semibold">{pkg.scheduleLabel}</dd></div> : null}
          </dl>
          <div className="mt-5 border-t border-ink/12 pt-5"><p className="text-[0.875rem] text-ink/68">Pricing</p><p className="display mt-1 text-[1.7rem] leading-none">{price.primary}</p><p className="mt-2 text-[0.9375rem] text-ink/75">{price.secondary}</p></div>
          <Link href="#reserve" className="btn btn-primary mt-5 w-full">Request this journey</Link>
          <p className="fine-print mt-2 text-center">No online payment. Requests start pending confirmation.</p>
        </div>
      </div></div>
    </section>
  );
}
