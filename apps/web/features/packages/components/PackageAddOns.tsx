import type { Package } from "@/features/packages/types";

type PackageAddOnsProps = {
  pkg: Package;
};

// Plain list, not a shopping cart — add-ons are mentioned so a guest knows
// to ask, not selected/priced inline here.
export function PackageAddOns({ pkg }: PackageAddOnsProps) {
  if (!pkg.addOns?.length) return null;

  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(2.25rem,4vw,3rem)] text-ink">
      <div className="page-grid">
        <div className="col-span-8 col-start-2 max-md:col-span-full">
          <h2 className="label text-aged-gold">Optional additions</h2>
          <ul className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {pkg.addOns.map((addOn) => (
              <li key={addOn.label} className="border-t border-ink/10 py-3 text-[0.86rem] text-ink/76 first:border-t-0">
                <p>{addOn.label}</p>
                {addOn.description ? <p className="mt-1 text-[0.78rem] text-ink/50">{addOn.description}</p> : null}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[0.76rem] text-ink/44">Ask when you enquire — pricing depends on your dates and party.</p>
        </div>
      </div>
    </section>
  );
}
