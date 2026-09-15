import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { RoomGallery } from "@/features/rooms/components/RoomGallery";
import { RoomSummaryPanel } from "@/features/rooms/components/RoomSummaryPanel";
import type { Room } from "@/features/rooms/data/roomsData";

type RoomDetailOpeningProps = {
  room: Room;
};

// The opening composition: a large controlled image beside the room's
// identity, quick facts, price, and one booking action — so a guest
// understands the room without scrolling. Deeper photography, facts, and
// amenities all follow below for anyone who wants more before they book.
export function RoomDetailOpening({ room }: RoomDetailOpeningProps) {
  return (
    <section className="stone-section px-[var(--page-x)] pb-[clamp(1.75rem,3vw,2.25rem)] pt-[clamp(1.5rem,3vw,2.25rem)] text-ink">
      <motion.div
        className="lg:grid lg:grid-cols-[1fr_360px] lg:items-start lg:gap-10"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-10% 0px" }}
        variants={motionPrimitives.staggerContainer}
      >
        <motion.div variants={motionPrimitives.revealMask} transition={{ duration: 0.85, ease: luxuryEase }}>
          <RoomGallery room={room} />
        </motion.div>

        <motion.div variants={motionPrimitives.staggerContainer}>
          <RoomSummaryPanel room={room} />
        </motion.div>
      </motion.div>
    </section>
  );
}
