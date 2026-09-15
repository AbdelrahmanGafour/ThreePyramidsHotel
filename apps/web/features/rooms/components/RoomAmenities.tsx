import type { Room } from "@/features/rooms/data/roomsData";

type RoomAmenitiesProps = {
  room: Room;
};

// Renders nothing while amenities are unconfirmed — no invented icons
// standing in for features the room may not actually have.
export function RoomAmenities({ room }: RoomAmenitiesProps) {
  if (!room.amenities?.length) return null;

  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(2.25rem,4vw,3rem)] text-ink">
      <div className="page-grid">
        <div className="col-span-9 col-start-2 max-md:col-span-full">
          <h2 className="label text-aged-gold">In the room</h2>
          <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {room.amenities.map((amenity) => (
              <li
                key={amenity}
                className="flex items-center gap-3 border-t border-ink/10 py-3 pr-6 text-[0.86rem] text-ink/76 first:border-t-0"
              >
                <span aria-hidden="true" className="h-1 w-1 shrink-0 rotate-45 bg-brass" />
                {amenity}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
