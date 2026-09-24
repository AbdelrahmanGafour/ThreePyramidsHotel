"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import type { RoomWithPresentation } from "@/features/rooms/api";

type RoomsSectionProps = {
  rooms: RoomWithPresentation[];
};

export function RoomsSection({ rooms }: RoomsSectionProps) {
  const [active, setActive] = useState(0);
  const [canHover, setCanHover] = useState(false);
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const panelRef = useRef<HTMLElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const reduceMotion = useReducedMotion();
  const room = rooms[active];
  const nextIndex = (active + 1) % rooms.length;
  const nextRoom = rooms[nextIndex];

  const go = useCallback((direction: number) => {
    setActive((current) => (current + direction + rooms.length) % rooms.length);
  }, [rooms.length]);

  const showRoom = useCallback((index: number) => {
    setActive(index);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(query.matches);

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <motion.section
      id="stay"
      className="relative overflow-hidden bg-ink py-[var(--section-y)] text-ivory"
      aria-label="Room browser"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-12% 0px" }}
      variants={motionPrimitives.staggerContainer}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") go(1);
        if (event.key === "ArrowLeft") go(-1);
      }}
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
      <div className="relative px-[var(--page-x)]">
        <motion.div
          className="mb-7 grid gap-4 md:mb-8 md:grid-cols-[0.62fr_1fr_0.74fr] md:items-end md:gap-5"
          variants={motionPrimitives.revealUp}
        >
          <p className="label text-brass">Rooms</p>
          <h2 className="max-w-[610px] text-balance font-sans text-[clamp(1.85rem,8vw,2.35rem)] font-semibold leading-[1.08] md:text-[clamp(1.75rem,2.9vw,2.65rem)]">
            Private rooms arranged as studies in stone, linen, light, and view.
          </h2>
          <p className="max-w-[330px] text-[0.9rem] leading-[1.68] text-ivory/62">
            Browse the current room concepts and choose the atmosphere that fits your stay.
          </p>
        </motion.div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.69fr)_minmax(320px,0.31fr)] lg:items-stretch">
          <motion.div
            className="relative min-h-[340px] sm:min-h-[410px] lg:min-h-[620px]"
            variants={motionPrimitives.revealUp}
          >
            <button
              type="button"
              aria-label={`Preview next room: ${nextRoom.name}`}
              className="group absolute -right-3 top-8 z-0 hidden h-[76%] w-[18%] overflow-hidden border border-brass/18 opacity-72 transition-transform duration-500 hover:translate-x-3 hover:opacity-100 lg:block"
              onClick={() => showRoom(nextIndex)}
            >
              <Image
                src={nextRoom.image}
                alt=""
                fill
                sizes="14vw"
                className="object-cover"
                style={{ objectPosition: nextRoom.position }}
              />
              <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(30,24,21,0.46),rgba(30,24,21,0.14))]" />
            </button>

            <motion.div
              className="image-frame relative z-10 h-full min-h-[340px] origin-center sm:min-h-[410px] lg:min-h-[620px] lg:w-[92%]"
              onPointerMove={(event) => {
                if (!canHover || reduceMotion) return;

                const bounds = event.currentTarget.getBoundingClientRect();
                const x = (event.clientX - bounds.left) / bounds.width - 0.5;
                const y = (event.clientY - bounds.top) / bounds.height - 0.5;
                rotateX.set(y * -0.75);
                rotateY.set(x * 0.75);
                panelRef.current?.style.setProperty("--panel-glint-x", `${72 + x * 18}%`);
              }}
              onPointerLeave={() => {
                rotateX.set(0);
                rotateY.set(0);
              }}
              style={{
                perspective: 1400,
                rotateX: reduceMotion ? 0 : rotateX,
                rotateY: reduceMotion ? 0 : rotateY,
              }}
              transition={{ duration: 0.5, ease: luxuryEase }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={room.name}
                  className="absolute inset-0"
                  initial={{
                    opacity: 0,
                    x: reduceMotion ? 0 : 18,
                    clipPath: "inset(0 0 0 18%)",
                    scale: reduceMotion ? 1 : 1.012,
                  }}
                  animate={{ opacity: 1, x: 0, clipPath: "inset(0 0 0 0%)", scale: 1 }}
                  exit={{
                    opacity: 0,
                    x: reduceMotion ? 0 : -14,
                    clipPath: "inset(0 16% 0 0)",
                    scale: reduceMotion ? 1 : 0.996,
                  }}
                  transition={{ duration: reduceMotion ? 0 : 0.82, ease: luxuryEase }}
                >
                  <Image
                    src={room.image}
                    alt={`${room.name} at Three Pyramids Boutique Hotel`}
                    fill
                    sizes="(max-width: 760px) 92vw, (max-width: 1024px) 86vw, 62vw"
                    className="object-cover"
                    style={{ objectPosition: room.position }}
                  />
                </motion.div>
              </AnimatePresence>
              <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(30,24,21,0.48),transparent_44%),linear-gradient(90deg,rgba(30,24,21,0.18),transparent_38%)]" />

              <div className="absolute bottom-4 left-4 right-4 flex items-end justify-end gap-5 sm:bottom-5 sm:left-5 sm:right-5 sm:justify-between">
                <div className="hidden max-w-[260px] border-l border-brass/42 pl-4 text-[0.58rem] font-extrabold uppercase tracking-[0.2em] text-ivory/62 sm:block">
                  Material plane / active room study
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label="Previous room"
                    className="min-h-11 px-3 text-[0.58rem] font-black uppercase tracking-[0.18em] text-ivory/70 transition-colors hover:text-brass"
                    onClick={() => go(-1)}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    aria-label="Next room"
                    className="min-h-11 px-3 text-[0.58rem] font-black uppercase tracking-[0.18em] text-brass transition-colors hover:text-ivory"
                    onClick={() => go(1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>

          <motion.aside
            ref={panelRef}
            className="reflective-surface room-info-panel relative z-20 grid content-between border border-brass/24 p-5 md:p-7 lg:-ml-16 lg:mt-14 lg:min-h-[520px] lg:border-l"
            variants={motionPrimitives.revealUp}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={room.name}
                initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
                transition={{ duration: reduceMotion ? 0 : 0.5, delay: reduceMotion ? 0 : 0.12, ease: luxuryEase }}
              >
                <p className="label text-brass">{String(active + 1).padStart(2, "0")} / Room</p>
                <h3 className="display mt-4 text-[clamp(1.7rem,7.2vw,2.15rem)] leading-[1.02] md:text-[clamp(1.75rem,2.55vw,2.45rem)]">
                  {room.name}
                </h3>
                <p className="mt-5 text-[0.94rem] leading-[1.7] text-ivory/72">
                  {room.description}
                </p>
                <div className="mt-7 border-y border-ivory/14 py-4">
                  <p className="label text-ivory/42">Room details</p>
                  <p className="mt-2 text-[0.8rem] leading-[1.6] text-ivory/62">
                    Sleeps {room.sleeps} &middot; {room.bedType}
                    {room.view ? <> &middot; {room.view}</> : null}
                  </p>
                </div>
                <Link href={`/rooms/${room.slug}`} className="text-link mt-6 text-brass">
                  Explore room -&gt;
                </Link>
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 grid gap-4">
              <div className="grid grid-cols-3 gap-3 lg:grid-cols-1" aria-label="Room index">
                {rooms.map((item, index) => {
                  const selected = active === index;

                  return (
                    <button
                      key={item.slug}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`Show ${item.name}`}
                      className={`group grid min-h-11 grid-cols-[2rem_1fr] items-center gap-2 text-left transition-colors lg:grid-cols-[2.4rem_1fr] lg:gap-3 ${
                        selected ? "text-brass" : "text-ivory/44 hover:text-ivory/78"
                      }`}
                      onClick={() => showRoom(index)}
                    >
                      <span className="text-[0.64rem] font-black tracking-[0.2em]">{String(index + 1).padStart(2, "0")}</span>
                      <span className="h-px overflow-hidden bg-ivory/16">
                        <span
                          className={`block h-px origin-left bg-brass transition-transform duration-500 ${
                            selected ? "scale-x-100" : "scale-x-0 group-hover:scale-x-50"
                          }`}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.aside>
        </div>
      </div>
    </motion.section>
  );
}
