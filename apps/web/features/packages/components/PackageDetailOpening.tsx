import Image from "next/image";
import Link from "next/link";
import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import type { Package } from "@/features/packages/types";

type PackageDetailOpeningProps = {
  pkg: Package;
};

// A three-column dossier, not a gallery-plus-summary clone of the room
// detail opening. The narrow left rail carries the route line — one node
// per day of the itinerary — standing in for a collection marker, since a
// journey's real "identity number" is how many days it holds, not its
// position in a catalogue.
export function PackageDetailOpening({ pkg }: PackageDetailOpeningProps) {
  const dayCount = pkg.itinerary.length || pkg.nights + 1;

  return (
    <section className="stone-section px-[var(--page-x)] pb-[clamp(1.75rem,3vw,2.25rem)] pt-[clamp(1.5rem,3vw,2.25rem)] text-ink">
      <motion.div
        className="lg:grid lg:grid-cols-[140px_minmax(0,1fr)_320px] lg:items-start lg:gap-8"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-10% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <motion.div
          className="hidden lg:block"
          variants={motionPrimitives.precisionDetail}
          transition={{ duration: 0.4, ease: luxuryEase }}
        >
          <p className="label text-aged-gold">{pkg.eyebrow}</p>

          <div className="relative mt-6 pl-5" style={{ height: `${(dayCount - 1) * 1.75 + 0.4}rem` }}>
            <motion.span
              aria-hidden="true"
              className="absolute left-[3px] top-1 w-px origin-top bg-brass/40"
              style={{ bottom: "0.4rem" }}
              initial={{ scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true, margin: "-10% 0px" }}
              transition={{ duration: 0.9, ease: luxuryEase }}
            />
            {Array.from({ length: dayCount }).map((_, index) => (
              <span
                key={index}
                aria-hidden="true"
                className="absolute left-0 h-1.5 w-1.5 rotate-45 bg-brass"
                style={{ top: `${index * 1.75}rem` }}
              />
            ))}
          </div>

          <p className="mt-6 text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink/56">{pkg.duration}</p>
          <p className="mt-3 grid gap-1.5 text-[0.8rem] leading-[1.5] text-ink/56">
            {pkg.route.map((stop) => (
              <span key={stop}>{stop}</span>
            ))}
          </p>
        </motion.div>

        <motion.div
          className="image-frame relative mt-6 aspect-[4/3] lg:mt-0 lg:aspect-[3/4]"
          variants={motionPrimitives.revealMask}
          transition={{ duration: 0.85, ease: luxuryEase }}
        >
          <Image
            src={pkg.image}
            alt={pkg.imageAlt}
            fill
            priority
            sizes="(max-width: 1024px) 92vw, 38vw"
            className="object-cover"
            style={{ objectPosition: pkg.position }}
          />
        </motion.div>

        <motion.div className="mt-6 lg:mt-0" variants={motionPrimitives.staggerContainer}>
          <motion.p
            className="label text-aged-gold lg:hidden"
            variants={motionPrimitives.precisionDetail}
            transition={{ duration: 0.4, ease: luxuryEase }}
          >
            {pkg.eyebrow}
          </motion.p>

          <motion.h1
            className="display mt-3 text-balance text-[clamp(1.9rem,5vw,2.2rem)] leading-[1.08] lg:mt-0"
            variants={motionPrimitives.editorialText}
            transition={{ duration: 0.62, delay: 0.08, ease: luxuryEase }}
          >
            {pkg.title}
          </motion.h1>

          <motion.p
            className="mt-4 text-[0.92rem] leading-[1.7] text-ink/68"
            variants={motionPrimitives.revealUp}
            transition={{ duration: 0.5, delay: 0.18, ease: luxuryEase }}
          >
            {pkg.summary}
          </motion.p>

          <p className="mt-4 text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink/56 lg:hidden">
            {pkg.duration} &middot; {pkg.route.join(" · ")}
          </p>

          {pkg.priceFrom ? (
            <motion.p
              className="display mt-6 border-t border-ink/12 pt-5 text-[1.85rem] leading-none text-ink"
              variants={motionPrimitives.revealUp}
              transition={{ duration: 0.5, delay: 0.3, ease: luxuryEase }}
            >
              From ${pkg.priceFrom}
              <span className="ml-1.5 text-[0.62rem] font-sans font-bold uppercase tracking-[0.14em] text-ink/52">
                / person
              </span>
            </motion.p>
          ) : null}

          <motion.div
            variants={motionPrimitives.precisionDetail}
            transition={{ duration: 0.4, delay: 0.38, ease: luxuryEase }}
          >
            <Link href="#inquire" className="reservation-key-action mt-6 w-full sm:w-auto">
              Enquire about this journey -&gt;
            </Link>
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}
