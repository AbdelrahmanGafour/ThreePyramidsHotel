import { InfoSection } from "@/shared/components/ui/InfoSection";
import { policyOverview } from "@/features/policies/data/policiesData";
import { demoStayPolicies } from "@/features/rooms/data/roomsData";

// The two facts guests look for most — check-in and check-out — stated large
// at the very top, then a plain list that jumps to each policy section.
export function PoliciesOverview() {
  const times = [
    { label: "Check-in", value: demoStayPolicies.checkIn },
    { label: "Check-out", value: demoStayPolicies.checkOut },
  ];

  return (
    <InfoSection title="At a glance">
      <dl className="grid grid-cols-2 gap-6 border border-ink/20 border-t-2 border-t-brass bg-[var(--panel-surface)] p-5 sm:p-6">
        {times.map((time) => (
          <div key={time.label}>
            <dt className="text-[0.9375rem] text-ink/68">{time.label}</dt>
            <dd className="display mt-1 text-[1.75rem] leading-none text-ink sm:text-[2rem]">{time.value}</dd>
          </div>
        ))}
      </dl>

      <nav aria-label="Policy sections" className="mt-8">
        <h3 className="group-title">Jump to a section</h3>
        <ul className="mt-2">
          {policyOverview.map((item) => (
            <li key={item.id} className="border-t border-ink/15 first:border-t-0">
              <a href={`#${item.id}`} className="inner-focus group flex min-h-14 items-start justify-between gap-4 py-3.5">
                <span>
                  <span className="block text-[1.0625rem] font-semibold text-ink underline decoration-ink/30 underline-offset-4 group-hover:text-[var(--brass-ink)] group-hover:decoration-[var(--brass-ink)]">
                    {item.title}
                  </span>
                  <span className="mt-1 block max-w-[48ch] text-[0.9375rem] leading-[1.55] text-ink/75">{item.summary}</span>
                </span>
                <span aria-hidden="true" className="mt-0.5 text-ink/60">
                  &darr;
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </InfoSection>
  );
}
