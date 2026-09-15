"use client";

import { usePathname } from "next/navigation";

const steps = [
  { label: "Stay", href: "/booking" },
  { label: "Room", href: "/booking/rooms" },
  { label: "Guest", href: "/booking/guest-details" },
  { label: "Review", href: "/booking/review" },
] as const;

// Fine lines and type only — no progress bar. Confirmation is a success
// state, not a numbered step, so the rail simply doesn't render there.
export function BookingProgress() {
  const pathname = usePathname();
  if (pathname === "/booking/confirmation") return null;

  const activeIndex = steps.findIndex((step) => step.href === pathname);

  return (
    <ol aria-label="Booking progress" className="flex items-center justify-center gap-1 sm:justify-start sm:gap-2">
      {steps.map((step, index) => {
        const status = index < activeIndex ? "done" : index === activeIndex ? "active" : "upcoming";

        return (
          <li key={step.href} className="flex items-center gap-1 sm:gap-2">
            {index > 0 ? <span aria-hidden="true" className="h-px w-3 bg-brass/22 sm:w-5" /> : null}
            <span
              aria-current={status === "active" ? "step" : undefined}
              className={`flex items-center gap-1.5 text-[0.56rem] font-black uppercase tracking-[0.14em] sm:text-[0.6rem] ${
                status === "active" ? "text-brass" : status === "done" ? "text-ivory/70" : "text-ivory/32"
              }`}
            >
              <span className="tabular-nums">{String(index + 1).padStart(2, "0")}</span>
              <span>{step.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
