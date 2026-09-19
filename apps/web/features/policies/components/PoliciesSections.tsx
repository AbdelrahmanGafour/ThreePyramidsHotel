import { InfoSection } from "@/shared/components/ui/InfoSection";
import { policySections } from "@/features/policies/data/policiesData";

// One titled section per policy topic — Arrival, During your stay, Changes &
// cancellation, Payments — each a list of label / answer rows rather than
// dense legal paragraphs. The label sits beside its answer, left-aligned.
export function PoliciesSections() {
  return (
    <>
      {policySections.map((section) => (
        <InfoSection key={section.id} id={section.id} title={section.title}>
          <dl>
            {section.rows.map((row) => (
              <div
                key={row.label}
                className="grid gap-1 border-t border-ink/15 py-4 first:border-t-0 first:pt-0 sm:grid-cols-[11rem_1fr] sm:gap-6"
              >
                <dt className="text-[1rem] font-semibold text-ink">{row.label}</dt>
                <dd className="prose-body max-w-[60ch]">{row.value}</dd>
              </div>
            ))}
          </dl>
        </InfoSection>
      ))}
    </>
  );
}
