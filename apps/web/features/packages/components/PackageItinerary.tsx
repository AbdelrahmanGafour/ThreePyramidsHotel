import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import type { Package } from "@/features/packages/types";

type PackageItineraryProps = {
  pkg: Package;
};

// The signature motif: a fine brass route line running the length of the
// itinerary, with a small marker at each day — the one place a "day 01, 02,
// 03" numbering is actually a true sequence, unlike a generic catalogue
// index. Typography and rhythm carry the day-by-day, not accordion chrome.
export function PackageItinerary({ pkg }: PackageItineraryProps) {
  if (!pkg.itinerary.length) return null;

  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(2.75rem,5vw,4rem)] text-ink">
      <div className="page-grid gap-y-8">
        <div className="col-span-4 col-start-2 max-md:col-span-full">
          <p className="label text-aged-gold">The route</p>
          {pkg.highlights.length ? (
            <ul className="mt-5 grid gap-3">
              {pkg.highlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-3 text-[0.86rem] leading-[1.6] text-ink/68">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rotate-45 bg-brass" />
                  {highlight}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <motion.ol
          className="relative col-span-7 col-start-6 max-md:col-span-full"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-10% 0px" }}
          variants={motionPrimitives.staggerContainer}
        >
          <motion.span
            aria-hidden="true"
            className="absolute left-[3px] top-2 origin-top bg-brass/40"
            style={{ bottom: "2.5rem", width: "1px" }}
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, margin: "-10% 0px" }}
            transition={{ duration: 1, ease: luxuryEase }}
          />

          {pkg.itinerary.map((day, index) => (
            <motion.li
              key={day.day}
              className={`relative pl-10 ${index === pkg.itinerary.length - 1 ? "" : "pb-10"}`}
              variants={motionPrimitives.revealUp}
              transition={{ duration: 0.55, delay: index * 0.06, ease: luxuryEase }}
            >
              <span aria-hidden="true" className="absolute left-0 top-1.5 h-2 w-2 rotate-45 bg-brass" />
              <p className="label text-brass">Day {String(day.day).padStart(2, "0")}</p>
              <h3 className="display mt-2 text-[1.15rem] leading-[1.15] text-ink">{day.title}</h3>
              <p className="mt-2 max-w-[560px] text-[0.9rem] leading-[1.65] text-ink/64">{day.narrative}</p>
              {day.moments.length ? (
                <p className="mt-3 flex flex-wrap items-center text-[0.66rem] font-bold uppercase tracking-[0.08em] text-ink/56">
                  {day.moments.map((moment, momentIndex) => (
                    <span key={moment} className="flex items-center">
                      {momentIndex > 0 ? <span aria-hidden="true" className="mx-2.5 h-3 w-px bg-ink/22" /> : null}
                      {moment}
                    </span>
                  ))}
                </p>
              ) : null}
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </section>
  );
}
