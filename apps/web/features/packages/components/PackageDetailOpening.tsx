import Image from "next/image";
import Link from "next/link";
import type { Package } from "@/features/packages/types";

type PackageDetailOpeningProps = {
  pkg: Package;
};

// A calm two-column opening — image beside identity — the same rhythm as
// Room detail's gallery + summary panel: what the journey is, how long, what
// it starts at, and the one action, all before scrolling.
export function PackageDetailOpening({ pkg }: PackageDetailOpeningProps) {
  return (
    <section className="stone-section pb-[clamp(1.75rem,3vw,2.5rem)] pt-[clamp(0.25rem,1vw,0.75rem)] text-ink">
      <div className="page-grid">
        <div className="col-span-10 col-start-2 max-md:col-span-full lg:grid lg:grid-cols-[3fr_2fr] lg:items-start lg:gap-10">
          <div className="image-frame relative aspect-[4/3] lg:aspect-[16/10] lg:max-h-[540px]">
            <Image
              src={pkg.image}
              alt={pkg.imageAlt}
              fill
              priority
              sizes="(max-width: 1024px) 92vw, 58vw"
              className="object-cover"
              style={{ objectPosition: pkg.position }}
            />
          </div>

          <div className="mt-6 lg:mt-0">
            <p className="eyebrow">{pkg.eyebrow}</p>

            <h1 className="page-title mt-2 text-[clamp(1.9rem,3.2vw,2.4rem)]!">{pkg.title}</h1>

            <p className="prose-body mt-3">{pkg.summary}</p>

            <dl className="mt-5 grid gap-y-2 border-t border-ink/12 pt-4 text-[0.9375rem]">
              <div className="flex gap-2">
                <dt className="text-ink/68">Duration:</dt>
                <dd className="font-semibold">{pkg.duration}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink/68">Route:</dt>
                <dd className="font-semibold">{pkg.route.join(" · ")}</dd>
              </div>
            </dl>

            {pkg.priceFrom ? (
              <div className="mt-5 border-t border-ink/12 pt-5">
                <p className="text-[0.875rem] text-ink/68">Starting price</p>
                <p className="mt-1">
                  <span className="display text-[2rem] leading-none">${pkg.priceFrom}</span>
                  <span className="ml-2 text-[0.9375rem] text-ink/75">per person</span>
                </p>
              </div>
            ) : null}

            <Link href="#inquire" className="btn btn-primary mt-5 w-full">
              Enquire about this journey
            </Link>
            <p className="fine-print mt-2 text-center">Send a short inquiry. Nothing is booked or charged.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
