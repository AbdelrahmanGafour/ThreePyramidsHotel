import type { Package } from "@/features/packages/types";

type PackageFactsProps = {
  pkg: Package;
};

// A single flowing dossier line, not a two-column facts grid — the room
// detail page already owns that pattern, so "journey at a glance" reads
// differently on purpose: one continuous row of label — value pairs.
export function PackageFacts({ pkg }: PackageFactsProps) {
  const facts = [
    { label: "Duration", value: pkg.duration },
    { label: "Nights", value: String(pkg.nights) },
    { label: "Route", value: pkg.route.join(" · ") },
    pkg.groupType ? { label: "Group", value: pkg.groupType } : null,
    pkg.languages?.length ? { label: "Language", value: pkg.languages.join(", ") } : null,
    pkg.pickup ? { label: "Pickup", value: pkg.pickup } : null,
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact));

  if (!facts.length) return null;

  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(2rem,3.5vw,2.75rem)] text-ink">
      <div className="page-grid">
        <div className="col-span-10 col-start-2 max-md:col-span-full">
          <p className="label text-aged-gold">Journey at a glance</p>
          <p className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-t border-ink/12 pt-4">
            {facts.map((fact) => (
              <span key={fact.label} className="text-[0.86rem] leading-[1.5] text-ink/76">
                <span className="text-[0.66rem] font-bold uppercase tracking-[0.1em] text-ink/48">{fact.label}</span>
                {" — "}
                {fact.value}
              </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  );
}
