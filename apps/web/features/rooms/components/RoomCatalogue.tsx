"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { RoomPlate } from "@/features/rooms/components/RoomPlate";
import { getRoomCategories, type Room } from "@/features/rooms/data/roomsData";

type RoomCatalogueProps = {
  rooms: Room[];
};

const INITIAL_VISIBLE = 12;

// The collection's visual rhythm is a pure function of position, never of
// data — so a "wider" plate is a layout choice, not a claim that the room in
// that slot is special. The opening slot, then every 7th slot after it, gets
// the wider treatment; this repeats identically whether the roster holds 3
// rooms or 30.
function isWideSlot(index: number) {
  return index === 0 || (index > 0 && (index - 3) % 7 === 0);
}

// One grid, one card, at any roster size — no per-index layout branching.
// A category filter only appears once the data actually has more than one
// category, and rooms past the first page sit behind a plain reveal control
// instead of loading every image up front.
export function RoomCatalogue({ rooms }: RoomCatalogueProps) {
  const categories = useMemo(() => getRoomCategories(rooms), [rooms]);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [revealedAll, setRevealedAll] = useState(false);

  const filteredRooms = activeCategory ? rooms.filter((room) => room.category === activeCategory) : rooms;
  const visibleRooms = revealedAll ? filteredRooms : filteredRooms.slice(0, INITIAL_VISIBLE);
  const hasMore = filteredRooms.length > visibleRooms.length;

  return (
    <div>
      {categories.length ? (
        <nav
          aria-label="Filter rooms by category"
          className="sticky top-14 z-10 border-y border-ink/8 bg-ivory/92 backdrop-blur-sm min-[1180px]:top-16"
        >
          <div className="page-grid">
            <ul className="col-span-10 col-start-2 flex items-stretch gap-1 overflow-x-auto max-md:col-span-full">
              <li>
                <button
                  type="button"
                  onClick={() => setActiveCategory(null)}
                  aria-pressed={activeCategory === null}
                  className={`group relative flex min-h-12 items-center whitespace-nowrap px-4 text-[0.6rem] font-black uppercase tracking-[0.16em] transition-colors ${
                    activeCategory === null ? "text-brass" : "text-ink/48 hover:text-ink"
                  }`}
                >
                  All rooms
                  <span
                    className={`absolute inset-x-4 bottom-2 h-px origin-center bg-brass transition-transform duration-500 ${
                      activeCategory === null ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                    }`}
                  />
                </button>
              </li>
              {categories.map((category) => (
                <li key={category}>
                  <button
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    aria-pressed={activeCategory === category}
                    className={`group relative flex min-h-12 items-center whitespace-nowrap px-4 text-[0.6rem] font-black uppercase tracking-[0.16em] transition-colors ${
                      activeCategory === category ? "text-brass" : "text-ink/48 hover:text-ink"
                    }`}
                  >
                    {category}
                    <span
                      className={`absolute inset-x-4 bottom-2 h-px origin-center bg-brass transition-transform duration-500 ${
                        activeCategory === category ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      ) : null}

      <motion.div
        className="px-[var(--page-x)] pb-[clamp(1.75rem,3vw,2.25rem)] pt-[clamp(2rem,3.5vw,2.75rem)]"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-10% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-x-6 gap-y-12 sm:grid-cols-[repeat(auto-fill,minmax(360px,1fr))]">
          {visibleRooms.map((room, index) => {
            const wide = isWideSlot(index);
            return (
              <div key={room.slug} className={wide ? "sm:col-span-2" : undefined}>
                <RoomPlate room={room} layout={wide ? "landscape" : "portrait"} priority={index === 0} />
              </div>
            );
          })}
        </div>

        {hasMore ? (
          <div className="mt-10 flex justify-center">
            <button type="button" className="text-link text-ink" onClick={() => setRevealedAll(true)}>
              Reveal more rooms -&gt;
            </button>
          </div>
        ) : null}

        {!filteredRooms.length ? (
          <p className="text-[0.9rem] text-ink/58">No rooms in this category yet.</p>
        ) : null}
      </motion.div>
    </div>
  );
}
