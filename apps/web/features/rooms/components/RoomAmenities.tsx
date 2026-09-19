import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { Room } from "@/features/rooms/data/roomsData";

// Renders nothing while amenities are unconfirmed — no invented features.
export function RoomAmenities({ room }: { room: Room }) {
  if (!room.amenities?.length) return null;

  return (
    <InfoSection title="Amenities">
      <ul className="grid gap-x-8 sm:grid-cols-2">
        {room.amenities.map((amenity, index) => (
          <li
            key={amenity}
            className={`flex items-start gap-3 border-t border-ink/12 py-3 text-[1rem] text-ink/85 ${
              index === 0 ? "border-t-0 pt-0" : ""
            } ${index === 1 ? "sm:border-t-0 sm:pt-0" : ""}`}
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="mt-1 shrink-0 text-[var(--brass-ink)]"
            >
              <path d="m3 8.5 3.2 3L13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {amenity}
          </li>
        ))}
      </ul>
    </InfoSection>
  );
}
