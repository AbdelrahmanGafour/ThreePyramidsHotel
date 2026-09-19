import Image from "next/image";
import Link from "next/link";
import type { Package } from "@/features/packages/types";

// A narrow row — small image beside text, with a visible "Explore journey"
// action — light enough to repeat without competing with the itinerary.
export function RelatedJourneyRow({ pkg }: { pkg: Package }) {
  return (
    <li className="flex items-center gap-4 border-t border-ink/12 py-4 first:border-t-0 first:pt-0">
      <div className="image-frame relative aspect-[4/5] w-16 shrink-0 sm:w-20" aria-hidden="true">
        <Image src={pkg.image} alt="" fill sizes="80px" className="object-cover" style={{ objectPosition: pkg.position }} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="display text-[1.2rem] leading-[1.15] text-ink">{pkg.shortTitle}</h3>
        <p className="mt-1 text-[0.9375rem] text-ink/75">
          {pkg.duration} &middot; {pkg.route.join(" · ")}
        </p>
      </div>
      <Link
        href={`/packages/${pkg.slug}`}
        className="btn btn-secondary shrink-0 px-4"
        aria-label={`Explore journey: ${pkg.shortTitle}`}
      >
        Explore
      </Link>
    </li>
  );
}
