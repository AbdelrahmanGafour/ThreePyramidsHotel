import Link from "next/link";
import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";

type PackagesClosingProps = {
  copy: string;
  href?: string;
  actionLabel?: string;
};

// The one closing moment for the packages feature — shared by the listing
// page and every journey detail page so the two never drift apart.
export function PackagesClosing({ copy, href = "/packages", actionLabel = "View all journeys ->" }: PackagesClosingProps) {
  return (
    <section className="bg-[linear-gradient(180deg,var(--limestone),var(--ivory)_60%)] px-[var(--page-x)] py-[clamp(3rem,5vw,4.25rem)] text-ink">
      <motion.div
        className="mx-auto flex max-w-[560px] flex-col items-center gap-5 text-center"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-12% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <motion.span
          className="h-px w-10 bg-aged-gold/45"
          aria-hidden="true"
          variants={motionPrimitives.precisionDetail}
          transition={{ duration: 0.4, ease: luxuryEase }}
        />
        <motion.div variants={motionPrimitives.editorialText} transition={{ duration: 0.62, delay: 0.12, ease: luxuryEase }}>
          <p className="label text-aged-gold">Plan your journey</p>
          <p className="mt-4 max-w-[420px] text-[1.02rem] leading-[1.65] text-ink/74 sm:text-[1.1rem]">{copy}</p>
        </motion.div>
        <motion.div variants={motionPrimitives.revealUp} transition={{ duration: 0.5, delay: 0.32, ease: luxuryEase }}>
          <Link href={href} className="reservation-key-action">
            {actionLabel}
          </Link>
        </motion.div>
      </motion.div>
    </section>
  );
}
