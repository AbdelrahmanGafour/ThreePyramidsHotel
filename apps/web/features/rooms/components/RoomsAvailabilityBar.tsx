import Link from "next/link";

// A compact concierge-desk object, not a full-width booking-engine strip.
// The negative top margin pulls it up to rest across the seam between the
// dark masthead and the ivory catalogue — an intentional object the guest
// notices, rather than another horizontal band. Kept deliberately quiet: a
// thin neutral border does the defining work, a small brass top accent (not
// a thick one) is the only colour note, and the shadow is just enough to
// read as raised, not a heavy drop shadow. Heading and button use different
// wording on purpose: repeating "Check availability" as both read as
// redundant rather than confident. The dates and guests themselves are
// chosen on the booking page this button opens, so nothing here pretends to
// be an editable field.
export function RoomsAvailabilityBar() {
  return (
    <section aria-labelledby="availability-title" className="relative bg-ivory px-[var(--page-x)] pb-10 sm:pb-14">
      <div className="mx-auto -mt-8 max-w-[800px] border border-ink/10 border-t-2 border-t-brass bg-[var(--panel-surface)] px-6 py-6 shadow-[0_10px_28px_rgba(30,24,21,0.1)] sm:-mt-10 sm:px-9 sm:py-7">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:text-left">
          <div>
            <p id="availability-title" className="text-[1.0625rem] font-bold text-ink">
              Plan your stay
            </p>
            <p className="fine-print mt-1">Select dates and guests to see availability.</p>
          </div>

          <Link href="/booking" className="btn btn-primary w-full shrink-0 sm:w-auto">
            Choose dates &amp; guests
          </Link>
        </div>
      </div>
    </section>
  );
}
