import { demoStayPolicies } from "@/features/rooms/data/roomsData";

// Hotel-wide, not room-specific — sourced from `demoStayPolicies`, which is
// explicitly marked DEMO CONTENT in `roomsData.ts` pending the hotel's
// confirmed policies.
export function RoomStayDetails() {
  const rows = [
    { label: "Check-in", value: demoStayPolicies.checkIn },
    { label: "Check-out", value: demoStayPolicies.checkOut },
    { label: "Cancellation", value: demoStayPolicies.cancellation },
  ];

  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(2.25rem,4vw,3rem)] text-ink">
      <div className="page-grid">
        <h2 className="label col-span-4 col-start-2 text-aged-gold max-md:col-span-full">Stay details</h2>

        <dl className="col-span-6 col-start-6 mt-5 max-md:col-span-full md:mt-0">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex flex-col gap-1 border-t border-ink/10 py-3.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
            >
              <dt className="text-[0.66rem] font-bold uppercase tracking-[0.12em] text-ink/56">{row.label}</dt>
              <dd className="text-[0.92rem] text-ink/84 sm:text-right">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
