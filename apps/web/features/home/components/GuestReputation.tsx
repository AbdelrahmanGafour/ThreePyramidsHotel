"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { motion, useMotionValue, useReducedMotion } from "motion/react";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";

type ReputationStyle = CSSProperties & {
  "--reputation-glint-x"?: string;
};

export function GuestReputation() {
  const reduceMotion = useReducedMotion();
  const [canHover, setCanHover] = useState(false);
  const objectRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(query.matches);

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <motion.section
      className="bg-[linear-gradient(180deg,var(--limestone),var(--ivory))] py-[clamp(4rem,6.2vw,5.9rem)] text-ink"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-14% 0px" }}
      variants={motionPrimitives.staggerContainer}
    >
      <div className="page-grid items-center gap-y-10">
        <motion.div className="col-span-3 col-start-2" variants={motionPrimitives.revealUp}>
          <p className="label text-aged-gold">Guest reputation</p>
          <p className="mt-5 max-w-[270px] text-[0.88rem] leading-[1.78] text-ink/62 md:mt-7">
            A quiet reputation held in service, atmosphere, and the view guests remember.
          </p>
        </motion.div>

        <motion.div className="col-span-4 col-start-5 flex justify-center" variants={motionPrimitives.revealUp}>
          <motion.div
            ref={objectRef}
            className="reputation-object grid aspect-square w-[min(18rem,72vw)] place-items-center text-center text-ivory md:w-[min(23rem,78vw)]"
            aria-label="Guest sentiment: Wonderful. Verified guest sentiment placeholder."
            onPointerMove={(event) => {
              if (!canHover || reduceMotion) return;

              const bounds = event.currentTarget.getBoundingClientRect();
              const x = (event.clientX - bounds.left) / bounds.width - 0.5;
              const y = (event.clientY - bounds.top) / bounds.height - 0.5;

              if (frameRef.current) cancelAnimationFrame(frameRef.current);
              frameRef.current = requestAnimationFrame(() => {
                rotateX.set(y * -0.55);
                rotateY.set(x * 0.55);
                objectRef.current?.style.setProperty("--reputation-glint-x", `${28 + x * 34}%`);
              });
            }}
            onPointerLeave={() => {
              if (frameRef.current) cancelAnimationFrame(frameRef.current);
              rotateX.set(0);
              rotateY.set(0);
              objectRef.current?.style.setProperty("--reputation-glint-x", "28%");
            }}
            style={
              {
                "--reputation-glint-x": "28%",
                rotateX: reduceMotion ? 0 : rotateX,
                rotateY: reduceMotion ? 0 : rotateY,
              } as ReputationStyle
            }
            transition={{ duration: 0.5, ease: luxuryEase }}
          >
            <div className="relative z-10 px-5 md:px-7">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.22em] text-brass">
                Verified guest sentiment
              </p>
              <p className="mt-5 font-sans text-[clamp(1.7rem,8vw,2.2rem)] font-semibold leading-none md:mt-7 md:text-[clamp(2rem,3.4vw,2.85rem)]">
                Wonderful
              </p>
              <div className="mx-auto my-5 h-px w-20 bg-brass/72 md:my-7 md:w-24" />
              <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-ivory/54">
                Source to confirm
              </p>
            </div>
          </motion.div>
        </motion.div>

        <motion.div className="col-span-4 col-start-9" variants={motionPrimitives.revealUp}>
          <blockquote className="max-w-[560px] font-serif text-[clamp(1.65rem,7.4vw,2.2rem)] leading-[1.12] md:text-[clamp(1.8rem,2.9vw,2.75rem)]">
            &quot;Quiet service, beautiful rooms, and a rooftop view we still talk about.&quot;
          </blockquote>
          <div className="mt-8 grid max-w-[360px] grid-cols-3 border-y border-ink/12 py-4 text-[0.58rem] font-black uppercase tracking-[0.18em] text-ink/48">
            <span>Service</span>
            <span>Location</span>
            <span>Value</span>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}
