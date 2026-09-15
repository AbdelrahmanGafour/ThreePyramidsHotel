import type { Package } from "@/features/packages/types";

// ═══════════════════════════════════════════════════════════════════════════
// DEMO CONTENT — replace with confirmed package content before production.
//
// No package/tour brochure exists in this repo yet. Rather than inventing
// unrelated tours, every journey below extends themes and places the hotel
// has already published on the homepage (`features/home/data/homeData.ts`'s
// `experiences` and `places` arrays — the Plateau at dawn, the Museum, the
// desert beyond the city, evenings after dark; Giza, the Sphinx, the Grand
// Egyptian Museum, Cairo). Durations, prices, group sizes, languages,
// pickup, inclusions, and itinerary specifics are all illustrative and not
// confirmed by Three Pyramids Boutique Hotel — do not quote, publish, or
// launch with these values. Swapping this file for a real data source is the
// only change needed before launch; every component reads through the
// `Package` type and has no knowledge that this content is provisional.
// ═══════════════════════════════════════════════════════════════════════════

export const packages: Package[] = [
  {
    slug: "dawn-plateau-and-the-museum",
    title: "Dawn at the Plateau & the Museum",
    shortTitle: "Plateau & Museum",
    eyebrow: "Culture & Heritage",
    duration: "2 days / 1 night",
    nights: 1,
    route: ["Giza Plateau", "The Sphinx", "Grand Egyptian Museum"],
    summary:
      "A quiet first hour with the horizon before the day gathers pace, followed by a measured, curated route through the museum — sequence and attention over ground covered.",
    image: "/images/placeholders/giza-suite-terrace.webp",
    imageAlt: "Warm dawn light over the Giza plateau seen from a private terrace",
    position: "29% 50%",
    gallery: ["/images/placeholders/giza-suite-terrace.webp", "/images/placeholders/arrival-courtyard.webp"],
    highlights: [
      "Private early access before the plateau gathers its crowds",
      "A slower, sequence-led visit to the Grand Egyptian Museum",
      "One night's stay bridges the two mornings without rushing either",
    ],
    itinerary: [
      {
        day: 1,
        title: "The Plateau, before the crowds",
        narrative:
          "An early departure while the light is still low, arranged around a quiet first hour with the horizon rather than a checklist of viewpoints.",
        moments: ["Private early access", "The Sphinx at low light", "Return to the hotel to rest before evening"],
      },
      {
        day: 2,
        title: "A slower morning at the Museum",
        narrative:
          "A measured route through the Grand Egyptian Museum, paced around attention and quiet looking rather than volume of rooms seen.",
        moments: ["Curated route through key halls", "Time held for the pieces that ask for it", "Onward transfer or return"],
      },
    ],
    included: ["One night's stay at Three Pyramids Boutique Hotel", "Private early plateau access", "Museum route with a private guide"],
    excluded: ["International flights", "Personal expenses", "Gratuities"],
    addOns: [
      { label: "Private photographer for the plateau morning" },
      { label: "Extra night at the hotel" },
      { label: "Private airport transfer" },
    ],
    pickup: "Hotel departure and return",
    languages: ["English", "Arabic"],
    groupType: "Private",
    pricingOptions: [
      { label: "Solo", unit: "per person", price: 420 },
      { label: "Couple", unit: "per person", price: 360 },
      { label: "Family", unit: "per person, up to 4", price: 310 },
    ],
    priceFrom: 310,
    cancellationSummary: "Free cancellation up to 7 days before departure.",
    bookingMode: "inquire",
  },
  {
    slug: "into-the-desert-stillness",
    title: "Into the Desert Stillness",
    shortTitle: "Desert Stillness",
    eyebrow: "Desert Escape",
    duration: "3 days / 2 nights",
    nights: 2,
    route: ["Cairo", "The desert beyond the city"],
    summary:
      "A simple route outward, where the city softens into stone and air — two nights arranged around stillness rather than distance covered.",
    image: "/images/placeholders/material-detail.webp",
    imageAlt: "Warm stone and material texture evoking the quiet of the desert beyond the city",
    position: "50% 50%",
    gallery: ["/images/placeholders/material-detail.webp", "/images/placeholders/warm-room.webp"],
    highlights: [
      "An unhurried departure from Cairo, timed to the light rather than the clock",
      "Two nights held open for stillness, not itinerary",
      "A return arranged around rest, not a rushed transfer",
    ],
    itinerary: [
      {
        day: 1,
        title: "Leaving the city",
        narrative: "A departure from Cairo timed for soft afternoon light, the city thinning out into open stone and air.",
        moments: ["Departure from Cairo", "First stop as the landscape opens", "Settle in for the evening"],
      },
      {
        day: 2,
        title: "A day held open",
        narrative: "A full day with no fixed checklist — time arranged around quiet and pace rather than sights ticked off.",
        moments: ["Slow morning", "An outward route with no fixed endpoint", "Evening stillness"],
      },
      {
        day: 3,
        title: "The return",
        narrative: "An unhurried return toward Cairo, arranged so the stillness of the previous two days isn't undone by a rushed transfer.",
        moments: ["Late morning departure", "Return to Cairo", "Transfer to the hotel or onward"],
      },
    ],
    included: ["Two nights of accommodation en route", "Private vehicle for the full route", "A private guide for the outward days"],
    excluded: ["International flights", "Meals not specified", "Personal expenses"],
    addOns: [{ label: "Private evening under open sky" }, { label: "Extra night at the hotel on return" }],
    pickup: "Cairo departure",
    languages: ["English", "Arabic"],
    groupType: "Private",
    pricingOptions: [
      { label: "Solo", unit: "per person", price: 780 },
      { label: "Couple", unit: "per person", price: 650 },
    ],
    priceFrom: 650,
    cancellationSummary: "Free cancellation up to 14 days before departure.",
    bookingMode: "inquire",
  },
  {
    slug: "rooftop-evenings-after-dark",
    title: "Rooftop Evenings & the City After Dark",
    shortTitle: "Rooftop Evenings",
    eyebrow: "Cairo Evenings",
    duration: "1 day / 1 night",
    nights: 1,
    route: ["Cairo", "Giza rooftop"],
    summary:
      "Lantern light, low conversation, and the plateau holding the edge of the night — a single evening arranged around nightfall rather than a full-day itinerary.",
    image: "/images/placeholders/rooftop-dining.webp",
    imageAlt: "Rooftop dining terrace at nightfall with warm lantern light",
    position: "58% 48%",
    gallery: ["/images/placeholders/rooftop-dining.webp", "/images/placeholders/hospitality-editorial-set.webp"],
    highlights: [
      "One evening, deliberately unhurried rather than fully scheduled",
      "A rooftop table timed to the last of the light",
      "A single night's stay so the evening doesn't have to end early",
    ],
    itinerary: [
      {
        day: 1,
        title: "As the light turns",
        narrative:
          "An evening that begins as the light turns amber, arranged around a rooftop table and the plateau holding the edge of the night.",
        moments: ["Late-afternoon arrival", "Rooftop table at dusk", "An unhurried evening, no fixed end time"],
      },
    ],
    included: ["One night's stay at Three Pyramids Boutique Hotel", "Rooftop table reserved for the evening"],
    excluded: ["International flights", "Personal expenses", "Gratuities"],
    pickup: "Hotel arrival",
    languages: ["English", "Arabic"],
    groupType: "Private or small group",
    pricingOptions: [
      { label: "Couple", unit: "per person", price: 240 },
      { label: "Family", unit: "per person, up to 4", price: 205 },
    ],
    priceFrom: 205,
    cancellationSummary: "Free cancellation up to 48 hours before arrival.",
    bookingMode: "inquire",
  },
];

/** Distinct categories, or `[]` while the roster only spans one. */
export function getPackageCategories(list: Package[]): string[] {
  const distinct = Array.from(new Set(list.map((item) => item.eyebrow).filter(Boolean)));
  return distinct.length > 1 ? distinct : [];
}
