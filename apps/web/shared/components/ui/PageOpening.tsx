import type { ReactNode } from "react";

type PageOpeningProps = {
  eyebrow: string;
  title: string;
  /** One plain-language sentence saying what this page is for. */
  children: ReactNode;
  /** Optional useful context (counts, starting prices) shown under the description. */
  meta?: ReactNode;
  /** Optional actions — one primary at most, plus a secondary. */
  actions?: ReactNode;
};

// The shared opening for every inner page: eyebrow, H1, one clear sentence,
// then only what genuinely helps. Deliberately compact and text-led so the
// content starts within the first screen, and it clears the fixed header.
export function PageOpening({ eyebrow, title, children, meta, actions }: PageOpeningProps) {
  return (
    <section className="stone-section pb-[clamp(1.75rem,3.2vw,2.5rem)] pt-[calc(var(--header-h)+clamp(2rem,4vw,3rem))] text-ink">
      <div className="page-grid">
        <div className="col-span-8 col-start-2 max-md:col-span-full">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-title mt-3">{title}</h1>
          <p className="page-lede mt-4">{children}</p>
          {meta ? <div className="mt-5 text-[0.9375rem] font-semibold text-ink/80">{meta}</div> : null}
          {actions ? (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">{actions}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
