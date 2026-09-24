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
import { getRoomBySlug, getRooms } from "@/features/rooms/api";

type RoomDetailPageProps = {
  params: Promise<{ slug: string }>;
};

// No generateStaticParams: the canonical set of rooms is backend-owned and
// can change without a redeploy, and this route must not require the
// backend to be reachable at `next build` time. Rendered dynamically instead
// (approved WFI-T03 direction) — `getRoomBySlug` already fetches with
// `cache: "no-store"`.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: RoomDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const room = await getRoomBySlug(slug).catch(() => null);
  if (!room) return {};

  return {
    title: `${room.name} | Three Pyramids Boutique Hotel`,
    description: room.description ?? undefined,
  };
}

export default async function RoomDetailPage({ params }: RoomDetailPageProps) {
  const { slug } = await params;

  // A real ROOM_NOT_FOUND -> the real Next.js 404. An upstream/transport
  // failure is a different situation entirely and is deliberately NOT
  // caught here, so it surfaces as a genuine error rather than a
  // misleading 404 or fabricated room data.
  const room = await getRoomBySlug(slug);
  if (!room) notFound();

  // Secondary content only: if fetching the related-rooms list fails, the
  // room the guest actually navigated to should still render.
  const relatedRooms = await getRooms()
    .then((allRooms) => allRooms.filter((item) => item.slug !== slug))
    .catch(() => []);

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
