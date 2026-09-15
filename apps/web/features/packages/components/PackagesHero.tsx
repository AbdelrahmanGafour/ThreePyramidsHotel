import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";

// Deliberately text-only — no hero photograph. Rooms opens on imagery;
// Packages opens on a route. The line-and-node mark below is the feature's
// one signature motif, introduced here at its smallest scale.
export function PackagesHero() {
  return (
    <section className="stone-section px-[var(--page-x)] pb-[clamp(1.5rem,3vw,2rem)] pt-[clamp(2.5rem,4.5vw,3.25rem)] text-ink">
      <motion.div
        className="mx-auto max-w-[620px] text-center"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-12% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <motion.p
          className="label text-aged-gold"
          variants={motionPrimitives.precisionDetail}
          transition={{ duration: 0.4, ease: luxuryEase }}
        >
          Curated Journeys
        </motion.p>

        <motion.h1
          className="display mx-auto mt-4 max-w-[440px] text-balance text-[clamp(1.9rem,6.5vw,2.4rem)] leading-[1.1]"
          variants={motionPrimitives.editorialText}
          transition={{ duration: 0.68, delay: 0.14, ease: luxuryEase }}
        >
          Stay longer. See deeper.
        </motion.h1>

        <motion.p
          className="mx-auto mt-4 max-w-[420px] text-[0.9rem] leading-[1.68] text-ink/64"
          variants={motionPrimitives.revealUp}
          transition={{ duration: 0.52, delay: 0.26, ease: luxuryEase }}
        >
          Each journey pairs a stay at the hotel with a route composed around place, pace, and time — not a checklist
          of stops.
        </motion.p>

        <motion.div
          aria-hidden="true"
          className="mx-auto mt-7 flex w-fit items-center"
          variants={motionPrimitives.precisionDetail}
          transition={{ duration: 0.4, delay: 0.4, ease: luxuryEase }}
        >
          <span className="h-px w-7 bg-brass/40" />
          <span className="h-1.5 w-1.5 shrink-0 rotate-45 bg-brass" />
          <span className="h-px w-7 bg-brass/40" />
          <span className="h-1.5 w-1.5 shrink-0 rotate-45 bg-brass" />
          <span className="h-px w-7 bg-brass/40" />
          <span className="h-1.5 w-1.5 shrink-0 rotate-45 bg-brass" />
          <span className="h-px w-7 bg-brass/40" />
        </motion.div>
      </motion.div>
    </section>
  );
}
