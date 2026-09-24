import { PageOpening } from "@/shared/components/ui/PageOpening";
import { formatRoomRate } from "@/features/rooms/lib/money";
import type { RoomWithPresentation } from "@/features/rooms/api";

type RoomsHeroProps = {
  rooms: RoomWithPresentation[];
};

// Picks the room with the lowest rate purely to choose WHICH room's own
// unmodified rate string to display — the comparison uses a transient
// numeric read of each rate, but the displayed value is always that room's
// original backend string via `formatRoomRate`, never a recomputed number.
function findLowestRatedRoom(rooms: RoomWithPresentation[]): RoomWithPresentation | null {
  return rooms.reduce<RoomWithPresentation | null>((lowest, room) => {
    if (!lowest) return room;
    return Number(room.baseNightlyRate) < Number(lowest.baseNightlyRate) ? room : lowest;
  }, null);
}

export function RoomsHero({ rooms }: RoomsHeroProps) {
  const lowestRatedRoom = findLowestRatedRoom(rooms);

  return (
    <PageOpening
      eyebrow="Rooms"
      title="Our rooms"
      meta={
        <>
          {rooms.length} room types
          {lowestRatedRoom ? (
            <> &middot; from {formatRoomRate(lowestRatedRoom.baseNightlyRate, lowestRatedRoom.currency)} per night</>
          ) : null}
        </>
      }
    >
      Browse our room types, compare the key details, and choose the stay that suits you.
    </PageOpening>
  );
}
