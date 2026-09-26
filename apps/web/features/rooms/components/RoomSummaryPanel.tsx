import Link from "next/link";
import { formatRoomRate } from "@/features/rooms/lib/money";
import type { RoomWithPresentation } from "@/features/rooms/api";

type RoomSummaryPanelProps = {
  room: RoomWithPresentation;
};

// The fast path: name, one-line summary, price, and the one primary action,
// condensed beside the gallery — nothing else. Sleeps/bed/size/view live in
// their own explicitly-labelled "Room details" section right below this
// opening, never inline here too: one obvious place for facts, not a preview
// copy plus the real thing.
export function RoomSummaryPanel({ room }: RoomSummaryPanelProps) {
  return (
    <div className="mt-6 lg:mt-0">
      <p className="eyebrow">{room.category ?? "Room"}</p>

      <h1 className="page-title mt-2 text-[clamp(1.9rem,3.2vw,2.4rem)]!">{room.name}</h1>

      <p className="prose-body mt-3">{room.shortDescription ?? room.description}</p>

      <div className="mt-6 border-t border-ink/12 pt-5">
        <p className="text-[0.875rem] text-ink/68">Starting price</p>
        <p className="mt-1">
          <span className="display text-[2rem] leading-none">
            {formatRoomRate(room.baseNightlyRate, room.currency)}
          </span>
          <span className="ml-2 text-[0.9375rem] text-ink/75">per night</span>
        </p>
      </div>

      <Link href={`/booking?room=${room.slug}`} className="btn btn-primary mt-5 w-full">
        Reserve this room
      </Link>
      <p className="fine-print mt-2 text-center">Next: choose your dates and guests. Nothing is charged online.</p>
    </div>
  );
}
