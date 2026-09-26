import Link from "next/link";
import { demoStayPolicies } from "@/features/rooms/data/roomsData";

// Hotel-wide, not room-specific — sourced from `demoStayPolicies`, which is
// explicitly marked DEMO CONTENT in `roomsData.ts` pending confirmed
// policies. This is the page's ONE dark section — every other room-detail
// section stays on ivory, so this flat espresso surface (no gradient; a
// single deliberate anchor, not a decorative flourish) is what gives the
// practical stay facts their own distinct, considered moment.
export function RoomBeforeYouArrive() {
  return (
    <section className="bg-espresso py-[clamp(2.25rem,4vw,3rem)] text-ivory">
      <div className="page-grid">
        <div className="col-span-8 col-start-2 max-md:col-span-full">
          <p className="section-title text-[1.875rem]!">Before you arrive</p>

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-7 sm:max-w-[21rem] sm:divide-x sm:divide-sand/20">
            <div className="flex flex-col gap-2">
              <dt className="text-[0.875rem] font-bold uppercase tracking-[0.08em] text-sand/80">Check-in</dt>
              <dd className="text-[1.3125rem] font-semibold text-ivory">{demoStayPolicies.checkIn}</dd>
            </div>
            <div className="flex flex-col gap-2 sm:pl-6">
              <dt className="text-[0.875rem] font-bold uppercase tracking-[0.08em] text-sand/80">Check-out</dt>
              <dd className="text-[1.3125rem] font-semibold text-ivory">{demoStayPolicies.checkOut}</dd>
            </div>
          </dl>

          <div className="mt-7 max-w-[46ch] border-t border-sand/20 pt-6">
            <p className="text-[0.875rem] font-bold uppercase tracking-[0.08em] text-sand/80">Cancellation</p>
            <p className="mt-2 text-[1.0625rem] text-ivory/90">{demoStayPolicies.cancellation}</p>
            <Link
              href="/policies"
              className="mt-3 inline-flex min-h-11 items-center text-[0.9375rem] font-semibold text-brass underline decoration-brass/50 underline-offset-4 transition-colors hover:text-ivory hover:decoration-ivory/60"
            >
              View hotel policies
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
