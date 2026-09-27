import Image from "next/image";
import Link from "next/link";
import type { PublicPackageCard } from "@/features/packages/api/contracts";
import { resolvePackageImage } from "@/features/packages/lib/packageImage";
import { packagePriceSummary } from "@/features/packages/lib/publicPresentation";

// The picture comes from `resolvePackageImage`: the uploaded image when the
// journey has one, the website's own file when it does not. `alt` stays empty
// on purpose — this frame is an `aria-hidden` duplicate of the title link
// beside it, so describing it would announce the same journey twice. The
// uploaded description is read on the journey's own page, where the picture
// is the one that carries meaning.
export function JourneyRow({ pkg }: { pkg: PublicPackageCard }) {
  const media = resolvePackageImage(pkg);
  const price = packagePriceSummary(pkg);
  return (
    <article className="grid gap-5 py-8 sm:grid-cols-[260px_1fr] sm:gap-8">
      <Link href={`/packages/${pkg.slug}`} aria-hidden="true" tabIndex={-1} className="image-frame group relative block aspect-[4/3] sm:aspect-[5/4]">
        <Image src={media.src} alt="" fill sizes="(max-width: 640px) 92vw, 260px" className="object-cover transition-transform duration-700 group-hover:scale-[1.02]" style={{ objectPosition: media.position }} />
      </Link>
      <div className="flex flex-col">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <p className="text-[0.8rem] font-semibold uppercase tracking-[0.16em] text-ink/55">{pkg.code}</p>
            <h3 className="display mt-1 text-[1.5rem] leading-[1.15]"><Link href={`/packages/${pkg.slug}`} className="inner-focus hover:text-[var(--brass-ink)]">{pkg.title}</Link></h3>
          </div>
          <div className="text-right text-[0.9375rem] text-ink/75">
            <p className="font-bold text-ink">{price.primary}</p>
            <p>{price.secondary}</p>
          </div>
        </div>
        <dl className="mt-3 grid gap-x-8 gap-y-2 text-[0.9375rem] sm:grid-cols-2">
          {pkg.durationLabel ? <div className="flex gap-2"><dt className="text-ink/68">Duration:</dt><dd className="font-semibold">{pkg.durationLabel}</dd></div> : null}
          {pkg.scheduleLabel ? <div className="flex gap-2"><dt className="text-ink/68">Schedule:</dt><dd className="font-semibold">{pkg.scheduleLabel}</dd></div> : null}
        </dl>
        {pkg.summary ? <p className="prose-body mt-3 max-w-[60ch]">{pkg.summary}</p> : null}
        <div className="mt-5 grid gap-3 sm:mt-auto sm:max-w-[28rem] sm:grid-cols-2 sm:pt-5">
          <Link href={`/packages/${pkg.slug}`} className="btn btn-secondary">View journey</Link>
          <Link href={`/packages/${pkg.slug}#reserve`} className="btn btn-primary">Request reservation</Link>
        </div>
      </div>
    </article>
  );
}
