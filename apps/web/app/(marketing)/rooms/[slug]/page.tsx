import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RelatedRooms } from "@/features/rooms/components/RelatedRooms";
import { RoomAtAGlance } from "@/features/rooms/components/RoomAtAGlance";
import { RoomBeforeYouArrive } from "@/features/rooms/components/RoomBeforeYouArrive";
import { RoomBreadcrumb } from "@/features/rooms/components/RoomBreadcrumb";
import { RoomDetailOpening } from "@/features/rooms/components/RoomDetailOpening";
import { RoomExperience } from "@/features/rooms/components/RoomExperience";
import { RoomMobileBookingBar } from "@/features/rooms/components/RoomMobileBookingBar";
import { RoomsReservationBand } from "@/features/rooms/components/RoomsReservationBand";
import { getRoomBySlug, getRooms } from "@/features/rooms/api";
import { formatRoomRate } from "@/features/rooms/lib/money";

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
      <RoomAtAGlance room={room} />
      <RoomExperience room={room} />
      <RoomBeforeYouArrive />
      <RoomsReservationBand
        title={`Ready to book ${room.name}?`}
        text={`${formatRoomRate(room.baseNightlyRate, room.currency)} per night`}
        href={`/booking?room=${room.slug}`}
        actionLabel="Reserve this room"
        hideActionOnMobile
        hideSecondary
      />
      <RelatedRooms rooms={relatedRooms} />
      <RoomMobileBookingBar room={room} />
    </main>
  );
}
