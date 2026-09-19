"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { places } from "@/features/home/data/homeData";

const origin = { x: 50, y: 42 };

export function LocationSection() {
  const [active, setActive] = useState(places[0].name);
  const activePlace = places.find((place) => place.name === active) ?? places[0];
  const activeY = activePlace.y * 0.64;

  return (
    <motion.section
      id="location"
      className="bg-limestone py-[var(--section-y)] text-ink"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-12% 0px" }}
      variants={motionPrimitives.staggerContainer}
    >
      <div className="page-grid items-center gap-y-10">
        <motion.div className="col-span-4 col-start-2" variants={motionPrimitives.revealUp}>
          <p className="label text-aged-gold">Location</p>
          <h2 className="mt-6 max-w-[500px] text-balance font-sans text-[clamp(1.85rem,8vw,2.35rem)] font-semibold leading-[1.08] md:mt-7 md:text-[clamp(1.85rem,3vw,2.65rem)]">
            A quiet base on the edge of Giza.
          </h2>
          <p className="body-copy mt-6 max-w-[390px]">
            Positioned for plateau mornings, museum days, and evenings that return to stillness.
          </p>
          <div className="mt-8 hidden max-w-[320px] border-l border-aged-gold/36 pl-5 text-[0.58rem] font-black uppercase tracking-[0.2em] text-ink/44 md:block">
            Giza axis / Plateau / City / Museum
          </div>
        </motion.div>

        <motion.div className="col-span-7 col-start-6" variants={motionPrimitives.revealUp}>
          <div className="relative min-h-[410px] overflow-hidden border-y border-ink/14 bg-[rgba(244,238,229,0.34)] sm:min-h-[430px]">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(30,24,21,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(30,24,21,0.055)_1px,transparent_1px)] bg-[length:34px_34px]" />
            <div className="absolute inset-x-8 top-8 h-px bg-[linear-gradient(90deg,transparent,rgba(148,112,62,0.46),transparent)]" />

            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 64"
              role="img"
              aria-label="Abstract cartographic drawing showing landmarks around Giza and Cairo"
            >
              <path
                d="M10 49 C24 43 32 35 44 29 C56 22 66 17 82 11"
                fill="none"
                stroke="#94703E"
                strokeWidth="0.42"
                strokeDasharray="2 2"
                opacity="0.62"
              />
              <path
                d="M18 22 C30 31 44 32 62 27 C72 24 80 24 89 29"
                fill="none"
                stroke="#A99685"
                strokeWidth="0.32"
                strokeDasharray="1.4 2.4"
                opacity="0.42"
              />
              <path
                key={activePlace.name}
                d={`M${origin.x} ${origin.y} C${(origin.x + activePlace.x) / 2} ${origin.y - 12} ${(origin.x + activePlace.x) / 2} ${activeY + 10} ${activePlace.x} ${activeY}`}
                fill="none"
                stroke="#B08A51"
                strokeWidth="0.62"
                pathLength="1"
                opacity="0.82"
                className="location-route transition-[stroke,opacity] duration-500"
              />
              <path d="M70 19 74 12 78 19M58 36 61 30 64 36" fill="none" stroke="#94703E" strokeWidth="0.72" opacity="0.72" />
              <circle cx={origin.x} cy={origin.y} r="1.1" fill="#94703E" opacity="0.7" />
              {places.map((place) => {
                const selected = active === place.name;
                const isLapis = place.name === "Grand Egyptian Museum";
                const y = place.y * 0.64;

                return (
                  <g key={place.name} className="transition-opacity duration-500">
                    <circle
                      cx={place.x}
                      cy={y}
                      r={selected ? 2.55 : 1.45}
                      fill={selected ? "#B08A51" : "#5A4A40"}
                      opacity={selected ? 1 : 0.48}
                      className="transition-[r,fill,opacity] duration-500"
                    />
                    {isLapis ? <circle cx={place.x} cy={y} r="0.72" fill="#264A59" /> : null}
                    <text
                      x={place.x + 3.4}
                      y={y + 1.1}
                      fill="#1E1815"
                      opacity={selected ? 0.9 : 0.42}
                      fontSize="2.1"
                      letterSpacing="0.1em"
                      className="hidden transition-opacity duration-500 sm:block"
                    >
                      {place.name.toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </svg>

            <div className="absolute bottom-4 left-4 right-4 grid grid-cols-2 gap-2 md:bottom-5 md:left-5 md:right-5 md:grid-cols-4 md:gap-3" aria-label="Landmark selector">
              {places.map((place, index) => {
                const selected = active === place.name;

                return (
                  <button
                    type="button"
                    key={place.name}
                    aria-pressed={selected}
                    onMouseEnter={() => setActive(place.name)}
                    onFocus={() => setActive(place.name)}
                    onClick={() => setActive(place.name)}
                    className={`group min-h-11 border-t pt-2 text-left transition-colors md:min-h-12 md:pt-3 ${
                      selected ? "border-aged-gold text-ink" : "border-ink/14 text-ink/48 hover:border-ink/32 hover:text-ink/72"
                    }`}
                  >
                    <span className={`block text-[0.54rem] font-black uppercase tracking-[0.12em] md:text-[0.58rem] md:tracking-[0.19em] ${selected ? "text-aged-gold" : ""}`}>
                      {String(index + 1).padStart(2, "0")} {place.name}
                    </span>
                    <span
                      className={`mt-2 block h-px origin-left bg-aged-gold transition-transform duration-500 ${
                        selected ? "scale-x-100" : "scale-x-0 group-hover:scale-x-50"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}
