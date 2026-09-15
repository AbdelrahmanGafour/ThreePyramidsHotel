import Link from "next/link";
import type { Room } from "@/features/rooms/data/roomsData";

type RoomBreadcrumbProps = {
  room: Room;
};

export function RoomBreadcrumb({ room }: RoomBreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className="stone-section px-[var(--page-x)] pt-[clamp(1.5rem,3vw,2rem)]">
      <ol className="flex items-center gap-2.5 text-[0.6rem] font-black uppercase tracking-[0.16em] text-ink/52">
        <li>
          <Link href="/rooms" className="transition-colors hover:text-brass">
            Rooms
          </Link>
        </li>
        <li aria-hidden="true" className="text-ink/24">
          /
        </li>
        <li aria-current="page" className="text-brass/75">
          Collection {room.number}
        </li>
      </ol>
    </nav>
  );
}
