import Image from "next/image";
import Link from "next/link";
import type { Package } from "@/features/packages/types";

type RelatedJourneyRowProps = {
  pkg: Package;
};

// A narrow editorial row, not a room-style plate — a small image strip
// beside text, light enough to repeat for many journeys without competing
// with the itinerary that dominates the rest of this page.
export function RelatedJourneyRow({ pkg }: RelatedJourneyRowProps) {
  return (
    <Link href={`/packages/${pkg.slug}`} className="group flex items-center gap-4 border-t border-ink/10 py-4 first:border-t-0">
      <div className="image-frame relative aspect-[4/5] w-16 shrink-0 sm:w-20">
        <Image src={pkg.image} alt="" fill sizes="80px" className="object-cover" style={{ objectPosition: pkg.position }} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="display truncate text-[1.05rem] leading-[1.1] text-ink">{pkg.shortTitle}</h3>
        <p className="mt-1 truncate text-[0.72rem] font-bold uppercase tracking-[0.06em] text-ink/48">
          {pkg.duration} &middot; {pkg.route.join(" · ")}
        </p>
      </div>
      <span className="text-link shrink-0 text-ink/72 group-hover:text-ink">Explore -&gt;</span>
    </Link>
  );
}
