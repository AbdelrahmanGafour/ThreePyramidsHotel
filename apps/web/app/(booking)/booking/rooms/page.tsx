import { BookingEmptyState } from "@/features/booking/components/BookingEmptyState";
import { RoomSelection } from "@/features/booking/components/RoomSelection";
import { getRooms } from "@/features/rooms/api";

// Room data is live and must never be served from a cached snapshot, and
// must not require the backend to be reachable at `next build` time.
export const dynamic = "force-dynamic";

export default async function BookingRoomsPage() {
  let rooms;

  try {
    rooms = await getRooms();
  } catch {
    // An upstream/transport failure — never fabricated room data. JSX is
    // deliberately not constructed inside this try block: React defers
    // rendering, so a component's own render errors would never actually be
    // caught here anyway.
    return (
      <BookingEmptyState
        title="Rooms are temporarily unavailable"
        message="Please try again shortly, or contact the hotel directly."
        actionLabel="Back to dates"
        actionHref="/booking"
      />
    );
  }

  return <RoomSelection rooms={rooms} />;
}
