import Link from "next/link";

// The one place on the listing that says "start a reservation". Plain text on
// a light surface — the dates and guests themselves are chosen on the booking
// page this button opens, so nothing here pretends to be an editable field.
export function RoomsAvailabilityBar() {
  return (
    <section aria-labelledby="availability-title" className="bg-ivory pb-[clamp(1.5rem,3vw,2rem)]">
      <div className="page-grid">
        <div className="col-span-10 col-start-2 flex flex-col gap-4 border border-ink/14 border-t-2 border-t-brass bg-[var(--panel-surface)] p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-6 max-md:col-span-full max-md:mx-0">
          <div>
            <h2 id="availability-title" className="group-title">
              Check dates and availability
            </h2>
            <p className="fine-print mt-1 max-w-[52ch] text-[0.9375rem]">
              Choose your dates and number of guests, then pick a room that fits.
            </p>
          </div>
          <Link href="/booking" className="btn btn-primary shrink-0">
            Choose dates and guests
          </Link>
        </div>
      </div>
    </section>
  );
}
