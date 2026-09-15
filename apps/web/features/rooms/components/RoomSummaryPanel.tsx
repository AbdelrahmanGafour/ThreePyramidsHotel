import Link from "next/link";
import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import type { Room } from "@/features/rooms/data/roomsData";

type RoomSummaryPanelProps = {
  room: Room;
};

// The fast path: everything a guest needs to decide, condensed into one
// column beside the gallery. Deeper detail (the full facts rail, amenities,
// policies) follows further down the page for anyone still reading. Reveals
// in sequence — title, then facts, then price and the booking action — so
// the panel reads in the order a guest actually decides.
export function RoomSummaryPanel({ room }: RoomSummaryPanelProps) {
  const quickFacts = [
    room.sleeps ? `${room.sleeps} guests` : null,
    room.bedType ?? null,
    room.sizeSqm ? `${room.sizeSqm} m²` : null,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <div className="mt-6 lg:mt-0">
      <motion.p
        className="label text-aged-gold"
        variants={motionPrimitives.precisionDetail}
        transition={{ duration: 0.4, ease: luxuryEase }}
      >
        {room.category ?? "Rooms"} <span className="text-ink/28">/</span> Collection {room.number}
      </motion.p>

      <motion.h1
        className="display mt-3 text-balance text-[clamp(1.9rem,5vw,2.3rem)] leading-[1.06]"
        variants={motionPrimitives.editorialText}
        transition={{ duration: 0.62, delay: 0.08, ease: luxuryEase }}
      >
        {room.name}
      </motion.h1>

      <motion.p
        className="mt-4 text-[0.92rem] leading-[1.7] text-ink/68"
        variants={motionPrimitives.revealUp}
        transition={{ duration: 0.5, delay: 0.18, ease: luxuryEase }}
      >
        {room.description}
      </motion.p>

      {quickFacts.length ? (
        <motion.p
          className="mt-5 flex flex-wrap items-center border-t border-ink/12 pt-4 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink/62"
          variants={motionPrimitives.precisionDetail}
          transition={{ duration: 0.4, delay: 0.28, ease: luxuryEase }}
        >
          {quickFacts.map((fact, index) => (
            <span key={fact} className="flex items-center">
              {index > 0 ? <span aria-hidden="true" className="mx-3 h-3 w-px bg-ink/22" /> : null}
              {fact}
            </span>
          ))}
        </motion.p>
      ) : null}

      {room.priceFrom ? (
        <motion.p
          className="display mt-6 text-[1.85rem] leading-none text-ink"
          variants={motionPrimitives.revealUp}
          transition={{ duration: 0.5, delay: 0.36, ease: luxuryEase }}
        >
          From ${room.priceFrom}
          <span className="ml-1.5 text-[0.62rem] font-sans font-bold uppercase tracking-[0.14em] text-ink/52">
            / night
          </span>
        </motion.p>
      ) : null}

      <motion.div
        variants={motionPrimitives.precisionDetail}
        transition={{ duration: 0.4, delay: 0.44, ease: luxuryEase }}
      >
        <Link href={`/booking?room=${room.slug}`} className="reservation-key-action mt-6 w-full sm:w-auto">
          Check availability -&gt;
        </Link>
      </motion.div>
    </div>
  );
}
