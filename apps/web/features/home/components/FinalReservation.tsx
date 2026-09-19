import Image from "next/image";
import Link from "next/link";
import * as motion from "motion/react-client";
import { motionPrimitives } from "@/shared/components/motion/PremiumMotion";

export function FinalReservation() {
  return (
    <motion.section
      id="reserve"
      className="bg-[linear-gradient(180deg,var(--limestone),var(--ivory)_42%,var(--sand)_160%)] px-[var(--page-x)] py-[clamp(4rem,7vw,6.5rem)] text-ink"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-12% 0px" }}
      variants={motionPrimitives.staggerContainer}
    >
      <div className="relative mx-auto grid max-w-[1180px] gap-8 border-y border-ink/12 py-8 lg:grid-cols-[0.9fr_1fr] lg:items-center lg:py-10">
        <motion.div
          className="image-frame relative aspect-[4/3] min-h-[260px] sm:min-h-[320px] lg:-ml-8 lg:aspect-[5/4] lg:min-h-[430px]"
          variants={motionPrimitives.revealMask}
        >
          <Image
            src="/images/placeholders/warm-room.webp"
            alt="Warm boutique hotel room prepared for arrival"
            fill
            sizes="(max-width: 1024px) 92vw, 44vw"
            className="object-cover object-[48%_50%]"
          />
        </motion.div>

        <motion.div className="relative max-w-[560px] lg:pl-10" variants={motionPrimitives.editorialText}>
          <div className="mb-7 flex items-center gap-4">
            <p className="label text-aged-gold">Your stay</p>
            <span className="h-px w-12 bg-aged-gold/42" />
            <span className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-ink/38">Key / 03</span>
          </div>

          <h2 className="text-balance font-sans text-[clamp(1.9rem,8vw,2.35rem)] font-semibold leading-[1.08] md:text-[clamp(1.9rem,3vw,2.7rem)]">
            When you&apos;re ready, <span className="serif-accent">Giza is waiting.</span>
          </h2>

          <p className="body-copy mt-6 max-w-[430px]">
            Share your dates and preferences, and we&apos;ll shape the stay around arrival, room atmosphere, and the rhythm of your days.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-5">
            <Link href="/booking" className="reservation-key-action">
              Reserve your stay -&gt;
            </Link>
            <span className="text-[0.58rem] font-black uppercase tracking-[0.19em] text-ink/42">
              Three Pyramids / Giza
            </span>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}
