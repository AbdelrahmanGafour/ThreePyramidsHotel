import { BrandMark } from "@/shared/components/ui/BrandMark";

// A short, dark masthead — not the ivory text block or the room-count
// colophon tried before. Flat espresso, not a gradient: a single deliberate
// dark surface, calmer than a decorative blend, and the only dark moment on
// this page besides "Before you arrive" further down. The brand mark
// repeated oversized and nearly invisible in the corner is the one
// atmospheric gesture — purely decorative, cropped by `overflow-hidden`,
// never a claim about a specific room.
export function RoomsHero() {
  return (
    <section className="relative overflow-hidden bg-espresso text-ivory">
      <BrandMark className="pointer-events-none absolute -top-8 -right-12 h-[180px] w-[360px] text-ivory opacity-[0.05] sm:h-[260px] sm:w-[520px]" />

      <div className="page-grid relative pt-[calc(var(--header-h)+clamp(2.25rem,4.5vw,3.25rem))] pb-[clamp(2.25rem,4.5vw,3.25rem)]">
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
