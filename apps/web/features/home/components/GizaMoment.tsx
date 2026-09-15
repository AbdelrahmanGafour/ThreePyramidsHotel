"use client";

import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { luxuryEase } from "@/shared/components/motion/PremiumMotion";

type NetworkInformationLike = { saveData?: boolean };

export function GizaMoment() {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const plaqueRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const updateGlint = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    plaqueRef.current?.style.setProperty("--mirror-glint-x", `${Math.max(6, Math.min(94, x))}%`);
    plaqueRef.current?.style.setProperty("--mirror-glint-y", `${Math.max(6, Math.min(94, y))}%`);
  }, []);

  const resetGlint = useCallback(() => {
    plaqueRef.current?.style.setProperty("--mirror-glint-x", "26%");
    plaqueRef.current?.style.setProperty("--mirror-glint-y", "22%");
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const section = sectionRef.current;
    if (!video || !section || reduceMotion) return;

    const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
    if (connection?.saveData) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          void video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.25 },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, [reduceMotion]);

  return (
    <section
      ref={sectionRef}
      className="relative -mt-px min-h-[70svh] overflow-hidden bg-ink text-ivory md:min-h-[88svh]"
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover object-[35%_50%] sm:object-[30%_50%]"
        poster="/videos/giza-dusk-poster.webp"
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
      >
        <source src="/videos/giza-dusk.webm" type="video/webm" />
        <source src="/videos/giza-dusk.mp4" type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_36%,transparent_54%,rgba(30,24,21,0.3)_100%),linear-gradient(90deg,rgba(30,24,21,0.54)_0%,rgba(30,24,21,0.22)_30%,transparent_62%),linear-gradient(0deg,rgba(30,24,21,0.46)_0%,transparent_42%)]" />
      <div className="absolute inset-0 bg-[rgba(140,94,69,0.05)] mix-blend-overlay" />
      <div
        className="absolute inset-x-0 top-[42%] h-[42%] bg-[radial-gradient(58%_100%_at_50%_50%,rgba(30,24,21,0.34),transparent_72%)]"
        aria-hidden="true"
      />

      <motion.div
        ref={plaqueRef}
        className="mirror-object absolute left-[var(--page-x)] top-[clamp(4.75rem,13vw,8rem)] z-10 w-[148px] px-3.5 py-2.5 sm:w-[176px] sm:px-4 sm:py-3 lg:w-[208px]"
        onPointerMove={updateGlint}
        onPointerLeave={resetGlint}
        initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-18% 0px" }}
        transition={{ duration: reduceMotion ? 0 : 0.55, delay: reduceMotion ? 0 : 0.15, ease: luxuryEase }}
      >
        <p className="text-[0.5rem] font-black uppercase tracking-[0.2em] text-ivory/68">Giza Plateau</p>
        <p className="mt-1.5 text-[0.56rem] font-extrabold leading-[1.5] tracking-[0.06em] text-brass/85">
          29.9792&deg; N
          <br />
          31.1342&deg; E
        </p>
      </motion.div>

      <div className="absolute inset-x-0 top-[58%] z-10 flex justify-center px-5 sm:px-[var(--page-x)] md:top-[63%]">
        <div className="w-full text-center sm:max-w-[560px] md:max-w-[640px] lg:max-w-[720px]">
          <h2 className="display text-[clamp(2.125rem,8vw,2.625rem)] leading-[1.08] md:text-[clamp(3.1rem,3.6vw,3.6rem)]">
            <motion.span
              className="block text-balance"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 14, clipPath: reduceMotion ? undefined : "inset(0 0 100% 0)" }}
              whileInView={{ opacity: 1, y: 0, clipPath: "inset(0 0 0% 0)" }}
              viewport={{ once: true, margin: "-18% 0px" }}
              transition={{ duration: reduceMotion ? 0 : 0.62, delay: reduceMotion ? 0 : 0.3, ease: luxuryEase }}
            >
              The plateau is not an excursion.
            </motion.span>
            <motion.span
              className="block text-balance"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 14, clipPath: reduceMotion ? undefined : "inset(0 0 100% 0)" }}
              whileInView={{ opacity: 1, y: 0, clipPath: "inset(0 0 0% 0)" }}
              viewport={{ once: true, margin: "-18% 0px" }}
              transition={{ duration: reduceMotion ? 0 : 0.62, delay: reduceMotion ? 0 : 1.15, ease: luxuryEase }}
            >
              It is the horizon.
            </motion.span>
          </h2>

          <motion.div
            className="mt-5 flex items-center justify-center gap-3 md:mt-6"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-18% 0px" }}
            transition={{ duration: reduceMotion ? 0 : 0.5, delay: reduceMotion ? 0 : 1.95, ease: luxuryEase }}
          >
            <span className="portal-line w-8" aria-hidden="true" />
            <span className="text-[0.54rem] font-black uppercase tracking-[0.22em] text-ivory/52">
              Dusk / Giza Plateau
            </span>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
