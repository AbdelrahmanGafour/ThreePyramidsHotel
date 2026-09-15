import type { Room } from "@/features/rooms/data/roomsData";

type RoomFactsProps = {
  room: Room;
};

// A fine rule-separated information rail, not a spec-sheet grid of cards.
// Only confirmed specs render, and only the ones actually set — no "TBC"
// placeholder standing in for a missing figure.
export function RoomFacts({ room }: RoomFactsProps) {
  const facts = [
    room.sleeps ? { label: "Guests", value: `${room.sleeps} guests` } : null,
    room.bedType ? { label: "Bed", value: room.bedType } : null,
    room.sizeSqm ? { label: "Size", value: `${room.sizeSqm} m²` } : null,
    room.view ? { label: "View", value: room.view } : null,
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact));

  if (!facts.length) return null;

  return (
    <section className="border-t border-ink/10 bg-ivory py-[clamp(2.5rem,4.5vw,3.5rem)] text-ink">
      <div className="page-grid">
        <h2 className="label col-span-4 col-start-2 text-aged-gold max-md:col-span-full">Room facts</h2>

        <dl className="col-span-6 col-start-6 mt-5 max-md:col-span-full md:mt-0">
          {facts.map((fact) => (
            <div key={fact.label} className="flex items-baseline justify-between gap-6 border-t border-ink/10 py-3.5 first:border-t-0 first:pt-0">
              <dt className="text-[0.66rem] font-bold uppercase tracking-[0.12em] text-ink/56">{fact.label}</dt>
              <dd className="text-[0.98rem] text-ink/88">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
