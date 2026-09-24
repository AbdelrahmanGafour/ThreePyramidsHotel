import type { RoomWithPresentation } from "@/features/rooms/api";

export type RoomFact = { label: string; value: string };

// Only confirmed specs render, and only the ones actually set — no
// placeholder standing in for a missing figure.
export function getRoomFacts(room: RoomWithPresentation): RoomFact[] {
  return [
    room.sleeps ? { label: "Sleeps", value: `${room.sleeps} guests` } : null,
    room.bedType ? { label: "Bed", value: room.bedType } : null,
    room.sizeSqm ? { label: "Size", value: `${room.sizeSqm} m²` } : null,
    room.view ? { label: "View", value: room.view } : null,
  ].filter((fact): fact is RoomFact => Boolean(fact));
}

// Label above value in a two-column grid: readable at a glance and easy to
// compare card-to-card, with no tiny uppercase run-on line.
export function RoomFactList({ room, className = "" }: { room: RoomWithPresentation; className?: string }) {
  const facts = getRoomFacts(room);
  if (!facts.length) return null;

  return (
    <dl className={`grid grid-cols-2 gap-x-5 gap-y-3 ${className}`}>
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className="text-[0.8125rem] text-ink/62">{fact.label}</dt>
          <dd className="mt-0.5 text-[0.9375rem] font-semibold leading-snug text-ink">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
