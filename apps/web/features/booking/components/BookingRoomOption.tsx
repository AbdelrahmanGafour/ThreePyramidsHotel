import Image from "next/image";
import Link from "next/link";
import { formatCurrency } from "@/features/booking/lib/pricing";
import type { Room } from "@/features/rooms/data/roomsData";

type BookingRoomOptionProps = {
  room: Room;
  selected: boolean;
  unavailableReason: string | null;
  onSelect: () => void;
};

// A scannable row, not another card grid — the room-selection step is about
// comparing a short list, not browsing. Carries the same elevation-mark and
// typographic-facts language as `RoomPlate` on the Rooms page.
export function BookingRoomOption({ room, selected, unavailableReason, onSelect }: BookingRoomOptionProps) {
  const facts = [
    room.sleeps ? `${room.sleeps} guests` : null,
    room.bedType ?? null,
    room.sizeSqm ? `${room.sizeSqm} m²` : null,
    room.view ?? null,
  ].filter((fact): fact is string => Boolean(fact));

  const unavailable = Boolean(unavailableReason);

  return (
    <div
      className={`grid gap-5 border-t border-ink/10 py-6 transition-opacity sm:grid-cols-[200px_1fr] sm:gap-7 ${
        unavailable ? "opacity-50" : ""
      }`}
    >
      <div className="image-frame relative aspect-[4/3] origin-center sm:aspect-[4/5]">
        <Image
          src={room.image}
          alt={room.imageAlt}
          fill
          sizes="(max-width: 640px) 92vw, 200px"
          className="object-cover"
          style={{ objectPosition: room.position }}
        />
        <span className="hero-plaque absolute left-3 top-3 px-2.5 py-1.5 text-[0.6rem] font-black uppercase tracking-[0.16em] text-brass">
          {room.number}
        </span>
      </div>

      <div className="flex flex-col">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="display flex items-center gap-3 text-[1.2rem] leading-[1.1] text-ink">
            {room.name}
            {selected ? (
              <span className="label rounded-none border border-brass/50 px-1.5 py-0.5 text-brass">Selected</span>
            ) : null}
          </h3>
          {room.priceFrom && !unavailable ? (
            <p className="shrink-0 whitespace-nowrap text-[0.78rem] font-bold text-ink/64">
              From <span className="text-ink/95">{formatCurrency(room.priceFrom)}</span>
              <span className="text-ink/48"> / night</span>
            </p>
          ) : null}
        </div>

        <p className="mt-2 text-[0.86rem] leading-[1.6] text-ink/64">{room.description}</p>

        {facts.length ? (
          <p className="mt-3 flex flex-wrap items-center text-[0.66rem] font-bold uppercase tracking-[0.08em] text-ink/56">
            {facts.map((fact, index) => (
              <span key={fact} className="flex items-center">
                {index > 0 ? <span aria-hidden="true" className="mx-2.5 h-3 w-px bg-ink/22" /> : null}
                {fact}
              </span>
            ))}
          </p>
        ) : null}

        {unavailableReason ? (
          <p role="status" className="mt-3 text-[0.78rem] text-terracotta">
            {unavailableReason}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 sm:mt-auto sm:pt-4">
          <Link href={`/rooms/${room.slug}`} className="text-link text-ink/68 hover:text-ink">
            Room details -&gt;
          </Link>
          <button
            type="button"
            onClick={onSelect}
            disabled={unavailable}
            aria-pressed={selected}
            className={
              selected && !unavailable
                ? "reservation-key-action min-h-11"
                : "brass-button min-h-11 disabled:cursor-not-allowed disabled:opacity-40"
            }
          >
            {unavailable ? "Not available" : selected ? "Change room" : "Select this room"}
          </button>
        </div>
      </div>
    </div>
  );
}
