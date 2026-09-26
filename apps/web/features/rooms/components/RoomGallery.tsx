"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { luxuryEase } from "@/shared/components/motion/PremiumMotion";
import type { RoomWithPresentation } from "@/features/rooms/api";

type RoomGalleryProps = {
  room: RoomWithPresentation;
};

function wrapIndex(index: number, length: number) {
  return (index + length) % length;
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d={direction === "left" ? "M14 5l-7 7 7 7" : "M10 5l7 7-7 7"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A single obvious way to browse: one large photo, plain prev/next arrows
// always visible (never hover-only), and an equal-size thumbnail strip below
// — no curated "primary plus supporting" asymmetry, no truncated "+N more"
// overlay. A guest should never wonder what's a photo and what's decoration.
// Degrades gracefully to a single controlled frame when a room has only one
// confirmed photo.
export function RoomGallery({ room }: RoomGalleryProps) {
  const images = room.gallery?.length ? room.gallery : [room.image];
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const reduceMotion = useReducedMotion();
  const hasMultiple = images.length > 1;

  const go = useCallback(
    (direction: number) => {
      setActive((current) => wrapIndex(current + direction, images.length));
    },
    [images.length],
  );

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, []);

  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    if (!touchStart.current || !hasMultiple) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.current.x;
    const deltaY = touch.clientY - touchStart.current.y;
    touchStart.current = null;

    if (Math.abs(deltaX) > 44 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35) go(deltaX < 0 ? 1 : -1);
  };

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };

    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [close, go, open]);

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="image-frame relative aspect-[4/3] w-full sm:aspect-[3/2]">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.01 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.5, ease: luxuryEase }}
          >
            <Image
              src={images[active]}
              alt={room.imageAlt}
              fill
              priority
              sizes="(max-width: 1024px) 92vw, 62vw"
              className="object-cover"
              style={{ objectPosition: room.position }}
            />
          </motion.div>
        </AnimatePresence>

        <button
          ref={openerRef}
          type="button"
          onClick={() => openAt(active)}
          aria-label={`View larger photo of ${room.name}`}
          className="inner-focus absolute left-3 top-3 flex h-11 w-11 items-center justify-center border border-ivory/45 bg-ink/55 text-ivory transition-colors hover:bg-ink/75"
        >
          <ExpandIcon />
        </button>

        {hasMultiple ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="inner-focus absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center border border-ivory/45 bg-ink/55 text-ivory transition-colors hover:bg-ink/75"
            >
              <ChevronIcon direction="left" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="inner-focus absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center border border-ivory/45 bg-ink/55 text-ivory transition-colors hover:bg-ink/75"
            >
              <ChevronIcon direction="right" />
            </button>
            <span className="absolute bottom-3 right-3 bg-ink/75 px-2.5 py-1 text-[0.8125rem] font-semibold text-ivory">
              Photo {active + 1} of {images.length}
            </span>
          </>
        ) : null}
      </div>

      {hasMultiple ? (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1" role="tablist" aria-label={`${room.name} photos`}>
          {images.map((src, index) => (
            <button
              key={src + index}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-label={`Photo ${index + 1} of ${images.length}`}
              onClick={() => setActive(index)}
              className={`image-frame relative aspect-square w-[4.25rem] shrink-0 border-2 transition-colors sm:w-20 ${
                index === active ? "border-brass" : "border-transparent hover:border-ink/25"
              }`}
            >
              <Image src={src} alt="" fill sizes="80px" className="object-cover" style={{ objectPosition: room.position }} />
            </button>
          ))}
        </div>
      ) : null}

      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[70] grid h-[100dvh] bg-[rgba(30,24,21,0.97)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-ivory md:p-8"
            role="dialog"
            aria-modal="true"
            aria-label={`${room.name} photos`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: luxuryEase }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <p className="text-[0.9375rem] font-semibold text-ivory">
                {hasMultiple ? `Photo ${active + 1} of ${images.length}` : room.name}
              </p>
              <button
                ref={closeButtonRef}
                type="button"
                className="min-h-11 border border-ivory/50 px-4 text-[0.9375rem] font-semibold text-ivory transition-colors hover:border-brass hover:text-brass"
                aria-label="Close photo viewer"
                onClick={close}
              >
                Close
              </button>
            </div>

            <div className="relative min-h-0 flex-1">
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  className="absolute inset-0"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.5, ease: luxuryEase }}
                >
                  <Image src={images[active]} alt={room.imageAlt} fill sizes="100vw" className="object-contain" />
                </motion.div>
              </AnimatePresence>
            </div>

            {hasMultiple ? (
              <div className="mt-4 flex items-center justify-between gap-5">
                <button
                  type="button"
                  className="min-h-11 border border-ivory/50 px-5 text-[0.9375rem] font-semibold text-ivory transition-colors hover:border-brass hover:text-brass"
                  onClick={() => go(-1)}
                >
                  Previous photo
                </button>
                <button
                  type="button"
                  className="min-h-11 border border-brass bg-brass px-5 text-[0.9375rem] font-semibold text-ink transition-colors hover:bg-ivory"
                  onClick={() => go(1)}
                >
                  Next photo
                </button>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
