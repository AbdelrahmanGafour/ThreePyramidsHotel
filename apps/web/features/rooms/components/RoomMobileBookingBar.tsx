import Link from "next/link";
import type { Room } from "@/features/rooms/data/roomsData";

// The desktop/tablet booking action lives inline in `RoomSummaryPanel`; this
// is its mobile equivalent, pinned to the screen so the primary action stays
// reachable while a guest reads through facts and amenities below.
export function RoomMobileBookingBar({ room }: { room: Room }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/15 bg-ivory shadow-[0_-8px_24px_rgba(30,24,21,0.08)] lg:hidden">
      <div className="flex items-center justify-between gap-4 px-[var(--page-x)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {room.priceFrom ? (
          <p className="text-[0.875rem] leading-tight text-ink/70">
            From
            <span className="block text-[1.25rem] font-bold text-ink">
              ${room.priceFrom}
              <span className="text-[0.875rem] font-normal text-ink/70"> per night</span>
            </span>
          </p>
        ) : (
          <p className="text-[0.9375rem] font-semibold text-ink">{room.name}</p>
        )}
        <Link href={`/booking?room=${room.slug}`} className="btn btn-primary shrink-0">
          Reserve this room
        </Link>
      </div>
    </div>
  );
}
