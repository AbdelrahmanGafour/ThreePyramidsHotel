import { RoomPlate } from "@/features/rooms/components/RoomPlate";
import type { Room } from "@/features/rooms/data/roomsData";

// A horizontal scroller rather than a fixed grid, so this reads the same
// whether there are 2 other rooms or 19 of them.
export function RelatedRooms({ rooms }: { rooms: Room[] }) {
  if (!rooms.length) return null;

  return (
    <section
      aria-labelledby="related-rooms-title"
      className="border-t border-ink/12 bg-ivory py-[clamp(2.5rem,4.5vw,3.5rem)] text-ink"
    >
      <div className="page-grid">
        <h2 id="related-rooms-title" className="section-title col-span-10 col-start-2 max-md:col-span-full">
          You may also like
        </h2>
      </div>

      <div className="mt-6 flex snap-x snap-mandatory gap-6 overflow-x-auto px-[var(--page-x)] pb-2">
        {rooms.map((room) => (
          <div key={room.slug} className="w-[280px] shrink-0 snap-start sm:w-[320px]">
            <RoomPlate room={room} compact />
          </div>
        ))}
      </div>
    </section>
  );
}
