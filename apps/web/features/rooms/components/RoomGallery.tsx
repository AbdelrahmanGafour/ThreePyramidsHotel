"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { luxuryEase } from "@/shared/components/motion/PremiumMotion";
import type { Room } from "@/features/rooms/data/roomsData";

type RoomGalleryProps = {
  room: Room;
};

const MAX_SUPPORTING = 2;

function wrapIndex(index: number, length: number) {
  return (index + length) % length;
}

// A curated primary-plus-supporting composition rather than an even row of
// ecommerce thumbnails — and it degrades gracefully to a single controlled
// frame when a room only has one confirmed photo. The vertical brass rule is
// this collection's signature elevation mark, carried over from the room
// tiles at a larger scale here since this is a once-per-page moment.
export function RoomGallery({ room }: RoomGalleryProps) {
  const images = room.gallery?.length ? room.gallery : [room.image];
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const reduceMotion = useReducedMotion();
  const hasMultiple = images.length > 1;
  const supporting = images.slice(1, 1 + MAX_SUPPORTING);
  const remaining = images.length - 1 - MAX_SUPPORTING;

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
      <button
        ref={openerRef}
        type="button"
        className="image-frame group relative aspect-[4/3] w-full cursor-zoom-in sm:aspect-[3/2]"
        onClick={() => openAt(active)}
        aria-label={`Open larger photo of ${room.name}`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.01 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.6, ease: luxuryEase }}
          >
            <Image
              src={images[active]}
              alt={room.imageAlt}
              fill
              priority
              sizes="(max-width: 1024px) 92vw, 62vw"
              className="object-cover transition-transform duration-700 group-hover:scale-[1.015]"
              style={{ objectPosition: room.position }}
            />
          </motion.div>
        </AnimatePresence>

        {hasMultiple ? (
          <span className="absolute bottom-3 right-3 bg-ink/75 px-2.5 py-1 text-[0.8125rem] font-semibold text-ivory">
            Photo {active + 1} of {images.length}
          </span>
        ) : null}
      </button>

      {hasMultiple ? (
        <motion.div
          className={`mt-4 grid items-start gap-4 ${supporting.length > 1 ? "grid-cols-[1.6fr_1fr]" : "grid-cols-1"}`}
          initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10% 0px" }}
          transition={{ duration: reduceMotion ? 0 : 0.55, delay: reduceMotion ? 0 : 0.18, ease: luxuryEase }}
        >
          {supporting.map((src, offset) => {
            const index = offset + 1;
            const isDetailFrame = offset === 1;
            const isLastVisible = offset === supporting.length - 1 && remaining > 0;

            return (
              <button
                key={src + index}
                type="button"
                className={`image-frame relative ${isDetailFrame ? "aspect-square" : "aspect-[4/3]"}`}
                onClick={() => openAt(index)}
                aria-label={isLastVisible ? `View all ${images.length} photos` : `Show photo ${index + 1}`}
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes={isDetailFrame ? "16vw" : "34vw"}
                  className="object-cover"
                  style={{ objectPosition: room.position }}
                />
                {isLastVisible ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-ink/60 text-[0.9375rem] font-semibold text-ivory">
                    +{remaining + 1} more
                  </span>
                ) : null}
              </button>
            );
          })}

          <button
            type="button"
            className="btn-link col-span-full mt-1 justify-self-start"
            onClick={() => openAt(0)}
          >
            View all photos
          </button>
        </motion.div>
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
