import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { Room } from "@/features/rooms/data/roomsData";

// Renders nothing if no safe atmosphere copy exists for this room.
export function RoomStory({ room }: { room: Room }) {
  if (!room.story) return null;

  return (
    <InfoSection title="About this room">
      <p className="prose-body max-w-[62ch] text-[1.0625rem] leading-[1.75]">{room.story}</p>
    </InfoSection>
  );
}
