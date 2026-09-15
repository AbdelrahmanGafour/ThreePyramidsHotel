import Image from "next/image";
import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";

export function RooftopSection() {
  return (
    <section
      id="rooftop"
      className="relative overflow-hidden bg-[linear-gradient(112deg,var(--terracotta)_0%,var(--clay)_48%,var(--limestone)_48%,var(--ivory)_100%)] py-[clamp(4.25rem,7vw,7rem)] text-ink max-md:bg-clay max-md:text-ivory"
    >
      <motion.div
        className="grid gap-7 px-[var(--page-x)] lg:grid-cols-[0.72fr_1.28fr] lg:items-center"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-12% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <motion.div className="relative z-10 order-2 text-ivory lg:order-1" variants={motionPrimitives.editorialText}>
          <p className="label mb-6 text-brass">The Rooftop</p>
          <h2 className="max-w-[430px] text-balance font-sans text-[clamp(1.9rem,8vw,2.35rem)] font-semibold leading-[1.08] md:text-[clamp(1.9rem,3vw,2.7rem)]">
            Dinner moves at the <span className="serif-accent">pace of dusk.</span>
          </h2>
          <p className="mt-6 max-w-[330px] text-[0.94rem] leading-[1.72] text-ivory/74">
            Lantern light, quiet tables, and the desert cooling into night.
          </p>

          <motion.div className="mt-8 grid max-w-[360px] grid-cols-3 border-y border-ivory/18 py-4 text-[0.58rem] font-black uppercase tracking-[0.18em] text-ivory/68" variants={motionPrimitives.precisionDetail}>
            <span>Sunset</span>
            <span>Lanterns</span>
            <span>Giza air</span>
          </motion.div>

          <a href="#experiences" className="text-link mt-7 text-ivory">
            Discover the rooftop -&gt;
          </a>
        </motion.div>

        <div className="relative order-1 lg:order-2">
          <motion.div
            className="image-frame relative aspect-[4/3] min-h-[290px] md:aspect-[16/10] md:min-h-[330px] lg:min-h-[520px]"
            variants={motionPrimitives.revealMask}
          >
            <Image
              src="/images/placeholders/rooftop-dining.webp"
              alt="Rooftop dining table at dusk with the pyramids on the horizon"
              fill
              sizes="(max-width: 1024px) 92vw, 62vw"
              className="object-cover object-[58%_48%]"
            />
            <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(30,24,21,0.34),transparent_46%)]" />
          </motion.div>

          <motion.div
            className="absolute -bottom-7 left-6 z-10 w-[min(17rem,calc(100%-3rem))] bg-ivory/92 p-5 text-ink shadow-[0_18px_54px_rgba(30,24,21,0.14)] max-sm:static max-sm:mt-4 max-sm:w-full"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-12% 0px" }}
            transition={{ duration: 0.62, delay: 0.18, ease: luxuryEase }}
          >
            <p className="label text-aged-gold">Evening table</p>
            <p className="mt-4 text-[0.82rem] leading-[1.65] text-ink/64">
              Rooftop / Giza
              <br />
              Dinner hour to confirm
            </p>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
