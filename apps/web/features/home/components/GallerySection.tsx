"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { gallery } from "@/features/home/data/homeData";

function wrapIndex(index: number) {
  return (index + gallery.length) % gallery.length;
}

export function GallerySection() {
  const [active, setActive] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const selected = gallery[active];
  const previous = gallery[wrapIndex(active - 1)];
  const next = gallery[wrapIndex(active + 1)];

  const go = useCallback((direction: number) => {
    setActive((current) => wrapIndex(current + direction));
  }, []);

  const closeGallery = useCallback(() => {
    setViewerOpen(false);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, []);

  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    if (!touchStart.current) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.current.x;
    const deltaY = touch.clientY - touchStart.current.y;
    touchStart.current = null;

    if (Math.abs(deltaX) > 44 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35) {
      go(deltaX < 0 ? 1 : -1);
    }
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === "touch") return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (!pointerStart.current) return;

    const deltaX = event.clientX - pointerStart.current.x;
    const deltaY = event.clientY - pointerStart.current.y;
    pointerStart.current = null;

    if (Math.abs(deltaX) > 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
      draggedRef.current = true;
      go(deltaX < 0 ? 1 : -1);
    }
  };

  const consumeDragClick = () => {
    if (!draggedRef.current) return false;
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 0);
    return true;
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!viewerOpen) return;
      if (event.key === "Escape") closeGallery();
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
      if (event.key !== "Tab") return;

      const viewer = document.getElementById("gallery-viewer");
      const focusable = viewer?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );

      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = viewerOpen ? "hidden" : "";
    if (viewerOpen) window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [closeGallery, go, viewerOpen]);

  return (
    <motion.section
      id="gallery"
      className="overflow-hidden bg-ink py-[clamp(4rem,5.6vw,5.4rem)] text-ivory"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-12% 0px" }}
      variants={motionPrimitives.staggerContainer}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onKeyDown={(event) => {
        if (viewerOpen) return;
        if (event.key === "ArrowRight") go(1);
        if (event.key === "ArrowLeft") go(-1);
      }}
    >
      <div className="page-grid gap-y-5">
        <motion.div className="col-span-3 col-start-2" variants={motionPrimitives.revealUp}>
          <p className="label text-brass">Gallery</p>
        </motion.div>
        <motion.div className="col-span-6 col-start-5" variants={motionPrimitives.revealUp}>
          <h2 className="max-w-[560px] text-balance font-sans text-[clamp(1.8rem,7.6vw,2.3rem)] font-semibold leading-[1.08] md:text-[clamp(1.75rem,2.6vw,2.35rem)]">
            Fragments of the house, seen like a film strip.
          </h2>
        </motion.div>
      </div>

      <motion.div
        className="mt-6 px-[var(--page-x)] md:mt-7"
        variants={motionPrimitives.revealUp}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          pointerStart.current = null;
        }}
      >
        <div className="relative mx-auto grid max-w-[1160px] gap-4 md:gap-5 lg:grid-cols-[0.17fr_0.57fr_0.26fr] lg:items-center">
          <button
            type="button"
            className="image-frame hidden aspect-[4/5] min-h-[340px] self-center opacity-40 transition duration-500 hover:-translate-x-2 hover:opacity-72 lg:block"
            onClick={() => {
              if (consumeDragClick()) return;
              go(-1);
            }}
            aria-label={`Previous gallery image: ${previous.caption}`}
          >
            <Image
              src={previous.src}
              alt=""
              fill
              sizes="15vw"
              className="object-cover"
              style={{ objectPosition: previous.position }}
            />
            <span className="absolute inset-0 bg-[rgba(30,24,21,0.18)]" />
            <span className="absolute bottom-3 left-3 text-[0.54rem] font-black uppercase tracking-[0.18em] text-ivory/52">
              Prev
            </span>
          </button>

          <button
            ref={openerRef}
            type="button"
            className="image-frame group relative z-10 aspect-[4/3] min-h-[260px] w-full cursor-zoom-in border border-brass/18 shadow-[0_26px_70px_rgba(0,0,0,0.34)] sm:min-h-[330px] md:aspect-[3/2] md:min-h-[390px] lg:min-h-[430px]"
            onClick={() => {
              if (consumeDragClick()) return;
              setViewerOpen(true);
            }}
            aria-label={`Open gallery image: ${selected.caption}`}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={selected.caption}
                className="absolute inset-0"
                initial={{ opacity: 0, x: reduceMotion ? 0 : 16, scale: reduceMotion ? 1 : 0.988 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: reduceMotion ? 0 : -12, scale: reduceMotion ? 1 : 0.992 }}
                transition={{ duration: reduceMotion ? 0 : 0.74, ease: luxuryEase }}
              >
                <Image
                  src={selected.src}
                  alt={selected.alt}
                  fill
                  sizes="(max-width: 767px) 92vw, (max-width: 1024px) 72vw, 56vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-[1.012]"
                  style={{ objectPosition: selected.position }}
                />
              </motion.div>
            </AnimatePresence>
            <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(30,24,21,0.16),transparent_38%)]" />
            <span className="absolute left-4 top-4 text-[0.56rem] font-black uppercase tracking-[0.18em] text-brass">
              {String(active + 1).padStart(2, "0")} / {String(gallery.length).padStart(2, "0")}
            </span>
          </button>

          <aside className="grid gap-4 border-t border-brass/22 pt-4 lg:min-h-[430px] lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={selected.caption}
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
                transition={{ duration: reduceMotion ? 0 : 0.46, delay: reduceMotion ? 0 : 0.06, ease: luxuryEase }}
                className="grid content-start gap-4"
              >
                <div>
                  <p className="text-[0.54rem] font-black uppercase tracking-[0.22em] text-ivory/36">
                    Archive {String(active + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-3 text-[clamp(1.05rem,1.5vw,1.32rem)] font-semibold uppercase leading-[1.05] tracking-[0.08em] text-ivory">
                    {selected.caption}
                  </h3>
                  <p className="mt-3 max-w-[340px] text-[0.82rem] leading-[1.55] text-ivory/58 lg:max-w-[240px]">
                    A selected frame from the house archive, arranged by arrival, room, rooftop, and evening light.
                  </p>
                </div>

                <button
                  type="button"
                  className="w-fit border-b border-brass/54 pb-2 text-[0.56rem] font-black uppercase tracking-[0.18em] text-brass transition-colors hover:text-ivory"
                  onClick={() => setViewerOpen(true)}
                >
                  View full frame -&gt;
                </button>
              </motion.div>
            </AnimatePresence>

            <button
              type="button"
              className="group grid grid-cols-[5rem_1fr] items-end gap-4 self-end text-left sm:grid-cols-[5.4rem_1fr] lg:grid-cols-1"
              onClick={() => {
                if (consumeDragClick()) return;
                go(1);
              }}
              aria-label={`Next gallery image: ${next.caption}`}
            >
              <span className="image-frame relative block aspect-[5/6] overflow-hidden opacity-66 transition duration-500 group-hover:-translate-x-1 group-hover:opacity-88 lg:aspect-[4/5]">
                <Image
                  src={next.src}
                  alt=""
                  fill
                  sizes="(max-width: 1024px) 20vw, 24vw"
                  className="object-cover"
                  style={{ objectPosition: next.position }}
                />
                <span className="absolute inset-0 bg-[rgba(30,24,21,0.12)]" />
              </span>
              <span className="block">
                <span className="block text-[0.54rem] font-black uppercase tracking-[0.2em] text-brass">
                  Next frame
                </span>
                <span className="mt-2 block text-[0.78rem] uppercase tracking-[0.12em] text-ivory/64">
                  {next.caption}
                </span>
              </span>
            </button>

            <div className="flex gap-5 self-end">
              <button
                className="min-h-10 text-[0.56rem] font-black uppercase tracking-[0.18em] text-ivory/62 transition-colors hover:text-brass"
                type="button"
                onClick={() => go(-1)}
              >
                Prev
              </button>
              <button
                className="min-h-10 text-[0.56rem] font-black uppercase tracking-[0.18em] text-brass transition-colors hover:text-ivory"
                type="button"
                onClick={() => go(1)}
              >
                Next -&gt;
              </button>
            </div>
          </aside>
        </div>

        <div className="mx-auto mt-4 grid max-w-[1160px] gap-4 lg:grid-cols-[0.17fr_0.57fr_0.26fr] lg:items-end">
          <div className="hidden lg:block" aria-hidden="true" />
          <div className="grid grid-cols-5 gap-2" aria-label="Gallery film index">
            {gallery.map((item, index) => {
              const selectedItem = active === index;

              return (
                <button
                  key={item.caption}
                  type="button"
                  aria-pressed={selectedItem}
                  aria-label={`Show ${item.caption}`}
                  className={`group min-w-0 text-left transition-colors ${
                    selectedItem ? "text-brass" : "text-ivory/44 hover:text-ivory/76"
                  }`}
                  onClick={() => setActive(index)}
                >
                  <span className="block truncate text-[0.56rem] font-black uppercase tracking-[0.12em] sm:tracking-[0.16em]">
                    {String(index + 1).padStart(2, "0")} <span className="hidden sm:inline">{item.caption}</span>
                  </span>
                  <span className="mt-2 block h-px overflow-hidden bg-ivory/14">
                    <span
                      className={`block h-px origin-left bg-brass transition-transform duration-500 ${
                        selectedItem ? "scale-x-100" : "scale-x-0 group-hover:scale-x-50"
                      }`}
                    />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="hidden text-right text-[0.54rem] font-black uppercase tracking-[0.2em] text-ivory/30 lg:block">
            35MM / Giza
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {viewerOpen ? (
          <motion.div
            id="gallery-viewer"
            className="fixed inset-0 z-[70] grid h-[100dvh] bg-[rgba(30,24,21,0.97)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-ivory md:p-8"
            role="dialog"
            aria-modal="true"
            aria-label="Gallery viewer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: luxuryEase }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="mb-4 grid grid-cols-[1fr_auto] items-center gap-4 md:grid-cols-[1fr_auto_1fr] md:gap-5">
              <p className="label text-brass">
                {String(active + 1).padStart(2, "0")} / {String(gallery.length).padStart(2, "0")}
              </p>
              <p className="label hidden text-center text-ivory/70 md:block">{selected.caption}</p>
              <button
                ref={closeButtonRef}
                type="button"
                className="min-h-11 justify-self-end text-[0.62rem] font-black uppercase tracking-[0.18em] text-ivory/68 transition-colors hover:text-brass"
                aria-label="Close gallery"
                onClick={closeGallery}
              >
                Close
              </button>
            </div>

            <div className="relative min-h-0 flex-1">
              <AnimatePresence mode="wait">
                <motion.div
                  key={selected.caption}
                  className="absolute inset-0"
                  initial={{ opacity: 0, x: reduceMotion ? 0 : 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: reduceMotion ? 0 : -14 }}
                  transition={{ duration: reduceMotion ? 0 : 0.52, ease: luxuryEase }}
                >
                  <Image src={selected.src} alt={selected.alt} fill sizes="100vw" className="object-contain" />
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="mt-4 flex items-center justify-between gap-5">
              <button
                className="min-h-11 text-[0.62rem] font-black uppercase tracking-[0.18em] text-ivory/68 transition-colors hover:text-brass"
                type="button"
                onClick={() => go(-1)}
              >
                Prev
              </button>
              <button
                className="min-h-11 text-[0.62rem] font-black uppercase tracking-[0.18em] text-brass transition-colors hover:text-ivory"
                type="button"
                onClick={() => go(1)}
              >
                Next
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}
