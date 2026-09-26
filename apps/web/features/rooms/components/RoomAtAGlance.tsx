import { getRoomFacts } from "@/features/rooms/components/RoomFactList";
import type { RoomWithPresentation } from "@/features/rooms/api";

// A warm taupe fact strip, not flat ivory and not full dark espresso — a
// soft sand tint gives this section its own material character. "Before you
// arrive" further down stays this page's one deep-espresso anchor, so this
// stays a lighter, warmer surface rather than a second dark block.
export function RoomAtAGlance({ room }: { room: RoomWithPresentation }) {
  const facts = getRoomFacts(room);
  if (!facts.length) return null;

  return (
    <section className="border-t border-ink/10 bg-sand/35 py-[clamp(2rem,3.6vw,2.75rem)] text-ink">
      <div className="page-grid">
        <div className="col-span-10 col-start-2 max-md:col-span-full">
          <p className="label text-[var(--brass-ink)]">At a glance</p>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4 sm:divide-x sm:divide-[var(--clay)]/25">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`flex flex-col gap-2 ${index > 0 ? "sm:pl-6" : ""}`}>
                <dt className="text-[0.875rem] font-bold uppercase tracking-[0.08em] text-ink/62">{fact.label}</dt>
                <dd className="text-[1.3125rem] font-semibold text-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
