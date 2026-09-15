import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { RoomPlate } from "@/features/rooms/components/RoomPlate";
import type { Room } from "@/features/rooms/data/roomsData";

type RelatedRoomsProps = {
  rooms: Room[];
};

// A horizontal scroller rather than a fixed grid, so this reads the same
// whether there are 2 other rooms or 19 of them.
export function RelatedRooms({ rooms }: RelatedRoomsProps) {
  if (!rooms.length) return null;

  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(3rem,5.5vw,4.5rem)] text-ink">
      <motion.div
        className="page-grid"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-12% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <motion.h2
          className="label col-span-full col-start-2 text-aged-gold sm:col-span-8"
          variants={motionPrimitives.precisionDetail}
          transition={{ duration: 0.4, ease: luxuryEase }}
        >
          More rooms
        </motion.h2>
      </motion.div>

      <div className="mt-6 flex snap-x snap-mandatory gap-6 overflow-x-auto px-[var(--page-x)] pb-2">
        {rooms.map((room) => (
          <div key={room.slug} className="w-[260px] shrink-0 snap-start sm:w-[300px]">
            <RoomPlate room={room} compact />
          </div>
        ))}
      </div>
    </section>
  );
}
