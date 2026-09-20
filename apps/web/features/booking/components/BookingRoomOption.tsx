import Image from "next/image";
import Link from "next/link";
import { RoomFactList } from "@/features/rooms/components/RoomFactList";
import { formatRoomRate } from "@/features/rooms/lib/money";
import type { AvailabilityRoomType } from "@/features/booking/lib/availability";
import type { RoomWithPresentation } from "@/features/rooms/api";

type BookingRoomOptionProps = {
  room: RoomWithPresentation;
  /** The live backend availability match for this room's slug, or null when unavailable/not yet searched. */
  availability: AvailabilityRoomType | null;
  nights: number;
  selected: boolean;
  unavailableReason: string | null;
  onSelect: () => void;
};

// A scannable row for comparing a short list. The selected room is
// unmistakable — heavier brass border, tinted surface, and a "Selected"
// badge with a tick — and an unavailable room says plainly why, in text,
// without dimming the whole row into illegibility.
export function BookingRoomOption({
  room,
  availability,
  nights,
  selected,
  unavailableReason,
  onSelect,
}: BookingRoomOptionProps) {
  const unavailable = Boolean(unavailableReason);
  const isSelected = selected && !unavailable;

  return (
    <li
      className={`mt-4 grid gap-5 border p-4 transition-colors sm:grid-cols-[200px_1fr] sm:gap-6 sm:p-5 ${
        isSelected
          ? "border-2 border-aged-gold bg-[#f6ecd9] p-[calc(1rem-1px)] sm:p-[calc(1.25rem-1px)]"
          : "border-ink/25 bg-[var(--panel-surface)]"
      }`}
    >
      <div className={`image-frame relative aspect-[4/3] sm:aspect-[4/5] ${unavailable ? "opacity-60 grayscale" : ""}`}>
        <Image
          src={room.image}
          alt={room.imageAlt}
          fill
          sizes="(max-width: 640px) 92vw, 200px"
          className="object-cover"
          style={{ objectPosition: room.position }}
        />
      </div>

      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="display text-[1.35rem] leading-[1.15] text-ink">{room.name}</h3>
          {isSelected ? (
            <span className="inline-flex items-center gap-1.5 bg-ink px-2.5 py-1 text-[0.8125rem] font-semibold text-ivory">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="m3 8.5 3.2 3L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Selected
            </span>
          ) : null}
        </div>

        {!unavailable && availability ? (
          <p className="mt-2 text-[0.9375rem] text-ink/75">
            <span className="text-[1.125rem] font-bold text-ink">
              {formatRoomRate(availability.baseNightlyRate, availability.currency)}
            </span>{" "}
            per night
            {nights > 0 ? (
              <>
                {" "}
                &middot;{" "}
                <span className="font-semibold text-ink">
                  {formatRoomRate(availability.totalAmount, availability.currency)}
                </span>{" "}
                total for {nights} night{nights === 1 ? "" : "s"}
              </>
            ) : null}
          </p>
        ) : null}

        <p className="mt-2 text-[0.9375rem] leading-[1.6] text-ink/75">{room.description}</p>

        <RoomFactList room={room} className="mt-4" />

        {unavailableReason ? (
          <p role="status" className="mt-4 flex items-start gap-2 border border-[var(--danger)]/40 bg-[var(--danger)]/[0.06] px-3 py-2.5 text-[0.9375rem] font-semibold text-[var(--danger)]">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-[3px] shrink-0">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4.5v4.2M8 10.9v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>Can&apos;t be selected: {unavailableReason}</span>
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-3 sm:mt-auto sm:flex-row sm:items-center sm:gap-5 sm:pt-4">
          <button
            type="button"
            onClick={onSelect}
            disabled={unavailable}
            aria-pressed={isSelected}
            className={`btn w-full sm:w-auto ${isSelected ? "btn-secondary" : "btn-primary"}`}
          >
            {unavailable ? "Not available" : isSelected ? "Selected" : "Select this room"}
          </button>
          <Link href={`/rooms/${room.slug}`} className="btn-link justify-center sm:justify-start">
            View room details
          </Link>
        </div>
      </div>
    </li>
  );
}
