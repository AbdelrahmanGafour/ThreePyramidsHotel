import type { Package } from "@/features/packages/types";

type PackageInclusionsProps = {
  pkg: Package;
};

// Plain typographic lists, not a green-check/red-cross icon grid — a fine
// ink mark for what's included, a hollow one for what isn't.
export function PackageInclusions({ pkg }: PackageInclusionsProps) {
  if (!pkg.included.length && !pkg.excluded.length) return null;

  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(2.25rem,4vw,3rem)] text-ink">
      <div className="page-grid gap-y-8">
        {pkg.included.length ? (
          <div className="col-span-4 col-start-2 max-md:col-span-full">
            <h2 className="label text-aged-gold">Included</h2>
            <ul className="mt-5 grid gap-3">
              {pkg.included.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[0.88rem] leading-[1.6] text-ink/76">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rotate-45 bg-brass" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {pkg.excluded.length ? (
          <div className="col-span-4 col-start-7 max-md:col-span-full">
            <h2 className="label text-ink/48">Not included</h2>
            <ul className="mt-5 grid gap-3">
              {pkg.excluded.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[0.88rem] leading-[1.6] text-ink/56">
                  <span aria-hidden="true" className="mt-2.5 h-1 w-1 shrink-0 rotate-45 border border-ink/40" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
