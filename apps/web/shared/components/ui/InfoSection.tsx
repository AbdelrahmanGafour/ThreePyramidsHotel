import type { ReactNode } from "react";

type InfoSectionProps = {
  title: string;
  id?: string;
  /** One line under the title saying what this section holds. */
  intro?: ReactNode;
  children: ReactNode;
};

// The one section pattern for detail and utility pages: a plain, practical
// heading on the left, its content on the right, one fine rule above.
// Stacks to a single column below tablet.
export function InfoSection({ title, id, intro, children }: InfoSectionProps) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-ink/12 bg-ivory py-[clamp(2.25rem,4vw,3.25rem)] text-ink">
      <div className="page-grid gap-y-5">
        <div className="col-span-3 col-start-2 max-md:col-span-full">
          <h2 className="section-title">{title}</h2>
          {intro ? <p className="fine-print mt-2 md:max-w-[28ch]">{intro}</p> : null}
        </div>
        <div className="col-span-7 col-start-5 max-md:col-span-full">{children}</div>
      </div>
    </section>
  );
}
