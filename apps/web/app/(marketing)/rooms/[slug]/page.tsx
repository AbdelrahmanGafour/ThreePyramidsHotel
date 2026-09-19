import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RelatedRooms } from "@/features/rooms/components/RelatedRooms";
import { RoomAmenities } from "@/features/rooms/components/RoomAmenities";
import { RoomBreadcrumb } from "@/features/rooms/components/RoomBreadcrumb";
import { RoomDetailOpening } from "@/features/rooms/components/RoomDetailOpening";
import { RoomFacts } from "@/features/rooms/components/RoomFacts";
import { RoomMobileBookingBar } from "@/features/rooms/components/RoomMobileBookingBar";
import { RoomStayDetails } from "@/features/rooms/components/RoomStayDetails";
import { RoomsReservationBand } from "@/features/rooms/components/RoomsReservationBand";
import { RoomStory } from "@/features/rooms/components/RoomStory";
import { rooms } from "@/features/rooms/data/roomsData";

type RoomDetailPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return rooms.map((room) => ({ slug: room.slug }));
}

export async function generateMetadata({ params }: RoomDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const room = rooms.find((item) => item.slug === slug);
  if (!room) return {};

  return {
    title: `${room.name} | Three Pyramids Boutique Hotel`,
    description: room.description,
  };
}

export default async function RoomDetailPage({ params }: RoomDetailPageProps) {
  const { slug } = await params;
  const room = rooms.find((item) => item.slug === slug);
  if (!room) notFound();

  const relatedRooms = rooms.filter((item) => item.slug !== slug);

  return (
    <main id="main-content" className="pb-24 lg:pb-0">
      <RoomBreadcrumb room={room} />
      <RoomDetailOpening room={room} />
      <RoomFacts room={room} />
      <RoomAmenities room={room} />
      <RoomStory room={room} />
      <RoomStayDetails />
      <RelatedRooms rooms={relatedRooms} />
      <RoomsReservationBand
        title={`Reserve ${room.name}`}
        text="Choose your dates and guests to continue. You can review everything before you confirm."
        href={`/booking?room=${room.slug}`}
        actionLabel="Reserve this room"
        hideActionOnMobile
      />
      <RoomMobileBookingBar room={room} />
    </main>
  );
}
