"use client";

import { useMemo, useState } from "react";
import { RoomPlate } from "@/features/rooms/components/RoomPlate";
import { getRoomCategories } from "@/features/rooms/data/roomsData";
import type { RoomWithPresentation } from "@/features/rooms/api";

type RoomCatalogueProps = {
  rooms: RoomWithPresentation[];
};

const INITIAL_VISIBLE = 12;

// One grid, one card, at any roster size — every room sits at the same
// proportion so the collection stays predictable to compare. A category
// filter only appears once the data has more than one category, and rooms
// past the first page sit behind a plain "Show more rooms" button.
export function RoomCatalogue({ rooms }: RoomCatalogueProps) {
  const categories = useMemo(() => getRoomCategories(rooms), [rooms]);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [revealedAll, setRevealedAll] = useState(false);

  const filteredRooms = activeCategory ? rooms.filter((room) => room.category === activeCategory) : rooms;
  const visibleRooms = revealedAll ? filteredRooms : filteredRooms.slice(0, INITIAL_VISIBLE);
  const hasMore = filteredRooms.length > visibleRooms.length;

  const filterClass = (active: boolean) =>
    `inner-focus inline-flex min-h-11 items-center whitespace-nowrap border px-4 text-[0.9375rem] font-semibold transition-colors ${
      active ? "border-ink bg-ink text-ivory" : "border-ink/35 bg-transparent text-ink hover:border-ink"
    }`;

  return (
    <section aria-labelledby="room-list-title" className="bg-ivory pb-[clamp(2.5rem,4vw,3.5rem)]">
      <div className="page-grid">
        <div className="col-span-10 col-start-2 max-md:col-span-full">
          <h2 id="room-list-title" className="group-title">
            Choose a room type
          </h2>

          {categories.length ? (
            <nav aria-label="Filter rooms by category" className="mt-4">
              <ul className="flex gap-2 overflow-x-auto pb-1">
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveCategory(null)}
                    aria-pressed={activeCategory === null}
                    className={filterClass(activeCategory === null)}
                  >
                    All rooms
                  </button>
                </li>
                {categories.map((category) => (
                  <li key={category}>
                    <button
                      type="button"
                      onClick={() => setActiveCategory(category)}
                      aria-pressed={activeCategory === category}
                      className={filterClass(activeCategory === category)}
                    >
                      {category}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-x-6 gap-y-12">
            {visibleRooms.map((room, index) => (
              <RoomPlate key={room.slug} room={room} priority={index === 0} />
            ))}
          </div>

          {hasMore ? (
            <div className="mt-10 flex justify-center">
              <button type="button" className="btn btn-secondary" onClick={() => setRevealedAll(true)}>
                Show more rooms
              </button>
            </div>
          ) : null}

          {!filteredRooms.length ? (
            <p className="prose-body">
              No rooms in this category yet. Choose &ldquo;All rooms&rdquo; to see every room type.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
