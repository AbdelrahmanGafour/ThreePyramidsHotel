import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { Package } from "@/features/packages/types";

// Day-by-day, where numbering is a true sequence. A fine brass line joins the
// day markers; typography carries the rest — no accordion, no animation.
export function PackageItinerary({ pkg }: { pkg: Package }) {
  if (!pkg.itinerary.length) return null;

  return (
    <InfoSection title="Itinerary" intro="What happens on each day of the journey.">
      {pkg.highlights.length ? (
        <div className="mb-8">
          <h3 className="group-title">Highlights</h3>
          <ul className="mt-3 grid gap-2">
            {pkg.highlights.map((highlight) => (
              <li key={highlight} className="flex items-start gap-3 text-[1rem] leading-[1.6] text-ink/85">
                <span aria-hidden="true" className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rotate-45 bg-brass" />
                {highlight}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ol className="relative">
        <span aria-hidden="true" className="absolute bottom-10 left-[5px] top-2 w-px bg-brass/50" />

        {pkg.itinerary.map((day, index) => (
          <li key={day.day} className={`relative pl-10 ${index === pkg.itinerary.length - 1 ? "" : "pb-9"}`}>
            <span aria-hidden="true" className="absolute left-0 top-1.5 h-[11px] w-[11px] rotate-45 bg-brass" />
            <p className="text-[0.9375rem] font-bold text-[var(--brass-ink)]">Day {day.day}</p>
            <h3 className="display mt-1 text-[1.3rem] leading-[1.2] text-ink">{day.title}</h3>
            <p className="prose-body mt-2 max-w-[60ch]">{day.narrative}</p>
            {day.moments.length ? (
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.9375rem] text-ink/75">
                {day.moments.map((moment) => (
                  <li key={moment} className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-1 w-1 rounded-full bg-ink/50" />
                    {moment}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </InfoSection>
  );
}
