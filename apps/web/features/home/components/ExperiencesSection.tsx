"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { experiences } from "@/features/home/data/homeData";

export function ExperiencesSection() {
  const [active, setActive] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const reduceMotion = useReducedMotion();
  const selected = experiences[active];
  const next = experiences[(active + 1) % experiences.length];

  const go = (direction: number) => {
    setActive((current) => (current + direction + experiences.length) % experiences.length);
  };

  return (
    <motion.section
      id="experiences"
      className="stone-section overflow-hidden py-[var(--section-y)] text-ink"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-12% 0px" }}
      variants={motionPrimitives.staggerContainer}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      }}
      onTouchEnd={(event) => {
        if (!touchStart.current) return;

        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - touchStart.current.x;
        const deltaY = touch.clientY - touchStart.current.y;
        touchStart.current = null;

        if (Math.abs(deltaX) > 46 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35) {
          go(deltaX < 0 ? 1 : -1);
        }
      }}
    >
      <div className="page-grid gap-y-6 md:gap-y-8">
        <motion.div className="col-span-3 col-start-2" variants={motionPrimitives.revealUp}>
          <p className="label text-aged-gold">Experiences</p>
          <p className="mt-5 max-w-[260px] text-[0.84rem] leading-[1.75] text-ink/58">
            A private index of Egypt, arranged by distance, light, and pace.
          </p>
        </motion.div>
        <motion.div className="col-span-6 col-start-5" variants={motionPrimitives.revealUp}>
          <h2 className="max-w-[650px] text-balance font-sans text-[clamp(1.85rem,8vw,2.35rem)] font-semibold leading-[1.08] md:text-[clamp(1.85rem,3.05vw,2.75rem)]">
            A curated route through horizon, museum, desert, and evening.
          </h2>
        </motion.div>
      </div>

      <div className="mt-8 grid gap-5 px-[var(--page-x)] md:mt-10 md:gap-8 lg:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)] lg:items-stretch">
        <motion.div
          className="relative order-2 grid content-between border-y border-ink/14 py-2 lg:order-1"
          variants={motionPrimitives.revealUp}
        >
          <div className="absolute left-[2.1rem] top-8 hidden h-[calc(100%-4rem)] w-px bg-ink/10 md:block" aria-hidden="true" />
          <div className="grid grid-cols-4 md:block" aria-label="Curated experience index">
            {experiences.map((experience, index) => {
              const selectedItem = active === index;

              return (
                <button
                  key={experience.title}
                  type="button"
                  aria-pressed={selectedItem}
                  aria-label={`Show ${experience.title}`}
                  className={`group relative grid min-h-14 content-center border-r border-ink/10 px-2 py-3 text-center transition-colors last:border-r-0 md:min-h-[98px] md:grid-cols-[3.7rem_1fr] md:gap-4 md:border-b md:border-r-0 md:py-4 md:pr-3 md:text-left md:last:border-b-0 ${
                    selectedItem ? "text-ink" : "text-ink/48 hover:text-ink/74"
                  }`}
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onClick={() => setActive(index)}
                >
                  <span className={`relative z-10 text-[0.72rem] font-black tracking-[0.2em] transition-colors ${selectedItem ? "text-brass" : "text-ink/30"}`}>
                    {experience.number}
                  </span>
                  <span className="hidden min-w-0 md:block">
                    <span className={`block text-[0.66rem] font-black uppercase tracking-[0.18em] transition-transform duration-300 group-hover:translate-x-1 ${selectedItem ? "translate-x-1 text-aged-gold" : ""}`}>
                      {experience.kicker}
                    </span>
                    <span className="mt-2 block font-sans text-[clamp(1.05rem,1.5vw,1.38rem)] font-semibold leading-[1.08]">
                      {experience.title}
                    </span>
                    <span className={`mt-3 block overflow-hidden transition-all duration-500 ${selectedItem ? "max-h-16 opacity-100" : "max-h-0 opacity-0"}`}>
                      <span className="block max-w-[390px] text-[0.84rem] leading-[1.55] text-ink/62">
                        {experience.copy}
                      </span>
                    </span>
                    <span className="mt-3 block h-px overflow-hidden bg-ink/12">
                      <span
                        className={`block h-px origin-left bg-brass transition-transform duration-500 ${
                          selectedItem ? "scale-x-100" : "scale-x-0 group-hover:scale-x-50"
                        }`}
                      />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-between gap-5 text-[0.58rem] font-black uppercase tracking-[0.16em] text-ink/42 md:mt-6 md:tracking-[0.2em]">
            <span>Catalog / Private guide</span>
            <span className="text-lapis">Delta marker</span>
          </div>
        </motion.div>

        <motion.div className="relative order-1 min-h-[360px] sm:min-h-[420px] lg:order-2 lg:min-h-[650px]" variants={motionPrimitives.revealUp}>
          <button
            type="button"
            aria-label={`Preview next experience: ${next.title}`}
            className="group absolute -right-3 top-8 z-0 hidden h-[78%] w-[17%] overflow-hidden border border-aged-gold/18 opacity-70 transition-transform duration-500 hover:translate-x-3 hover:opacity-95 lg:block"
            onClick={() => go(1)}
          >
            <Image
              src={next.image}
              alt=""
              fill
              sizes="13vw"
              className="object-cover"
              style={{ objectPosition: next.position }}
            />
            <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(30,24,21,0.28),rgba(30,24,21,0.06))]" />
          </button>

          <div className="image-frame relative z-10 h-full min-h-[360px] sm:min-h-[420px] lg:min-h-[650px] lg:w-[92%]">
            <AnimatePresence mode="wait">
              <motion.div
                key={selected.title}
                className="absolute inset-0"
                initial={{
                  opacity: 0,
                  scale: reduceMotion ? 1 : 1.012,
                  clipPath: "inset(0 0 0 12%)",
                }}
                animate={{ opacity: 1, scale: 1, clipPath: "inset(0 0 0 0%)" }}
                exit={{
                  opacity: 0,
                  scale: reduceMotion ? 1 : 0.996,
                  clipPath: "inset(0 12% 0 0)",
                }}
                transition={{ duration: reduceMotion ? 0 : 0.78, ease: luxuryEase }}
              >
                <Image
                  src={selected.image}
                  alt={`${selected.title} experience concept`}
                  fill
                  sizes="(max-width: 1024px) 92vw, 62vw"
                  className="object-cover"
                  style={{ objectPosition: selected.position }}
                />
              </motion.div>
            </AnimatePresence>
            <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(30,24,21,0.52),transparent_42%)]" />
            <div className="absolute bottom-4 left-4 right-4 text-ivory md:bottom-5 md:left-5 md:right-auto md:max-w-[470px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={selected.title}
                  initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.46, delay: reduceMotion ? 0 : 0.12, ease: luxuryEase }}
                >
                  <p className="label text-brass">{selected.number} / {selected.meta}</p>
                  <p className="mt-3 max-w-[420px] text-[0.96rem] leading-[1.62] text-ivory/76">
                    {selected.copy}
                  </p>
                  <a href="#reserve" className="text-link mt-4 text-ivory">
                    View experience -&gt;
                  </a>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}
