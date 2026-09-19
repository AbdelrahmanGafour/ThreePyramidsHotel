import Link from "next/link";
import { RoomFactList } from "@/features/rooms/components/RoomFactList";
import type { Room } from "@/features/rooms/data/roomsData";

type RoomSummaryPanelProps = {
  room: Room;
};

// The fast path: name, one-line description, key facts, price, and the one
// primary action, condensed beside the gallery. Deeper detail follows below.
export function RoomSummaryPanel({ room }: RoomSummaryPanelProps) {
  return (
    <div className="mt-6 lg:mt-0">
      <p className="eyebrow">{room.category ?? "Room"}</p>

      <h1 className="page-title mt-2 text-[clamp(1.9rem,3.2vw,2.4rem)]!">{room.name}</h1>

      <p className="prose-body mt-3">{room.description}</p>

      <RoomFactList room={room} className="mt-5 border-t border-ink/12 pt-5" />

      {room.priceFrom ? (
        <div className="mt-6 border-t border-ink/12 pt-5">
          <p className="text-[0.875rem] text-ink/68">Starting price</p>
          <p className="mt-1">
            <span className="display text-[2rem] leading-none">${room.priceFrom}</span>
            <span className="ml-2 text-[0.9375rem] text-ink/75">per night</span>
          </p>
        </div>
      ) : null}

      <Link href={`/booking?room=${room.slug}`} className="btn btn-primary mt-5 w-full">
        Reserve this room
      </Link>
      <p className="fine-print mt-2 text-center">Next: choose your dates and guests. Nothing is charged online.</p>
    </div>
  );
}
