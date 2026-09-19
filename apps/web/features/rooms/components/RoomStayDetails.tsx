import Link from "next/link";
import { InfoSection } from "@/shared/components/ui/InfoSection";
import { demoStayPolicies } from "@/features/rooms/data/roomsData";

// Hotel-wide, not room-specific — sourced from `demoStayPolicies`, which is
// explicitly marked DEMO CONTENT in `roomsData.ts` pending confirmed policies.
export function RoomStayDetails() {
  const stay = [
    { label: "Check-in", value: demoStayPolicies.checkIn },
    { label: "Check-out", value: demoStayPolicies.checkOut },
  ];

  return (
    <>
      <InfoSection title="Stay information">
        <dl>
          {stay.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-6 border-t border-ink/12 py-3.5 first:border-t-0 first:pt-0"
            >
              <dt className="text-[0.9375rem] text-ink/68">{row.label}</dt>
              <dd className="text-right text-[1.0625rem] font-semibold text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      </InfoSection>

      <InfoSection title="Policies">
        <dl>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
            <dt className="text-[0.9375rem] text-ink/68">Cancellation</dt>
            <dd className="text-[1.0625rem] font-semibold text-ink sm:text-right">{demoStayPolicies.cancellation}</dd>
          </div>
        </dl>
        <Link href="/policies" className="btn-link mt-4">
          Read all hotel policies
        </Link>
      </InfoSection>
    </>
  );
}
