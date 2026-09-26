import type { Metadata } from "next";
import { RoomCatalogue } from "@/features/rooms/components/RoomCatalogue";
import { RoomsAvailabilityBar } from "@/features/rooms/components/RoomsAvailabilityBar";
import { RoomsHero } from "@/features/rooms/components/RoomsHero";
import { RoomsReservationBand } from "@/features/rooms/components/RoomsReservationBand";
import { getRooms } from "@/features/rooms/api";

// Room data is live and must never be served from a cached snapshot, and
// must not require the backend to be reachable at `next build` time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rooms | Three Pyramids Boutique Hotel",
  description:
    "Browse the room types at Three Pyramids Boutique Hotel in Giza, compare capacity, bed, size, view, and price, and reserve the one that suits you.",
};

export default async function RoomsPage() {
  let rooms;
  try {
    rooms = await getRooms();
  } catch {
    // An upstream/transport failure — never fabricated room data.
    return (
      <main id="main-content" className="px-[var(--page-x)] py-[clamp(3.5rem,9vw,5.5rem)] text-center">
        <h1 className="section-title">Rooms are temporarily unavailable</h1>
        <p className="prose-body mx-auto mt-3 max-w-[42ch]">
          Please try again shortly, or contact the hotel directly.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content">
      <RoomsHero />
      <RoomsAvailabilityBar />
      <RoomCatalogue rooms={rooms} />
      <RoomsReservationBand
        title="Ready to choose your dates?"
        text={`Pick your dates and guests, then choose from our ${rooms.length} room types. Have a question first? The hotel is happy to help.`}
      />
    </main>
  );
}
