import Link from "next/link";
import type { Room } from "@/features/rooms/data/roomsData";

type RoomMobileBookingBarProps = {
  room: Room;
};

// The desktop/tablet booking action lives inline in `RoomSummaryPanel`; this
// is its mobile equivalent, pinned to the screen so the primary action stays
// reachable while a guest reads through facts and amenities below.
export function RoomMobileBookingBar({ room }: RoomMobileBookingBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <div className="reservation-rail flex items-center justify-between gap-4 px-[var(--page-x)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-ivory">
        {room.priceFrom ? (
          <p className="text-[0.86rem]">
            From <span className="font-bold text-ivory">${room.priceFrom}</span>
            <span className="text-ivory/50"> / night</span>
          </p>
        ) : (
          <p className="text-[0.86rem] text-ivory/80">{room.name}</p>
        )}
        <Link href={`/booking?room=${room.slug}`} className="brass-button min-h-11">
          Check availability
        </Link>
      </div>
    </div>
  );
}
