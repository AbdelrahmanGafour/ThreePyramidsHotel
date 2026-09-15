import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import type { Room } from "@/features/rooms/data/roomsData";

type RoomStoryProps = {
  room: Room;
};

// Renders nothing if no safe atmosphere copy exists for this room — no
// placeholder text, no empty section.
export function RoomStory({ room }: RoomStoryProps) {
  if (!room.story) return null;

  return (
    <section className="bg-ivory py-[clamp(2.75rem,5vw,4rem)] text-ink">
      <motion.div
        className="page-grid"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-14% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <motion.div
          className="col-span-7 col-start-2 max-md:col-span-full"
          variants={motionPrimitives.editorialText}
          transition={{ duration: 0.62, ease: luxuryEase }}
        >
          <h2 className="label text-aged-gold">The Room</h2>
          <p className="display mt-4 max-w-[620px] text-[clamp(1.3rem,3.2vw,1.6rem)] leading-[1.5] text-ink/86">
            {room.story}
          </p>
        </motion.div>
      </motion.div>
    </section>
  );
}
