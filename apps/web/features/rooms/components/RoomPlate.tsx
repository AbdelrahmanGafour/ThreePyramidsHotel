import Image from "next/image";
import Link from "next/link";
import { RoomFactList } from "@/features/rooms/components/RoomFactList";
import type { Room } from "@/features/rooms/data/roomsData";

type RoomPlateProps = {
  room: Room;
  /** Trimmed treatment for the "You may also like" scroller. */
  compact?: boolean;
  priority?: boolean;
};

// The one card every room uses, at one consistent proportion, so rooms are
// easy to compare: image, name, price, the four key facts, then two clearly
// different actions — "View room" (secondary) and "Reserve" (primary).
export function RoomPlate({ room, compact, priority }: RoomPlateProps) {
  return (
    <article className="group flex h-full flex-col">
      <Link href={`/rooms/${room.slug}`} className="inner-focus block" tabIndex={-1} aria-hidden="true">
        <div className="image-frame relative aspect-[4/3]">
          <Image
            src={room.image}
            alt=""
            fill
            priority={priority}
            sizes={
              compact
                ? "(max-width: 760px) 72vw, 30vw"
                : "(max-width: 760px) 92vw, (max-width: 1280px) 44vw, 30vw"
            }
            className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.02]"
            style={{ objectPosition: room.position }}
          />
        </div>
      </Link>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="display text-[1.35rem] leading-[1.15]">
          <Link href={`/rooms/${room.slug}`} className="inner-focus transition-colors hover:text-[var(--brass-ink)]">
            {room.name}
          </Link>
        </h3>
        {room.priceFrom ? (
          <p className="text-[0.9375rem] text-ink/75">
            From <span className="text-[1.125rem] font-bold text-ink">${room.priceFrom}</span> per night
          </p>
        ) : null}
      </div>

      {!compact ? <p className="mt-2 line-clamp-2 text-[0.9375rem] leading-[1.6] text-ink/75">{room.description}</p> : null}

      <RoomFactList room={room} className="mt-4 border-t border-ink/12 pt-4" />

      <div className={`mt-auto grid gap-3 pt-5 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
        <Link href={`/rooms/${room.slug}`} className="btn btn-secondary" aria-label={`View room: ${room.name}`}>
          View room
        </Link>
        {!compact ? (
          <Link href={`/booking?room=${room.slug}`} className="btn btn-primary" aria-label={`Reserve ${room.name}`}>
            Reserve
          </Link>
        ) : null}
      </div>
    </article>
  );
}
