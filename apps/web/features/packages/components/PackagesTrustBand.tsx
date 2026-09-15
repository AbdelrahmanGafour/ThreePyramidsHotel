import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";

const points = [
  { label: "Composed pace", copy: "Routes built around light and sequence, not ground covered." },
  { label: "Private guidance", copy: "A guide arranged around your morning, not a fixed departure board." },
  { label: "One point of contact", copy: "The same hotel that holds your room arranges the route around it." },
];

// A quiet trust band, not a testimonial carousel or stat wall — three plain
// statements consistent with the hotel's own voice, not invented claims.
export function PackagesTrustBand() {
  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(2.5rem,4.5vw,3.5rem)] text-ink">
      <motion.div
        className="page-grid gap-y-8"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-12% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <motion.p
          className="label col-span-4 col-start-2 text-aged-gold max-md:col-span-full"
          variants={motionPrimitives.precisionDetail}
          transition={{ duration: 0.4, ease: luxuryEase }}
        >
          Why a curated journey
        </motion.p>

        <div className="col-span-8 col-start-4 grid gap-8 sm:grid-cols-3 max-md:col-span-full">
          {points.map((point, index) => (
            <motion.div
              key={point.label}
              className="border-t border-ink/12 pt-4"
              variants={motionPrimitives.revealUp}
              transition={{ duration: 0.5, delay: 0.08 * index, ease: luxuryEase }}
            >
              <h3 className="display text-[1.05rem] leading-[1.15] text-ink">{point.label}</h3>
              <p className="mt-2 text-[0.86rem] leading-[1.6] text-ink/64">{point.copy}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
