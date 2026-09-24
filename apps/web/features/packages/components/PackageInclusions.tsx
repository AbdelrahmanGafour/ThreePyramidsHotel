import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { PublicPackageDetail } from "@/features/packages/api/contracts";

function TextList({ items, mark }: { items: string[]; mark: "tick" | "dash" | "note" }) {
  return <ul className="grid gap-3">{items.map((item, index) => <li key={`${index}-${item}`} className="flex items-start gap-3 text-[1rem] leading-[1.6] text-ink/85"><span aria-hidden="true" className={mark === "tick" ? "mt-[0.55rem] text-[var(--brass-ink)]" : "mt-[0.72rem] h-px w-3 shrink-0 bg-ink/60"}>{mark === "tick" ? "✓" : ""}</span>{item}</li>)}</ul>;
}

export function PackageInclusions({ pkg }: { pkg: PublicPackageDetail }) {
  return <>
    {pkg.included.length ? <InfoSection title="What's included"><TextList items={pkg.included} mark="tick" /></InfoSection> : null}
    {pkg.excluded.length ? <InfoSection title="What's not included"><TextList items={pkg.excluded} mark="dash" /></InfoSection> : null}
    {pkg.notes.length ? <InfoSection title="Important notes"><TextList items={pkg.notes} mark="note" /></InfoSection> : null}
  </>;
}
