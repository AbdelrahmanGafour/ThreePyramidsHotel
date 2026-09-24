export const navItems = ["Stay", "Journeys", "Experiences", "Gallery", "Location"];

// WFI-T03: the room teaser's `name`/`description`/`slug` used to live here as
// a second, independently-maintained copy of the same room concepts already
// authoritative in features/rooms/data/roomsData.ts / GET /api/v1/rooms —
// exactly the duplication that file's own header comment warned about. The
// homepage's RoomsSection now receives real room data (backend facts +
// presentation) as a prop from its Server Component page instead, so no
// room array is exported from here anymore.

export const experiences = [
  {
    number: "01",
    title: "The Plateau",
    kicker: "Before the crowds",
    meta: "Giza / Dawn",
    copy: "A quiet first hour with the horizon before the day gathers pace.",
    image: "/images/placeholders/giza-suite-terrace.webp",
    position: "29% 50%",
  },
  {
    number: "02",
    title: "The Museum",
    kicker: "A slower morning",
    meta: "Culture / Curated route",
    copy: "A measured visit shaped around attention, sequence, and quiet looking.",
    image: "/images/placeholders/arrival-courtyard.webp",
    position: "50% 52%",
  },
  {
    number: "03",
    title: "The Desert",
    kicker: "Beyond the city",
    meta: "Sand / Stillness",
    copy: "A simple route outward, where the city softens into stone and air.",
    image: "/images/placeholders/material-detail.webp",
    position: "50% 50%",
  },
  {
    number: "04",
    title: "After Dark",
    kicker: "Cairo / Giza evening",
    meta: "Rooftop / Nightfall",
    copy: "Lantern light, low conversation, and the plateau holding the edge of the night.",
    image: "/images/placeholders/rooftop-dining.webp",
    position: "58% 48%",
  },
];

export const gallery = [
  {
    src: "/images/placeholders/hospitality-editorial-set.webp",
    alt: "Editorial view of warm boutique hotel interiors and hospitality details",
    caption: "House atmosphere",
    position: "50% 50%",
  },
  {
    src: "/images/placeholders/arrival-courtyard.webp",
    alt: "Warm limestone lobby with brass and basalt details",
    caption: "Arrival hall",
    position: "50% 52%",
  },
  {
    src: "/images/placeholders/warm-room.webp",
    alt: "Quiet suite with linen bedding and pyramid view",
    caption: "Suite calm",
    position: "48% 50%",
  },
  {
    src: "/images/placeholders/giza-suite-terrace.webp",
    alt: "Rooftop dining at sunset with pyramids beyond",
    caption: "Rooftop table",
    position: "30% 50%",
  },
  {
    src: "/images/placeholders/rooftop-dining.webp",
    alt: "Rooftop dining at sunset with the pyramids beyond",
    caption: "Evening table",
    position: "58% 48%",
  },
];

export const places = [
  { name: "The Pyramids", x: 70, y: 28 },
  { name: "The Sphinx", x: 61, y: 42 },
  { name: "Grand Egyptian Museum", x: 35, y: 38 },
  { name: "Cairo", x: 18, y: 68 },
];
