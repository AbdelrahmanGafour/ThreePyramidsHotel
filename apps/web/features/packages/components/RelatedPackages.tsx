import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { RelatedJourneyRow } from "@/features/packages/components/RelatedJourneyRow";
import type { Package } from "@/features/packages/types";

type RelatedPackagesProps = {
  packages: Package[];
};

// Compact editorial rows, not the Rooms plate treatment — this stays
// lightweight whether there are 2 other journeys or 19.
export function RelatedPackages({ packages }: RelatedPackagesProps) {
  if (!packages.length) return null;

  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(2.5rem,4.5vw,3.5rem)] text-ink">
      <motion.div
        className="page-grid"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-12% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <motion.h2
          className="label col-span-full col-start-2 text-aged-gold sm:col-span-8"
          variants={motionPrimitives.precisionDetail}
          transition={{ duration: 0.4, ease: luxuryEase }}
        >
          More journeys
        </motion.h2>

        <motion.div
          className="col-span-8 col-start-2 mt-5 max-md:col-span-full"
          variants={motionPrimitives.revealUp}
          transition={{ duration: 0.5, delay: 0.1, ease: luxuryEase }}
        >
          {packages.map((pkg) => (
            <RelatedJourneyRow key={pkg.slug} pkg={pkg} />
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}
