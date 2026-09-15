"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { luxuryEase } from "@/shared/components/motion/PremiumMotion";
import type { Package } from "@/features/packages/types";

type JourneyNavigatorProps = {
  packages: Package[];
};

// The heart of the listing page — an index you switch between, not a grid
// you browse. One controlled image composition on the left tracks whichever
// journey is active on the right; a fine route line with a node per journey
// ties the index together, brightening at the active row instead of a
// carousel's arrows/dots.
export function JourneyNavigator({ packages }: JourneyNavigatorProps) {
  const [active, setActive] = useState(0);
  const reduceMotion = useReducedMotion();
  const selected = packages[active];
  const supporting = selected.gallery?.[1];

  return (
    <section aria-label="Journey navigator" className="bg-ivory px-[var(--page-x)] py-[clamp(2.5rem,4.5vw,3.75rem)] text-ink">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.8fr)] lg:items-stretch">
        <div className="relative order-1 min-h-[340px] sm:min-h-[420px] lg:min-h-[520px]">
          <div className="image-frame relative h-full min-h-[340px] sm:min-h-[420px] lg:min-h-[520px] lg:w-[86%]">
            <AnimatePresence mode="wait">
              <motion.div
                key={selected.slug}
                className="absolute inset-0"
                initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.012, clipPath: "inset(0 0 0 8%)" }}
                animate={{ opacity: 1, scale: 1, clipPath: "inset(0 0 0 0%)" }}
                exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.996, clipPath: "inset(0 8% 0 0)" }}
                transition={{ duration: reduceMotion ? 0 : 0.72, ease: luxuryEase }}
              >
                <Image
                  src={selected.image}
                  alt={selected.imageAlt}
                  fill
                  sizes="(max-width: 1024px) 92vw, 58vw"
                  className="object-cover"
                  style={{ objectPosition: selected.position }}
                />
              </motion.div>
            </AnimatePresence>
            <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(30,24,21,0.32),transparent_44%)]" />
            <p className="absolute bottom-4 left-4 text-[0.6rem] font-black uppercase tracking-[0.16em] text-ivory/90">
              {selected.eyebrow}
            </p>
          </div>

          {supporting ? (
            <div className="image-frame absolute -bottom-6 right-0 hidden aspect-[4/5] w-[30%] border border-ivory sm:block">
              <AnimatePresence mode="wait">
                <motion.div
                  key={selected.slug}
                  className="absolute inset-0"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.5, delay: reduceMotion ? 0 : 0.1, ease: luxuryEase }}
                >
                  <Image src={supporting} alt="" fill sizes="20vw" className="object-cover" style={{ objectPosition: selected.position }} />
                </motion.div>
              </AnimatePresence>
            </div>
          ) : null}
        </div>

        <div className="relative order-2 mt-8 lg:mt-0">
          <motion.span
            aria-hidden="true"
            className="absolute left-[3px] top-2 hidden w-px origin-top bg-brass/35 sm:block"
            style={{ bottom: "1.5rem" }}
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, margin: "-10% 0px" }}
            transition={{ duration: 0.9, ease: luxuryEase }}
          />

          <ol className="grid">
            {packages.map((pkg, index) => {
              const isActive = index === active;

              return (
                <li key={pkg.slug} className="border-t border-ink/10 first:border-t-0">
                  <button
                    type="button"
                    aria-expanded={isActive}
                    onClick={() => setActive(index)}
                    onMouseEnter={() => setActive(index)}
                    onFocus={() => setActive(index)}
                    className="group relative block w-full py-4 pl-8 text-left sm:pl-9"
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute left-0 top-[1.35rem] h-1.5 w-1.5 rotate-45 transition-all duration-500 ${
                        isActive ? "scale-125 bg-brass" : "bg-ink/25 group-hover:bg-brass/70"
                      }`}
                    />
                    <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="flex items-baseline gap-3">
                        <span className={`text-[0.7rem] font-black tracking-[0.2em] ${isActive ? "text-brass" : "text-ink/32"}`}>
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className={`display text-[1.15rem] leading-[1.1] ${isActive ? "text-ink" : "text-ink/56"}`}>
                          {pkg.shortTitle}
                        </span>
                      </span>
                      {pkg.priceFrom ? (
                        <span className={`text-[0.72rem] font-bold ${isActive ? "text-ink/72" : "text-ink/38"}`}>
                          From ${pkg.priceFrom}
                        </span>
                      ) : null}
                    </span>

                    <span className="mt-1 block pl-6 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-ink/44 sm:pl-7">
                      {pkg.duration} &middot; {pkg.route.join(" · ")}
                    </span>

                    <span
                      className={`block overflow-hidden pl-6 transition-all duration-500 sm:pl-7 ${
                        isActive ? "mt-3 max-h-40 opacity-100" : "max-h-0 opacity-0"
                      }`}
                    >
                      <span className="block max-w-[420px] text-[0.86rem] leading-[1.6] text-ink/64">{pkg.summary}</span>
                      {pkg.highlights.length ? (
                        <span className="mt-2.5 block text-[0.72rem] leading-[1.6] text-ink/52">
                          {pkg.highlights.slice(0, 2).join(" — ")}
                        </span>
                      ) : null}
                      <span className="mt-3 flex items-center gap-5">
                        <Link href={`/packages/${pkg.slug}`} className="text-link text-ink/80 hover:text-ink">
                          Explore journey -&gt;
                        </Link>
                        <Link href={`/packages/${pkg.slug}#inquire`} className="text-link text-brass">
                          Enquire -&gt;
                        </Link>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
