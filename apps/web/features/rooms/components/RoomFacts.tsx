import { InfoSection } from "@/shared/components/ui/InfoSection";
import { getRoomFacts } from "@/features/rooms/components/RoomFactList";
import type { RoomWithPresentation } from "@/features/rooms/api";

export function RoomFacts({ room }: { room: RoomWithPresentation }) {
  const facts = getRoomFacts(room);
  if (!facts.length) return null;

  return (
    <InfoSection title="Room details">
      <dl>
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="flex items-baseline justify-between gap-6 border-t border-ink/12 py-3.5 first:border-t-0 first:pt-0"
          >
            <dt className="text-[0.9375rem] text-ink/68">{fact.label}</dt>
            <dd className="text-right text-[1.0625rem] font-semibold text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </InfoSection>
  );
}
