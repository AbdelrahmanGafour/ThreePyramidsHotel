import type { Metadata } from "next";
import { RoomCatalogue } from "@/features/rooms/components/RoomCatalogue";
import { RoomsAvailabilityBar } from "@/features/rooms/components/RoomsAvailabilityBar";
import { RoomsHero } from "@/features/rooms/components/RoomsHero";
import { RoomsReservationBand } from "@/features/rooms/components/RoomsReservationBand";
import { rooms } from "@/features/rooms/data/roomsData";

export const metadata: Metadata = {
  title: "Rooms | Three Pyramids Boutique Hotel",
  description:
    "Explore the room concepts at Three Pyramids Boutique Hotel in Giza — private, material-led spaces composed around light and view.",
};

export default function RoomsPage() {
  return (
    <main id="main-content">
      <RoomsHero />
      <RoomsAvailabilityBar rooms={rooms} />
      <RoomCatalogue rooms={rooms} />
      <RoomsReservationBand
        copy={
          <>
            One quiet arrival, {rooms.length} rooms to choose from &mdash;{" "}
            <span className="serif-accent">ready when you are.</span>
          </>
        }
      />
    </main>
  );
}
