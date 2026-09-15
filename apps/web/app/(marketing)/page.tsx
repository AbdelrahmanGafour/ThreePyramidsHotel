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

export default function Home() {
  return (
    <main id="main-content">
      <Hero />
      <BookingStrip />
      <StorySection />
      <RoomsSection />
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
