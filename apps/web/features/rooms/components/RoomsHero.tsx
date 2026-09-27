// A short, dark masthead — not the ivory text block or the room-count
// colophon tried before. Flat espresso, not a gradient: a single deliberate
// dark surface, calmer than a decorative blend, and the only dark moment on
// this page besides "Before you arrive" further down.
//
// No decorative graphic. The oversized brand mark that used to sit in the
// top-right corner has been removed; the surface carries the heading alone.
// The padding, the grid columns and the type scale below are unchanged by
// that removal.
export function RoomsHero() {
  return (
    <section className="bg-espresso text-ivory">
      <div className="page-grid pt-[calc(var(--header-h)+clamp(2.25rem,4.5vw,3.25rem))] pb-[clamp(2.25rem,4.5vw,3.25rem)]">
        <div className="col-span-6 col-start-2 max-md:col-span-full">
          <p className="eyebrow text-brass!">The Rooms</p>
          <h1 className="page-title mt-3 text-ivory! text-[clamp(1.9rem,3.8vw,2.6rem)]!">Rooms &amp; Suites</h1>
          <p className="mt-3 max-w-[42ch] text-[1rem] leading-[1.6] text-ivory/74">
            Quiet spaces designed for rest, comfort, and Giza light.
          </p>
        </div>
      </div>
    </section>
  );
}
