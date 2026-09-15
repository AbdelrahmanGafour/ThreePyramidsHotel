import Image from "next/image";
import Link from "next/link";
import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import type { Room } from "@/features/rooms/data/roomsData";

type RoomPlateProps = {
  room: Room;
  /** Grid rhythm position — purely a layout choice, never a factual claim about the room. */
  layout?: "portrait" | "landscape";
  /** Smaller, trimmed treatment for the related-rooms scroller. */
  compact?: boolean;
  priority?: boolean;
};

// The one card component every room uses, at any roster size — no per-room
// layout branching. The thin brass rule along the image's edge is this
// collection's one signature mark: a quiet architectural elevation line
// carrying the room's position in the collection ("01", "02"...), the way a
// site drawing annotates a datum rather than a decorative badge. Reveals in
// three quiet beats — image, then identity, then facts and actions.
export function RoomPlate({ room, layout = "portrait", compact, priority }: RoomPlateProps) {
  const facts = [
    room.sleeps ? `${room.sleeps} guests` : null,
    room.bedType ?? null,
    room.sizeSqm ? `${room.sizeSqm} m²` : null,
    room.view ?? null,
  ].filter((fact): fact is string => Boolean(fact));

  const isLandscape = layout === "landscape" && !compact;

  return (
    <motion.div className="group" variants={motionPrimitives.staggerContainer}>
      <Link href={`/rooms/${room.slug}`} className="block">
        <motion.div
          className={`image-frame relative origin-center ${isLandscape ? "aspect-[16/10]" : "aspect-[4/5]"}`}
          variants={motionPrimitives.revealMask}
          transition={{ duration: 0.8, ease: luxuryEase }}
        >
          <Image
            src={room.image}
            alt={room.imageAlt}
            fill
            priority={priority}
            sizes={
              compact
                ? "(max-width: 760px) 72vw, 30vw"
                : isLandscape
                  ? "(max-width: 760px) 92vw, 62vw"
                  : "(max-width: 760px) 92vw, (max-width: 1280px) 44vw, 30vw"
            }
            className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.028]"
            style={{ objectPosition: room.position }}
          />

          <div aria-hidden="true" className="absolute inset-y-4 left-4 flex flex-col items-center sm:left-5">
            <span className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-ivory/80 transition-colors duration-500 [writing-mode:vertical-rl] group-hover:text-brass">
              {room.number}
            </span>
            <span className="mt-2 w-px flex-1 bg-brass/45 transition-colors duration-500 group-hover:bg-brass/85" />
          </div>
        </motion.div>

        <motion.div
          variants={motionPrimitives.revealUp}
          transition={{ duration: 0.5, delay: 0.1, ease: luxuryEase }}
        >
          <div
            className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-ink/12 pt-3 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 ${isLandscape ? "mt-5" : "mt-4"}`}
          >
            <h3
              className={`display leading-[1.1] ${compact ? "text-[1.05rem]" : isLandscape ? "text-[1.55rem]" : "text-[1.3rem]"}`}
            >
              {room.name}
            </h3>
            {room.priceFrom ? (
              <p className="shrink-0 whitespace-nowrap text-[0.78rem] font-bold text-ink/64">
                From <span className="text-ink/95">${room.priceFrom}</span>
              </p>
            ) : null}
          </div>

          {!compact ? (
            <p
              className={`mt-2 text-[0.86rem] leading-[1.6] text-ink/64 ${isLandscape ? "max-w-[520px]" : "line-clamp-2"}`}
            >
              {room.description}
            </p>
          ) : null}
        </motion.div>

        {facts.length ? (
          <motion.p
            className="mt-3 flex flex-wrap items-center text-[0.66rem] font-bold uppercase tracking-[0.08em] text-ink/56"
            variants={motionPrimitives.precisionDetail}
            transition={{ duration: 0.4, delay: 0.2, ease: luxuryEase }}
          >
            {facts.map((fact, index) => (
              <span key={fact} className="flex items-center">
                {index > 0 ? <span aria-hidden="true" className="mx-2.5 h-3 w-px bg-ink/22" /> : null}
                {fact}
              </span>
            ))}
          </motion.p>
        ) : null}
      </Link>

      <motion.div
        className="mt-4 flex items-center gap-5"
        variants={motionPrimitives.precisionDetail}
        transition={{ duration: 0.4, delay: 0.26, ease: luxuryEase }}
      >
        <Link href={`/rooms/${room.slug}`} className="text-link text-ink/80 group-hover:text-ink">
          View room -&gt;
        </Link>
        {!compact ? (
          <Link
            href={`/booking?room=${room.slug}`}
            className="text-link text-brass opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          >
            Reserve -&gt;
          </Link>
        ) : null}
      </motion.div>
    </motion.div>
  );
}
