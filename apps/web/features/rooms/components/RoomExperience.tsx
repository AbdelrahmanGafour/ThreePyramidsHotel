import type { RoomWithPresentation } from "@/features/rooms/api";

function CheckIcon() {
  return (
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
  );
}

// "About this room" and "Amenities" share one warm-ivory base, divided by a
// narrow warm-brown hairline — not a hard split-screen block. Amenities gets
// a very subtle sand tint of its own so the two sides stay noticeably
// distinct without becoming two competing background colors.
export function RoomExperience({ room }: { room: RoomWithPresentation }) {
  const hasStory = Boolean(room.story);
  const hasAmenities = Boolean(room.amenities?.length);
  if (!hasStory && !hasAmenities) return null;

  const both = hasStory && hasAmenities;

  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(2.25rem,4vw,3rem)] text-ink">
      <div className="page-grid">
        <div
          className={`col-span-10 col-start-2 grid gap-x-10 gap-y-8 max-md:col-span-full ${
            both ? "sm:grid-cols-[1.3fr_1fr] sm:divide-x sm:divide-[var(--clay)]/25" : ""
          }`}
        >
          {hasStory ? (
            <div className={both ? "sm:pr-10" : ""}>
              <p className="section-title text-[1.875rem]!">About this room</p>
              <p className="prose-body mt-4 max-w-[60ch] text-[1.0625rem]">{room.story}</p>
            </div>
          ) : null}

          {hasAmenities ? (
            <div className={both ? "sm:bg-sand/12 sm:pl-10" : ""}>
              <p className="section-title text-[1.875rem]!">Amenities</p>
              <ul className="mt-4 grid gap-3">
                {room.amenities!.map((amenity) => (
                  <li key={amenity} className="flex items-start gap-3 text-[1rem] text-ink/85">
                    <CheckIcon />
                    {amenity}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
