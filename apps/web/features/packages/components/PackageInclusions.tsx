import { InfoSection } from "@/shared/components/ui/InfoSection";
import type { Package } from "@/features/packages/types";

// Two plainly-titled sections. What's included gets a tick; what isn't gets a
// dash — and each carries its heading, so the marks never carry meaning alone.
export function PackageInclusions({ pkg }: { pkg: Package }) {
  return (
    <>
      {pkg.included.length ? (
        <InfoSection title="What's included">
          <ul className="grid gap-3">
            {pkg.included.map((item) => (
              <li key={item} className="flex items-start gap-3 text-[1rem] leading-[1.6] text-ink/85">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-1 shrink-0 text-[var(--brass-ink)]">
                  <path d="m3 8.5 3.2 3L13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </InfoSection>
      ) : null}

      {pkg.excluded.length ? (
        <InfoSection title="What's not included">
          <ul className="grid gap-3">
            {pkg.excluded.map((item) => (
              <li key={item} className="flex items-start gap-3 text-[1rem] leading-[1.6] text-ink/80">
                <span aria-hidden="true" className="mt-[0.72rem] h-px w-3 shrink-0 bg-ink/60" />
                {item}
              </li>
            ))}
          </ul>
        </InfoSection>
      ) : null}
    </>
  );
}
