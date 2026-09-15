import Link from "next/link";
import type { Package } from "@/features/packages/types";

type PackageBreadcrumbProps = {
  pkg: Package;
};

// No collection index here — unlike a room's door-plate number, journeys
// aren't a physical sequence, so a bare "01/02/03" would be decoration
// without meaning. The itinerary below is where day numbering earns its
// place, since days genuinely are a sequence.
export function PackageBreadcrumb({ pkg }: PackageBreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className="stone-section px-[var(--page-x)] pt-[clamp(1.5rem,3vw,2rem)]">
      <ol className="flex items-center gap-2.5 text-[0.6rem] font-black uppercase tracking-[0.16em] text-ink/52">
        <li>
          <Link href="/packages" className="transition-colors hover:text-brass">
            Journeys
          </Link>
        </li>
        <li aria-hidden="true" className="text-ink/24">
          /
        </li>
        <li aria-current="page" className="text-brass/75">
          {pkg.shortTitle}
        </li>
      </ol>
    </nav>
  );
}
