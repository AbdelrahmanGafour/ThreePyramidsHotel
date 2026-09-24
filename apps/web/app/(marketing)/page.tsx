import { BookingStrip } from "@/features/home/components/BookingStrip";
import { ExperiencesSection } from "@/features/home/components/ExperiencesSection";
import { FinalReservation } from "@/features/home/components/FinalReservation";
import { GallerySection } from "@/features/home/components/GallerySection";
import { GizaMoment } from "@/features/home/components/GizaMoment";
import { GuestReputation } from "@/features/home/components/GuestReputation";
import { Hero } from "@/features/home/components/Hero";
import { LocationSection } from "@/features/home/components/LocationSection";
import { RoomsSection } from "@/features/home/components/RoomsSection";
import { RooftopSection } from "@/features/home/components/RooftopSection";
import { StorySection } from "@/features/home/components/StorySection";
import { getRooms } from "@/features/rooms/api";

// The room teaser below needs live room data; the rest of the homepage does
// not depend on the backend at all.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Secondary content only: if the room teaser can't load, the rest of the
  // homepage still renders — no fabricated rooms are shown in its place.
  const rooms = await getRooms().catch(() => []);

  return (
    <main id="main-content">
      <Hero />
      <BookingStrip />
      <StorySection />
      {rooms.length > 0 ? <RoomsSection rooms={rooms} /> : null}
      <GizaMoment />
      <RooftopSection />
      <ExperiencesSection />
      <GuestReputation />
      <GallerySection />
      <LocationSection />
      <FinalReservation />
    </main>
  );
}
