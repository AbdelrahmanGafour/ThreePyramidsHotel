import type { Metadata } from "next";
import { RoomCatalogue } from "@/features/rooms/components/RoomCatalogue";
import { RoomsAvailabilityBar } from "@/features/rooms/components/RoomsAvailabilityBar";
import { RoomsHero } from "@/features/rooms/components/RoomsHero";
import { RoomsReservationBand } from "@/features/rooms/components/RoomsReservationBand";
import { rooms } from "@/features/rooms/data/roomsData";

export const metadata: Metadata = {
  title: "Rooms | Three Pyramids Boutique Hotel",
  description:
    "Browse the room types at Three Pyramids Boutique Hotel in Giza, compare capacity, bed, size, view, and price, and reserve the one that suits you.",
};

export default function RoomsPage() {
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
