"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const AUTOPLAY_MS = 8200;

const slides = [
  {
    id: "horizon",
    number: "01",
    chapter: "The Horizon",
    meta: "Giza / Egypt / 29.9792 N",
    title: (
      <>
        Where the day
        <br />
        meets <span className="serif-accent">four thousand</span>
        <br />
        years of history.
      </>
    ),
    copy: "A quiet base beside the Giza plateau, composed around light, stillness and the view.",
    action: "Enter Three Pyramids",
    href: "#stay",
    note: "Sunset / Giza Plateau",
    image: "/images/placeholders/giza-suite-terrace.webp",
    alt: "Private terrace composed in warm evening light near the Pyramids of Giza",
    position: "42% 48%",
    contentClass: "md:col-start-2 md:col-span-5 md:self-end",
  },
  {
    id: "house",
    number: "02",
    chapter: "The House",
    meta: "Stone / Linen / Warm light",
    title: (
      <>
        A quieter kind
        <br />
        of room in Giza.
      </>
    ),
    copy: "Natural textures, softened light and spaces designed to let the city fall away.",
    action: "Discover the rooms",
    href: "#stay",
    note: "Private retreat / Giza",
    image: "/images/placeholders/warm-room.webp",
    alt: "Warm boutique hotel room with soft linen and architectural light",
    position: "48% 50%",
    contentClass: "md:col-start-2 md:col-span-5 md:self-center",
  },
  {
    id: "after-dark",
    number: "03",
    chapter: "After Dark",
    meta: "Rooftop / Dusk",
    title: (
      <>
        The plateau changes
        <br />
        when the lanterns
        <br />
        come on.
      </>
    ),
    copy: "Evening light, quiet tables and the pyramids remaining on the horizon after sunset.",
    action: "Discover the rooftop",
    href: "#rooftop",
    note: "Evening in Giza",
    image: "/images/placeholders/rooftop-dining.webp",
    alt: "Rooftop dining at dusk with warm light and the Giza plateau beyond",
    position: "58% 48%",
    contentClass: "md:col-start-3 md:col-span-5 md:self-end",
  },
];

export function Hero() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const reduceMotion = useReducedMotion();
  const touchStartX = useRef<number | null>(null);
  const touchPauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = slides[active];
  const isInitialHeroSlide = active === 0 && current.image === slides[0].image;
  const shouldPause = paused || hidden || Boolean(reduceMotion);

  const setSlide = useCallback((index: number) => {
    setActive(index);
  }, []);

  const go = useCallback((direction: 1 | -1) => {
    setActive((index) => (index + direction + slides.length) % slides.length);
  }, []);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (shouldPause) return;

    const timer = window.setInterval(() => {
      setActive((index) => (index + 1) % slides.length);
    }, AUTOPLAY_MS);

    return () => window.clearInterval(timer);
  }, [active, shouldPause]);

  useEffect(() => {
    return () => {
      if (touchPauseTimer.current) clearTimeout(touchPauseTimer.current);
    };
  }, []);

  const pauseBrieflyAfterTouch = () => {
    setPaused(true);
    if (touchPauseTimer.current) clearTimeout(touchPauseTimer.current);
    touchPauseTimer.current = setTimeout(() => setPaused(false), 6200);
  };

  return (
    <section
      className="relative min-h-svh overflow-hidden bg-espresso text-ivory"
      aria-label="Hotel highlights"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
        pauseBrieflyAfterTouch();
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        const end = event.changedTouches[0]?.clientX;
        touchStartX.current = null;
        if (start === null || end === undefined) return;

        const delta = end - start;
        if (Math.abs(delta) > 42) go(delta < 0 ? 1 : -1);
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.018 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.92, ease: [0.22, 1, 0.36, 1] }}
        >
          <Image
            src={current.image}
            alt={current.alt}
            fill
            preload={isInitialHeroSlide}
            loading={isInitialHeroSlide ? "eager" : undefined}
            fetchPriority={isInitialHeroSlide ? "high" : undefined}
            sizes="100vw"
            className="object-cover"
            style={{ objectPosition: current.position }}
          />
        </motion.div>
      </AnimatePresence>

      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(30,24,21,0.64)_0%,rgba(43,30,24,0.32)_34%,rgba(43,30,24,0.05)_72%),linear-gradient(0deg,rgba(30,24,21,0.58)_0%,transparent_46%,rgba(30,24,21,0.18)_100%)]" />
      <div className="absolute inset-x-[var(--page-x)] top-[94px] hidden h-px bg-[linear-gradient(90deg,rgba(176,138,81,0.58),transparent_34%,rgba(244,238,229,0.16))] md:block" />

      <div className="hero-plaque absolute right-[var(--page-x)] top-[28%] z-10 hidden h-[220px] w-[38px] md:block">
        <span className="vertical-rl mx-auto mt-5 block text-[0.52rem] font-black uppercase tracking-[0.2em] text-brass">
          Three Pyramids
        </span>
        <span className="absolute bottom-5 left-1/2 h-12 w-px -translate-x-1/2 bg-brass/42" />
      </div>

      <div className="relative z-10 grid min-h-svh px-[var(--page-x)] pb-[clamp(6.25rem,18vw,8rem)] pt-[clamp(6rem,18vw,7rem)] md:grid-cols-12 md:pb-[clamp(8rem,12vw,9.4rem)] md:pt-28">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            className={`max-w-[560px] ${current.contentClass}`}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 18, clipPath: "inset(8% 0 0 0)" }}
            animate={{ opacity: 1, y: 0, clipPath: "inset(0 0 0 0)" }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -10, clipPath: "inset(0 0 8% 0)" }}
            transition={{ duration: reduceMotion ? 0 : 0.72, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 md:mb-5 md:gap-x-4">
              <p className="label text-brass">
                {current.number} - {current.chapter}
              </p>
              <span className="hidden h-px w-10 bg-brass/52 sm:block" />
              <p className="hidden text-[0.58rem] font-extrabold uppercase tracking-[0.2em] text-ivory/58 sm:block">
                {current.meta}
              </p>
            </div>
            <h1 className="display max-w-[22rem] text-balance text-[clamp(2.1rem,10vw,2.55rem)] md:max-w-[560px] md:text-[clamp(2.15rem,3.78vw,3.5rem)]">
              <span className="line-reveal">
                <span>{current.title}</span>
              </span>
            </h1>
            <div className="mt-5 grid max-w-[430px] gap-4 sm:grid-cols-[1fr_auto] sm:items-end md:mt-6 md:gap-5">
              <p className="max-w-[20rem] text-[0.9rem] leading-[1.65] text-ivory/76 md:text-[0.92rem] md:leading-[1.7]">{current.copy}</p>
              <a href={current.href} className="text-link text-brass">
                {current.action} -&gt;
              </a>
            </div>
          </motion.div>
        </AnimatePresence>

        <motion.p
          key={`${current.id}-note`}
          className="absolute bottom-[clamp(7.9rem,12vw,9.2rem)] right-[var(--page-x)] hidden max-w-[190px] text-right text-[0.58rem] font-extrabold uppercase tracking-[0.22em] text-ivory/58 md:block"
          initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.58, delay: reduceMotion ? 0 : 0.18 }}
        >
          {current.note}
        </motion.p>

        <div className="hero-chapter-rail absolute bottom-11 left-[var(--page-x)] z-20 grid w-[min(42rem,calc(100vw-(var(--page-x)*2)))] grid-cols-3 gap-3 md:bottom-[clamp(1rem,3vw,2rem)] md:gap-5">
          {slides.map((slide, index) => {
            const selected = active === index;

            return (
              <button
                key={slide.id}
                type="button"
                aria-pressed={selected}
                aria-label={`Show chapter ${slide.number}, ${slide.chapter}`}
                className={`group grid min-h-11 content-center text-left transition-colors md:min-h-12 ${
                  selected ? "text-ivory" : "text-ivory/46 hover:text-ivory/78"
                }`}
                onClick={() => setSlide(index)}
              >
                <span className={`text-[0.62rem] font-black tracking-[0.2em] ${selected ? "text-brass" : ""}`}>
                  {slide.number}
                </span>
                <span className="mt-1 block text-[0.58rem] font-extrabold uppercase tracking-[0.19em]">
                  {slide.chapter}
                </span>
                <span className="mt-2 h-px overflow-hidden bg-ivory/18 md:mt-3">
                  <span
                    key={`${slide.id}-${selected}-${shouldPause}`}
                    className={`block h-px origin-left bg-brass ${
                      selected && !reduceMotion ? "hero-progress-fill" : selected ? "scale-x-100" : "scale-x-0"
                    }`}
                    style={{
                      animationDuration: `${AUTOPLAY_MS}ms`,
                      animationPlayState: shouldPause ? "paused" : "running",
                    }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
