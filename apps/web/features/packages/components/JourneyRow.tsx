import Image from "next/image";
import Link from "next/link";
import type { Package } from "@/features/packages/types";

type JourneyRowProps = {
  pkg: Package;
};

// One row per journey, fully readable at rest — title, duration, route,
// summary, price per person, and both actions are visible with no hover or
// click gate. "Explore journey" (secondary) opens the detail page;
// "Enquire" (primary) jumps straight to its inquiry form.
export function JourneyRow({ pkg }: JourneyRowProps) {
  return (
    <article className="grid gap-5 py-8 sm:grid-cols-[260px_1fr] sm:gap-8">
      <Link
        href={`/packages/${pkg.slug}`}
        aria-hidden="true"
        tabIndex={-1}
        className="image-frame group relative block aspect-[4/3] sm:aspect-[5/4]"
      >
        <Image
          src={pkg.image}
          alt=""
          fill
          sizes="(max-width: 640px) 92vw, 260px"
          className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.02]"
          style={{ objectPosition: pkg.position }}
        />
      </Link>

      <div className="flex flex-col">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="display text-[1.5rem] leading-[1.15]">
            <Link href={`/packages/${pkg.slug}`} className="inner-focus transition-colors hover:text-[var(--brass-ink)]">
              {pkg.title}
            </Link>
          </h3>
          {pkg.priceFrom ? (
            <p className="text-[0.9375rem] text-ink/75">
              From <span className="text-[1.125rem] font-bold text-ink">${pkg.priceFrom}</span> per person
            </p>
          ) : null}
        </div>

        <dl className="mt-3 grid gap-x-8 gap-y-2 text-[0.9375rem] sm:grid-cols-[auto_1fr]">
          <div className="flex gap-2">
            <dt className="text-ink/68">Duration:</dt>
            <dd className="font-semibold text-ink">{pkg.duration}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink/68">Route:</dt>
            <dd className="font-semibold text-ink">{pkg.route.join(" · ")}</dd>
          </div>
        </dl>

        <p className="prose-body mt-3 max-w-[60ch]">{pkg.summary}</p>

        <div className="mt-5 grid gap-3 sm:mt-auto sm:max-w-[26rem] sm:grid-cols-2 sm:pt-5">
          <Link
            href={`/packages/${pkg.slug}`}
            className="btn btn-secondary"
            aria-label={`Explore journey: ${pkg.shortTitle}`}
          >
            Explore journey
          </Link>
          <Link
            href={`/packages/${pkg.slug}#inquire`}
            className="btn btn-primary"
            aria-label={`Enquire about ${pkg.shortTitle}`}
          >
            Enquire
          </Link>
        </div>
      </div>
    </article>
  );
}
