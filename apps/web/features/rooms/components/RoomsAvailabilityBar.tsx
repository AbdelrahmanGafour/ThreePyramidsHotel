"use client";

import Link from "next/link";
import { useCallback, useRef, type CSSProperties, type PointerEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { luxuryEase } from "@/shared/components/motion/PremiumMotion";
import { getRoomCategories, type Room } from "@/features/rooms/data/roomsData";

type RoomsAvailabilityBarProps = {
  rooms: Room[];
};

// A concierge desk, not a search-engine form: the same restrained fields as
// the homepage's booking rail, styled for the collection page. A room-type
// field only appears once the roster actually has more than one category —
// with today's single-category roster it stays a clean three-field strip.
export function RoomsAvailabilityBar({ rooms }: RoomsAvailabilityBarProps) {
  const categories = getRoomCategories(rooms);
  const railRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  const fields = [
    ["Check in", "Choose date"],
    ["Check out", "Choose date"],
    ["Guests", "2 guests"],
    ...(categories.length ? [["Room type", "Any type"]] : []),
  ] as const;

  const updateReflection = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    railRef.current?.style.setProperty("--booking-glint-x", `${Math.max(14, Math.min(92, x))}%`);
  }, []);

  const settleIn = {
    initial: { opacity: 0, y: reduceMotion ? 0 : 14, scale: reduceMotion ? 1 : 0.99 },
    whileInView: { opacity: 1, y: 0, scale: 1 },
    viewport: { once: true, margin: "-8% 0px" },
    transition: { duration: reduceMotion ? 0 : 0.85, ease: luxuryEase },
  };

  return (
    <div className="bg-ivory px-[var(--page-x)] pb-[clamp(1.75rem,3vw,2.25rem)] text-ivory">
      <motion.section
        ref={railRef}
        aria-label="Check availability"
        className="reservation-rail relative z-10 mx-auto hidden w-full max-w-[1160px] min-[900px]:block"
        onPointerMove={updateReflection}
        onPointerLeave={() => railRef.current?.style.setProperty("--booking-glint-x", "50%")}
        {...settleIn}
      >
        <div className="flex items-center justify-between border-b border-brass/14 px-4 py-1">
          <span className="text-[0.46rem] font-black uppercase tracking-[0.3em] text-brass/58">Reservation Desk</span>
          <span className="text-[0.46rem] font-extrabold uppercase tracking-[0.26em] text-ivory/34">Giza</span>
        </div>
        <form
          className="grid min-h-[64px] items-center"
          style={{ gridTemplateColumns: `repeat(${fields.length}, 1fr) auto` }}
        >
          {fields.map(([label, value]) => (
            <div key={label} className="group relative grid content-center gap-1.5 border-r border-brass/14 px-4">
              <span className="label text-ivory/40 transition-colors group-hover:text-brass group-focus-within:text-brass">
                {label}
              </span>
              <button
                type="button"
                aria-label={label}
                className="w-full text-left text-[0.8rem] text-ivory outline-none transition-all duration-500 group-hover:translate-x-0.5"
              >
                {value}
              </button>
              <span className="absolute bottom-2 left-4 right-7 h-px origin-left scale-x-0 bg-brass transition-transform duration-500 group-hover:scale-x-100 group-focus-within:scale-x-100" />
            </div>
          ))}
          <Link
            href="/booking"
            className="reservation-action mx-4 min-h-11 min-w-[160px] text-[0.6rem] font-black uppercase tracking-[0.18em] text-brass"
          >
            Check availability -&gt;
          </Link>
        </form>
      </motion.section>

      <motion.section aria-label="Check availability" className="relative z-10 min-[900px]:hidden" {...settleIn}>
        <div className="reservation-rail p-3" style={{ "--booking-glint-x": "50%" } as CSSProperties}>
          <div className="mb-2 flex items-center justify-center gap-2 text-[0.44rem] font-black uppercase tracking-[0.24em] text-brass/55">
            <span className="h-px w-3 bg-brass/40" />
            Reservation Desk / Giza
            <span className="h-px w-3 bg-brass/40" />
          </div>
          <Link
            href="/booking"
            className="reservation-action flex min-h-11 items-center justify-center text-[0.62rem] font-black uppercase tracking-[0.18em] text-brass"
          >
            Check availability -&gt;
          </Link>
        </div>
      </motion.section>
    </div>
  );
}
