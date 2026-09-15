import Image from "next/image";
import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { rooms } from "@/features/rooms/data/roomsData";

export function RoomsHero() {
  return (
    <section className="stone-section overflow-hidden pb-[clamp(1.75rem,3vw,2.25rem)] pt-[clamp(2.25rem,4vw,3rem)] text-ink">
      <motion.div
        className="page-grid items-center gap-y-7 max-md:flex max-md:flex-col max-md:items-stretch"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-12% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <div className="col-span-5 col-start-2 max-md:order-1">
          <motion.p
            className="label text-aged-gold"
            variants={motionPrimitives.precisionDetail}
            transition={{ duration: 0.4, ease: luxuryEase }}
          >
            Stay / Private Rooms
          </motion.p>

          <motion.h1
            className="display mt-4 max-w-[360px] text-balance text-[clamp(1.85rem,6.5vw,2.3rem)] leading-[1.08] md:text-[clamp(1.9rem,2.6vw,2.4rem)]"
            variants={motionPrimitives.editorialText}
            transition={{ duration: 0.68, delay: 0.18, ease: luxuryEase }}
          >
            A <span className="serif-accent">quieter</span> way to stay in Giza.
          </motion.h1>

          <motion.p
            className="mt-4 max-w-[320px] text-[0.9rem] leading-[1.68] text-ink/68"
            variants={motionPrimitives.revealUp}
            transition={{ duration: 0.52, delay: 0.34, ease: luxuryEase }}
          >
            Each room composed around material, light, and view.
          </motion.p>

          <motion.div
            className="mt-6 flex items-center gap-3"
            variants={motionPrimitives.precisionDetail}
            transition={{ duration: 0.4, delay: 0.46, ease: luxuryEase }}
          >
            <span className="h-px w-8 bg-aged-gold/45" aria-hidden="true" />
            <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-ink/52">
              {String(rooms.length).padStart(2, "0")} Room Concepts
            </p>
          </motion.div>
        </div>

        <motion.div
          className="image-frame relative col-span-4 col-start-9 aspect-[16/12] max-md:order-2 max-md:col-span-full max-md:mt-6"
          variants={motionPrimitives.revealMask}
          transition={{ duration: 0.9, ease: luxuryEase }}
        >
          <Image
            src="/images/placeholders/hospitality-editorial-set.webp"
            alt="Editorial view of warm boutique hotel interiors and hospitality details"
            fill
            priority
            sizes="(max-width: 760px) 88vw, (max-width: 1024px) 52vw, 34vw"
            className="object-cover"
            style={{ objectPosition: "50% 50%" }}
          />
        </motion.div>
      </motion.div>
    </section>
  );
}
