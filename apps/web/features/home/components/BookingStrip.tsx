"use client";

import Link from "next/link";
import { useCallback, useRef, type CSSProperties, type PointerEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { luxuryEase } from "@/shared/components/motion/PremiumMotion";

const fields = [
  ["Check in", "Choose date"],
  ["Check out", "Choose date"],
  ["Guests", "2 guests"],
] as const;

export function BookingStrip() {
  const railRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  const updateReflection = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    railRef.current?.style.setProperty("--booking-glint-x", `${Math.max(14, Math.min(92, x))}%`);
  }, []);

  const settleIn = {
    initial: { opacity: 0, y: reduceMotion ? 0 : 14, scale: reduceMotion ? 1 : 0.99 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: reduceMotion ? 0 : 0.85, delay: reduceMotion ? 0 : 0.3, ease: luxuryEase },
  };

  return (
    <>
      <motion.section
        ref={railRef}
        aria-label="Availability search"
        className="reservation-rail relative z-20 ml-auto mr-[var(--page-x)] -mt-[4.15rem] hidden w-[min(660px,56vw)] text-ivory min-[900px]:block"
        onPointerMove={updateReflection}
        onPointerLeave={() => railRef.current?.style.setProperty("--booking-glint-x", "86%")}
        {...settleIn}
      >
        <div className="flex items-center justify-between border-b border-brass/14 px-4 py-1">
          <span className="text-[0.46rem] font-black uppercase tracking-[0.3em] text-brass/58">Reservation Desk</span>
          <span className="text-[0.46rem] font-extrabold uppercase tracking-[0.26em] text-ivory/34">Giza</span>
        </div>
        <form className="grid min-h-[64px] grid-cols-[1fr_1fr_0.82fr_auto] items-center">
          {fields.map(([label, value]) => (
            <div
              key={label}
              className="group relative grid content-center gap-1 border-r border-brass/20 px-4"
            >
              <span className="label text-ivory/48 transition-colors group-hover:text-brass group-focus-within:text-brass">{label}</span>
              <Link
                href="/booking"
                aria-label={`${label} — go to booking`}
                className="w-full text-left text-[0.78rem] text-ivory/92 outline-none transition-[color,transform] duration-500 group-hover:translate-x-0.5 group-hover:text-ivory"
              >
                {value}
              </Link>
              <span className="absolute bottom-2 left-4 right-7 h-px origin-left scale-x-0 bg-brass transition-transform duration-500 group-hover:scale-x-100 group-focus-within:scale-x-100" />
            </div>
          ))}
          <Link
            href="/booking"
            className="reservation-action mx-4 min-h-11 min-w-[150px] text-[0.56rem] font-black uppercase tracking-[0.18em] text-ivory"
          >
            Reserve your stay -&gt;
          </Link>
        </form>
      </motion.section>

      <motion.section
        aria-label="Mobile availability search"
        className="relative z-20 mx-[var(--page-x)] -mt-9 text-ivory min-[900px]:hidden"
        {...settleIn}
      >
        <div className="reservation-rail p-3" style={{ "--booking-glint-x": "82%" } as CSSProperties}>
          <div className="mb-2 flex items-center justify-center gap-2 text-[0.44rem] font-black uppercase tracking-[0.24em] text-brass/55">
            <span className="h-px w-3 bg-brass/40" />
            Reservation Desk / Giza
            <span className="h-px w-3 bg-brass/40" />
          </div>
          <Link href="/booking" className="reservation-action flex min-h-11 items-center justify-center text-[0.62rem] font-black uppercase tracking-[0.18em] text-ivory">
            Reserve your stay -&gt;
          </Link>
        </div>
      </motion.section>
    </>
  );
}
