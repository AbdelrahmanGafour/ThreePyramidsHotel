// Independent from `features/home/data/homeData.ts` by design: the homepage's
// `rooms` array is a compact teaser for the single-page browser, while this file
// is the full Rooms listing's (and detail pages') own source of truth. The two
// may start from the same safe placeholder content but must not be coupled —
// see the architecture audit's note on this exact naming collision.

export type Room = {
  slug: string;
  /** Display index only (e.g. "01") — a position in the collection, never a confirmed physical room/door number. */
  number: string;
  name: string;
  /**
   * Room grouping (e.g. "Rooms", "Suites", "Villas"). Optional — surfaced
   * only once `getRoomCategories` finds more than one distinct value, so a
   * single-category roster stays free of a pointless one-tab filter.
   */
  category?: string;
  description: string;
  /**
   * A short extended atmosphere passage used on the room detail page only.
   * Generic, non-factual mood copy — never a substitute for confirmed specs.
   */
  story?: string;
  /** Cover photo, used on cards and as the gallery's fallback frame. */
  image: string;
  /** Additional photography for this room. Optional — `RoomGallery` falls back to `[image]` alone when unset. */
  gallery?: string[];
  imageAlt: string;
  position: string;
  sizeSqm?: number;
  sleeps?: number;
  bedType?: string;
  view?: string;
  priceFrom?: number;
  amenities?: string[];
};

export type StayPolicies = {
  checkIn: string;
  checkOut: string;
  cancellation: string;
};

// ---------------------------------------------------------------------------
// Base content — names, copy, and cover photography. This is safe, reviewed
// placeholder editorial content (not a factual claim about the hotel), and is
// independent of the DEMO block below.
// ---------------------------------------------------------------------------
type RoomBase = Pick<Room, "slug" | "number" | "name" | "description" | "story" | "image" | "imageAlt" | "position">;

const roomBases: RoomBase[] = [
  {
    slug: "room-concept-01",
    number: "01",
    name: "Room concept 01",
    description: "Linen, warm stone, and a shaded outlook arranged for quiet mornings.",
    story:
      "Mornings arrive slowly here. Light moves across linen and stone before the day asks anything of you — nothing staged, only composed, so the room feels lived-in from the first hour.",
    image: "/images/placeholders/warm-room.webp",
    imageAlt: "Warm boutique hotel room with soft linen and architectural light",
    position: "48% 50%",
  },
  {
    slug: "room-concept-02",
    number: "02",
    name: "Room concept 02",
    description: "An upper-floor suite with softened evening light and a private place to pause.",
    story:
      "The light turns amber before it turns to dusk. Evenings settle in slowly here — unhurried, and entirely your own.",
    image: "/images/placeholders/giza-suite-terrace.webp",
    imageAlt: "Suite terrace with warm evening light near the Giza plateau",
    position: "30% 50%",
  },
  {
    slug: "room-concept-03",
    number: "03",
    name: "Room concept 03",
    description: "A composed family room with stone texture, low light, and room to settle.",
    story:
      "Low light and worked stone give the room a settled, grounded feel — a place to slow down together, away from the day's pace.",
    image: "/images/placeholders/arrival-courtyard.webp",
    imageAlt: "Warm limestone interior with brass and basalt material details",
    position: "52% 54%",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// DEMO CONTENT — placeholder/provisional values for local design and product
// review only. NONE of the figures below are confirmed by Three Pyramids
// Boutique Hotel. Do not quote, publish, or launch with these values.
//
// This block exists so the information-rich room UI (facts, amenities,
// pricing, gallery, stay policies) can be designed and reviewed now, without
// waiting on real inventory. Replacing it is the ONLY change needed before
// launch — swap `demoRoomDetails`/`demoStayPolicies` for a real data source
// (CMS or API); every component reads through `Room`/`StayPolicies` and has
// no knowledge that this data is provisional.
// ═══════════════════════════════════════════════════════════════════════════
type RoomDemoDetails = Pick<
  Room,
  "category" | "gallery" | "sizeSqm" | "sleeps" | "bedType" | "view" | "priceFrom" | "amenities"
>;

const demoRoomDetails: Record<string, RoomDemoDetails> = {
  "room-concept-01": {
    category: "Rooms",
    gallery: [
      "/images/placeholders/warm-room.webp",
      "/images/placeholders/hospitality-editorial-set.webp",
      "/images/placeholders/material-detail.webp",
    ],
    sizeSqm: 30,
    sleeps: 2,
    bedType: "Queen bed",
    view: "Courtyard view",
    priceFrom: 145,
    amenities: ["Air conditioning", "Private bathroom", "Filtered coffee bar", "Rainfall shower"],
  },
  "room-concept-02": {
    category: "Rooms",
    gallery: [
      "/images/placeholders/giza-suite-terrace.webp",
      "/images/placeholders/hospitality-editorial-set.webp",
      "/images/placeholders/material-detail.webp",
    ],
    sizeSqm: 42,
    sleeps: 2,
    bedType: "King bed",
    view: "Terrace & plateau view",
    priceFrom: 210,
    amenities: ["Air conditioning", "Private terrace", "Rainfall shower", "Turndown service"],
  },
  "room-concept-03": {
    category: "Rooms",
    gallery: [
      "/images/placeholders/arrival-courtyard.webp",
      "/images/placeholders/hospitality-editorial-set.webp",
      "/images/placeholders/material-detail.webp",
    ],
    sizeSqm: 38,
    sleeps: 3,
    bedType: "Queen bed + daybed",
    view: "Courtyard view",
    priceFrom: 175,
    amenities: ["Air conditioning", "Private bathroom", "Extra bedding on request", "Family-friendly layout"],
  },
};

/** DEMO — hotel-wide provisional policies, not sourced from the hotel yet. */
export const demoStayPolicies: StayPolicies = {
  checkIn: "3:00 PM",
  checkOut: "11:00 AM",
  cancellation: "Free cancellation up to 48 hours before arrival.",
};
// ═══════════════════════════════════════════════════════════════════════════
// End DEMO CONTENT.
// ═══════════════════════════════════════════════════════════════════════════

// LEGACY / TEMPORARY COMPATIBILITY (WFI-T03 Phase 5A): `rooms` still carries
// business facts (name, description, capacity/sleeps, bed info, size, view,
// price) that are now backend-authoritative via GET /api/v1/rooms and
// GET /api/v1/rooms/:slug (see features/rooms/api.ts). It remains exported
// only because booking review/confirmation have not migrated to real API
// data yet and are out of this phase's scope — new T03 code MUST NOT read
// business facts from this array. Once every consumer has migrated, this
// export (and the DEMO CONTENT block above it) should be removed.
export const rooms: Room[] = roomBases.map((base) => ({ ...base, ...demoRoomDetails[base.slug] }));

/**
 * Distinct categories, or `[]` while the roster only spans one — components
 * use this to hide a pointless single-tab filter.
 *
 * Generic over anything with an optional `category`, not just the legacy
 * `Room` type, so it works identically for real API-backed room data
 * (`RoomWithPresentation`, see features/rooms/api.ts) without a translation
 * or a second implementation.
 */
export function getRoomCategories<T extends { category?: string }>(list: T[]): string[] {
  const distinct = Array.from(new Set(list.map((room) => room.category).filter(Boolean))) as string[];
  return distinct.length > 1 ? distinct : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION-ONLY LOOKUP (WFI-T03 Phase 5A).
//
// Keyed by the SAME canonical backend room-type slug (room-concept-01/02/03)
// — this is a lookup by an already-correct identifier, never a translation
// between two different slug systems, and never a substitute for one.
//
// The backend/API remains the sole source of truth for every booking/
// business fact (name, description, capacity, bed info, size, view, rate,
// currency). This lookup carries ONLY frontend-owned decoration that has no
// backend equivalent at all: image, gallery, imageAlt, position, story,
// amenities, category. features/rooms/api.ts merges a validated backend room
// response with the entry here (matched by slug) before handing display data
// to UI code — it must never merge across mismatched slugs.
//
// Derived directly from the existing `rooms` array above rather than
// re-typing the same image/gallery/story/amenity content a second time.
// ═══════════════════════════════════════════════════════════════════════════
export type RoomPresentation = Pick<
  Room,
  "image" | "gallery" | "imageAlt" | "position" | "story" | "amenities" | "category"
>;

export const roomPresentationBySlug: Record<string, RoomPresentation> = Object.fromEntries(
  rooms.map((room) => [
    room.slug,
    {
      image: room.image,
      gallery: room.gallery,
      imageAlt: room.imageAlt,
      position: room.position,
      story: room.story,
      amenities: room.amenities,
      category: room.category,
    },
  ]),
);
