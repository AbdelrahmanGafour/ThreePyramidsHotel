import { PageOpening } from "@/shared/components/ui/PageOpening";
import { rooms } from "@/features/rooms/data/roomsData";

export function RoomsHero() {
  const prices = rooms.map((room) => room.priceFrom).filter((price): price is number => typeof price === "number");
  const lowest = prices.length ? Math.min(...prices) : null;

  return (
    <PageOpening
      eyebrow="Rooms"
      title="Our rooms"
      meta={
        <>
          {rooms.length} room types
          {lowest ? <> &middot; from ${lowest} per night</> : null}
        </>
      }
    >
      Browse our room types, compare the key details, and choose the stay that suits you.
    </PageOpening>
  );
}
