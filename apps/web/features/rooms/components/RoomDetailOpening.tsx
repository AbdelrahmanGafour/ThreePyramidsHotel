import { RoomGallery } from "@/features/rooms/components/RoomGallery";
import { RoomSummaryPanel } from "@/features/rooms/components/RoomSummaryPanel";
import type { Room } from "@/features/rooms/data/roomsData";

type RoomDetailOpeningProps = {
  room: Room;
};

// Photo beside the room's identity, key facts, price, and one booking action,
// so a guest can answer "what is it, what does it offer, how much, can I book
// it?" without scrolling. Sits in the same column as the rest of the page.
export function RoomDetailOpening({ room }: RoomDetailOpeningProps) {
  return (
    <section className="stone-section pb-[clamp(1.75rem,3vw,2.5rem)] pt-[clamp(0.25rem,1vw,0.75rem)] text-ink">
      <div className="page-grid">
        <div className="col-span-10 col-start-2 max-md:col-span-full lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-10">
          <RoomGallery room={room} />
          <RoomSummaryPanel room={room} />
        </div>
      </div>
    </section>
  );
}
