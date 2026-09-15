"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { DepthImage, luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";

// Elevation geometry (viewBox units): ground at y=226, base 30–350, apex at the Great Pyramid's ~51.8° slope.
const GROUND_Y = 226;
const APEX = { x: 190, y: 22 };
const BASE = { left: 30, right: 350 };
// Horizontal course lines at a quarter, half and three quarters of the height.
const COURSES = [0.25, 0.5, 0.75].map((level) => {
  const y = GROUND_Y - (GROUND_Y - APEX.y) * level;
  const halfWidth = ((BASE.right - BASE.left) / 2) * (1 - level);
  return { y, left: APEX.x - halfWidth, right: APEX.x + halfWidth };
});

export function StorySection() {
  const reduceMotion = useReducedMotion();

  const draw = (delay: number, duration = 1.1): Variants => ({
    hidden: { pathLength: 0, opacity: 0 },
    show: {
      pathLength: 1,
      opacity: 1,
      transition: reduceMotion
        ? { duration: 0 }
        : { pathLength: { duration, delay, ease: luxuryEase }, opacity: { duration: 0.2, delay } },
    },
  });

  const fade = (delay: number): Variants => ({
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: reduceMotion ? { duration: 0 } : { duration: 0.7, delay, ease: luxuryEase } },
  });

  return (
    <section id="our-story" className="stone-section py-[clamp(3.5rem,5.5vw,5rem)] text-ink">
      <motion.div
        className="page-grid items-start gap-y-8 max-md:flex max-md:flex-col max-md:items-stretch"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-14% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <motion.div
          className="col-span-4 col-start-2 max-md:order-1 md:flex md:flex-col md:self-stretch"
          variants={motionPrimitives.precisionDetail}
        >
          <p className="label tracking-settle text-aged-gold">01 / The Threshold</p>

          <motion.div className="mt-6" variants={motionPrimitives.editorialText}>
            <p className="text-[0.66rem] font-extrabold uppercase leading-[1.5] tracking-[0.14em] text-ink/65">
              Ancient context outside.
            </p>
            <p className="serif-accent mt-1 text-[clamp(1.9rem,3.6vw,2.7rem)] leading-[1.1] text-ink">
              Contemporary calm within.
            </p>
          </motion.div>

          <p className="mt-6 max-w-[300px] text-[0.9rem] leading-[1.75] text-ink/70">
            Service is composed, not staged. Materials are warm, tactile, and restrained.
          </p>

          <div
            className="mt-10 w-full max-w-[250px] md:mt-auto md:max-w-[300px] md:pt-12 lg:max-w-[380px]"
            aria-hidden="true"
          >
            <p className="text-[0.58rem] font-extrabold uppercase tracking-[0.18em] text-aged-gold">Elevation 01</p>
            <svg viewBox="0 0 380 250" className="mt-3 block h-auto w-full overflow-visible">
              <motion.polygon
                points={`${APEX.x},${APEX.y} ${BASE.right},${GROUND_Y} ${APEX.x},${GROUND_Y}`}
                fill="rgba(176,138,81,0.1)"
                variants={fade(0.9)}
              />
              <motion.line
                x1={APEX.x}
                y1="4"
                x2={APEX.x}
                y2="242"
                stroke="rgba(123,85,66,0.5)"
                strokeWidth="1"
                strokeDasharray="4 5"
                variants={fade(0.5)}
              />
              <motion.path
                d={`M6 ${GROUND_Y} H374`}
                fill="none"
                stroke="rgba(148,112,62,0.55)"
                strokeWidth="1"
                variants={draw(0.2, 0.9)}
              />
              <motion.path
                d={`M${BASE.left} ${GROUND_Y} L${APEX.x} ${APEX.y} L${BASE.right} ${GROUND_Y}`}
                fill="none"
                stroke="#94703e"
                strokeWidth="1.75"
                strokeLinejoin="miter"
                variants={draw(0.35, 1.2)}
              />
              {COURSES.map((course, index) => (
                <motion.path
                  key={course.y}
                  d={`M${course.left} ${course.y} H${course.right}`}
                  fill="none"
                  stroke="rgba(148,112,62,0.42)"
                  strokeWidth="1"
                  variants={draw(0.75 + index * 0.12, 0.6)}
                />
              ))}
            </svg>
            <div className="mt-3 flex items-baseline justify-between gap-4 text-[0.58rem] font-extrabold uppercase tracking-[0.18em] text-ink/58">
              <span>Giza</span>
              <span>29.9792° N</span>
            </div>
          </div>
        </motion.div>

        <div className="col-span-6 col-start-7 -mr-[calc(var(--page-x)*0.4)] max-md:order-2 max-md:mr-0 max-md:mt-7">
          <DepthImage
            src="/images/placeholders/arrival-courtyard.webp"
            alt="Warm limestone arrival space with brass and basalt details"
            sizes="(max-width: 760px) 92vw, (max-width: 1024px) 68vw, 46vw"
            className="image-frame relative aspect-[6/5] origin-center"
            imageClassName="object-cover"
            objectPosition="52% 54%"
          />

          <motion.p
            className="mt-4 border-t border-ink/14 pt-3 text-[0.56rem] font-extrabold uppercase tracking-[0.16em] text-ink/58"
            variants={motionPrimitives.precisionDetail}
            transition={{ duration: 0.42, delay: 0.46, ease: luxuryEase }}
          >
            Doorway between plateau and house
          </motion.p>
        </div>
      </motion.div>
    </section>
  );
}
