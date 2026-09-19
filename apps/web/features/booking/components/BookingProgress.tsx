"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const steps = [
  { label: "Dates", href: "/booking" },
  { label: "Room", href: "/booking/rooms" },
  { label: "Details", href: "/booking/guest-details" },
  { label: "Review", href: "/booking/review" },
] as const;

// Four labelled steps, the current one filled and the finished ones ticked
// and clickable — so going back is one tap. Confirmation is a success state,
// not a numbered step, so the rail simply doesn't render there.
export function BookingProgress() {
  const pathname = usePathname();
  if (pathname === "/booking/confirmation") return null;

  const activeIndex = steps.findIndex((step) => step.href === pathname);

  return (
    <nav aria-label="Booking progress">
      <ol className="flex items-center justify-center gap-1.5 sm:justify-start sm:gap-3">
        {steps.map((step, index) => {
          const status = index < activeIndex ? "done" : index === activeIndex ? "active" : "upcoming";

          const marker = (
            <>
              <span
                aria-hidden="true"
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[0.75rem] font-bold tabular-nums ${
                  status === "active"
                    ? "border-brass bg-brass text-ink"
                    : status === "done"
                      ? "border-ivory/80 bg-ivory/80 text-ink"
                      : "border-ivory/45 text-ivory/75"
                }`}
              >
                {status === "done" ? "✓" : index + 1}
              </span>
              <span>
                {step.label}
                {status === "done" ? <span className="sr-only"> (completed, go back to this step)</span> : null}
                {status === "active" ? <span className="sr-only"> (current step, {index + 1} of {steps.length})</span> : null}
              </span>
            </>
          );

          const textClass = `flex min-h-11 items-center gap-1.5 text-[0.8125rem] font-semibold sm:text-[0.875rem] ${
            status === "active" ? "text-brass" : status === "done" ? "text-ivory" : "text-ivory/70"
          }`;

          return (
            <li key={step.href} className="flex items-center gap-1.5 sm:gap-3">
              {index > 0 ? <span aria-hidden="true" className="h-px w-2.5 bg-ivory/35 sm:w-5" /> : null}
              {status === "done" ? (
                <Link href={step.href} className={`${textClass} inner-focus underline decoration-ivory/40 underline-offset-4 hover:decoration-brass`}>
                  {marker}
                </Link>
              ) : (
                <span aria-current={status === "active" ? "step" : undefined} className={textClass}>
                  {marker}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
