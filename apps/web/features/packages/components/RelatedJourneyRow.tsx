import Image from "next/image";
import Link from "next/link";
import type { PublicPackageCard } from "@/features/packages/api/contracts";
import { resolvePackageImage } from "@/features/packages/lib/packageImage";

// Same resolver, same precedence, and the same reason for an empty `alt`:
// the thumbnail frame is `aria-hidden` and the journey is already named by
// the heading and the link next to it.
export function RelatedJourneyRow({ pkg }: { pkg: PublicPackageCard }) {
  const media = resolvePackageImage(pkg);
  return (
    <li className="flex items-center gap-4 border-t border-ink/12 py-4 first:border-t-0 first:pt-0">
      <div className="image-frame relative aspect-[4/5] w-16 shrink-0 sm:w-20" aria-hidden="true">
        <Image src={media.src} alt="" fill sizes="80px" className="object-cover" style={{ objectPosition: media.position }} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="display text-[1.2rem] leading-[1.15] text-ink">{pkg.title}</h3>
        <p className="mt-1 text-[0.9375rem] text-ink/75">{[pkg.durationLabel, pkg.scheduleLabel].filter(Boolean).join(" · ")}</p>
      </div>
      <Link href={`/packages/${pkg.slug}`} className="btn btn-secondary shrink-0 px-4">Explore</Link>
    </li>
  );
}
