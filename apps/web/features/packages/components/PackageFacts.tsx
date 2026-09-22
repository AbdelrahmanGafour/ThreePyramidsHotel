import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { PublicPackageDetail } from "@/features/packages/api/contracts";
import { operatingDaysLabel } from "@/features/packages/lib/publicPresentation";

export function PackageFacts({ pkg }: { pkg: PublicPackageDetail }) {
  const operatingDays = operatingDaysLabel(pkg.operatingDays);
  const facts = [
    pkg.durationLabel ? { label: "Duration", value: pkg.durationLabel } : null,
    pkg.scheduleLabel ? { label: "Schedule", value: pkg.scheduleLabel } : null,
    operatingDays ? { label: "Operating days", value: operatingDays } : null,
    { label: "Currency", value: pkg.currency },
  ].filter((value): value is { label: string; value: string } => Boolean(value));
  if (!facts.length) return null;
  return <InfoSection title="Journey at a glance"><dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">{facts.map((fact) => <div key={fact.label} className="border-t border-ink/12 pt-3"><dt className="text-[0.875rem] text-ink/68">{fact.label}</dt><dd className="mt-0.5 text-[1.0625rem] font-semibold text-ink">{fact.value}</dd></div>)}</dl></InfoSection>;
}
