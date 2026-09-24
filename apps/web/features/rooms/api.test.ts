import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getRoomBySlug, getRooms } from "./api";
import { FALLBACK_ROOM_PRESENTATION, roomPresentationBySlug } from "./data/roomsData";

const originalFetch = globalThis.fetch;
const originalApiBaseUrl = process.env.API_BASE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiBaseUrl === undefined) delete process.env.API_BASE_URL;
  else process.env.API_BASE_URL = originalApiBaseUrl;
});

/** One valid backend room, so each test varies only the slug it cares about. */
function apiRoom(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    slug,
    name: `Room ${slug}`,
    shortDescription: "A short description.",
    description: "A longer description.",
    capacity: 2,
    bedType: "King",
    bedCount: 1,
    sizeSqm: "32",
    baseNightlyRate: "2500.00",
    view: "Garden",
    currency: "EGP",
    ...overrides,
  };
}

function respondWithRooms(rooms: unknown[]): void {
  process.env.API_BASE_URL = "http://127.0.0.1:4000";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: rooms }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

// The slugs the backend actually returns today. None of them has an entry in
// roomPresentationBySlug, and none is added by this test — that is the point.
const DEMO_SLUGS = ["demo-suite", "demo-standard", "demo-deluxe"];

describe("getRooms presentation fallback", () => {
  it("does not fail the list for the current demo slugs, which are genuinely unmapped", async () => {
    for (const slug of DEMO_SLUGS) {
      assert.equal(
        roomPresentationBySlug[slug],
        undefined,
        `${slug} must stay unmapped — this test is meaningless if a mapping was invented for it`,
      );
    }

    respondWithRooms(DEMO_SLUGS.map((slug) => apiRoom(slug)));

    const rooms = await getRooms();

    assert.equal(rooms.length, 3);
    assert.deepEqual(
      rooms.map((room) => room.slug),
      DEMO_SLUGS,
    );
  });

  it("gives an unmapped room the neutral fallback presentation", async () => {
    respondWithRooms([apiRoom("demo-suite")]);

    const [room] = await getRooms();

    assert.equal(room.image, FALLBACK_ROOM_PRESENTATION.image);
    assert.equal(room.imageAlt, FALLBACK_ROOM_PRESENTATION.imageAlt);
    assert.equal(room.position, FALLBACK_ROOM_PRESENTATION.position);
    // Unset editorial fields: the existing components already render nothing
    // for each of these rather than showing a placeholder.
    assert.equal(room.gallery, undefined);
    assert.equal(room.story, undefined);
    assert.equal(room.amenities, undefined);
    assert.equal(room.category, undefined);
  });

  it("keeps backend data authoritative for an unmapped room", async () => {
    respondWithRooms([
      apiRoom("demo-deluxe", {
        name: "Demo Deluxe",
        capacity: 4,
        bedType: "Twin",
        bedCount: 2,
        sizeSqm: "41",
        baseNightlyRate: "3750.50",
        view: "Pyramids",
      }),
    ]);

    const [room] = await getRooms();

    assert.equal(room.name, "Demo Deluxe");
    assert.equal(room.capacity, 4);
    assert.equal(room.sleeps, 4);
    assert.equal(room.bedType, "Twin");
    assert.equal(room.bedCount, 2);
    assert.equal(room.sizeSqm, 41);
    assert.equal(room.view, "Pyramids");
    assert.equal(room.currency, "EGP");
    // Money stays the backend's exact decimal string, fallback or not.
    assert.equal(room.baseNightlyRate, "3750.50");
  });

  it("leaves a mapped slug's own presentation untouched", async () => {
    const mapped = roomPresentationBySlug["room-concept-01"];
    assert.ok(mapped, "room-concept-01 is expected to stay mapped");

    respondWithRooms([apiRoom("room-concept-01")]);

    const [room] = await getRooms();

    assert.equal(room.image, mapped.image);
    assert.equal(room.imageAlt, mapped.imageAlt);
    assert.equal(room.position, mapped.position);
    assert.equal(room.story, mapped.story);
    assert.notEqual(room.image, FALLBACK_ROOM_PRESENTATION.image);
  });

  it("applies the fallback per room, not to the whole list", async () => {
    respondWithRooms([apiRoom("room-concept-01"), apiRoom("demo-standard")]);

    const [mappedRoom, unmappedRoom] = await getRooms();

    assert.equal(mappedRoom.image, roomPresentationBySlug["room-concept-01"].image);
    assert.equal(unmappedRoom.image, FALLBACK_ROOM_PRESENTATION.image);
  });

  it("treats a room with no DB media as unmapped-but-renderable, exactly as before", async () => {
    respondWithRooms([apiRoom("demo-suite", { images: [] })]);

    const [room] = await getRooms();

    assert.equal(room.image, FALLBACK_ROOM_PRESENTATION.image);
    assert.equal(room.imageAlt, FALLBACK_ROOM_PRESENTATION.imageAlt);
    assert.equal(room.gallery, undefined);
    assert.deepEqual(room.images, []);
  });

  it("still rejects a malformed room instead of papering over it with the fallback", async () => {
    // The fallback covers presentation only. A room missing a real backend
    // fact is still a genuine error, not something to render with defaults.
    respondWithRooms([apiRoom("demo-suite", { baseNightlyRate: 2500 })]);
    await assert.rejects(getRooms(), /baseNightlyRate/);

    respondWithRooms([apiRoom("demo-suite", { currency: "USD" })]);
    await assert.rejects(getRooms(), /currency/);
  });
});

const IMAGE_BASE = "https://media.example.test/media";

function apiImage(name: string, overrides: Record<string, unknown> = {}) {
  return {
    url: `${IMAGE_BASE}/${name}.webp`,
    altText: `Alt for ${name}`,
    width: 1600,
    height: 900,
    isCover: false,
    ...overrides,
  };
}

describe("getRooms DB-backed media", () => {
  it("uses the DB cover in place of the local presentation image", async () => {
    // room-concept-01 IS mapped locally, so this proves DB media wins over a
    // real local entry, not merely over the fallback.
    const local = roomPresentationBySlug["room-concept-01"];
    respondWithRooms([
      apiRoom("room-concept-01", {
        images: [apiImage("cover", { isCover: true }), apiImage("second")],
      }),
    ]);

    const [room] = await getRooms();

    assert.equal(room.image, `${IMAGE_BASE}/cover.webp`);
    assert.notEqual(room.image, local.image);
    assert.equal(room.imageAlt, "Alt for cover");
  });

  it("overrides the fallback image for an unmapped demo slug", async () => {
    respondWithRooms([
      apiRoom("demo-suite", { images: [apiImage("suite", { isCover: true })] }),
    ]);

    const [room] = await getRooms();

    assert.equal(room.image, `${IMAGE_BASE}/suite.webp`);
    assert.notEqual(room.image, FALLBACK_ROOM_PRESENTATION.image);
  });

  it("builds the gallery from every DB image, in the API's order", async () => {
    respondWithRooms([
      apiRoom("demo-deluxe", {
        images: [
          apiImage("one", { isCover: true }),
          apiImage("two"),
          apiImage("three"),
        ],
      }),
    ]);

    const [room] = await getRooms();

    assert.deepEqual(room.gallery, [
      `${IMAGE_BASE}/one.webp`,
      `${IMAGE_BASE}/two.webp`,
      `${IMAGE_BASE}/three.webp`,
    ]);
  });

  it("does not re-sort the API order, even if the cover is not first", async () => {
    // The API puts the cover first; this asserts the app would not quietly
    // reorder if it ever did not, while still picking the flagged cover.
    respondWithRooms([
      apiRoom("demo-standard", {
        images: [apiImage("a"), apiImage("b", { isCover: true }), apiImage("c")],
      }),
    ]);

    const [room] = await getRooms();

    assert.equal(room.image, `${IMAGE_BASE}/b.webp`, "the flagged cover represents the room");
    assert.deepEqual(
      room.gallery,
      [`${IMAGE_BASE}/a.webp`, `${IMAGE_BASE}/b.webp`, `${IMAGE_BASE}/c.webp`],
      "the gallery keeps the API's own order",
    );
  });

  it("falls back to the first DB image when none is flagged as cover", async () => {
    respondWithRooms([
      apiRoom("demo-suite", { images: [apiImage("first"), apiImage("second")] }),
    ]);

    const [room] = await getRooms();

    assert.equal(room.image, `${IMAGE_BASE}/first.webp`);
    assert.equal(room.imageAlt, "Alt for first");
  });

  it("renders a decorative image as empty alt, never the local placeholder's alt", async () => {
    respondWithRooms([
      apiRoom("room-concept-01", {
        images: [apiImage("cover", { isCover: true, altText: null })],
      }),
    ]);

    const [room] = await getRooms();

    assert.equal(room.imageAlt, "");
    assert.notEqual(room.imageAlt, roomPresentationBySlug["room-concept-01"].imageAlt);
  });

  it("keeps local story, amenities, category and position alongside DB media", async () => {
    const local = roomPresentationBySlug["room-concept-01"];
    respondWithRooms([
      apiRoom("room-concept-01", { images: [apiImage("cover", { isCover: true })] }),
    ]);

    const [room] = await getRooms();

    assert.equal(room.story, local.story);
    assert.deepEqual(room.amenities, local.amenities);
    assert.equal(room.category, local.category);
    assert.equal(room.position, local.position);
  });

  it("leaves every backend room fact untouched when media is present", async () => {
    respondWithRooms([
      apiRoom("demo-deluxe", {
        name: "Demo Deluxe",
        capacity: 4,
        baseNightlyRate: "3750.50",
        images: [apiImage("cover", { isCover: true })],
      }),
    ]);

    const [room] = await getRooms();

    assert.equal(room.name, "Demo Deluxe");
    assert.equal(room.capacity, 4);
    assert.equal(room.sleeps, 4);
    assert.equal(room.baseNightlyRate, "3750.50");
    assert.equal(room.currency, "EGP");
  });

  it("serves the detail endpoint from DB media too", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: apiRoom("demo-suite", { images: [apiImage("cover", { isCover: true })] }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const room = await getRoomBySlug("demo-suite");

    assert.equal(room?.image, `${IMAGE_BASE}/cover.webp`);
    assert.deepEqual(room?.gallery, [`${IMAGE_BASE}/cover.webp`]);
  });

  it("validates image fields explicitly instead of trusting the payload", async () => {
    const cases: Array<[unknown, RegExp]> = [
      [[{ ...apiImage("x"), url: "" }], /missing a url/],
      [[{ ...apiImage("x"), url: "not-a-url" }], /unusable url/],
      [[{ ...apiImage("x"), url: "ftp://example.test/x.webp" }], /non-http\(s\) url/],
      [[{ ...apiImage("x"), altText: 42 }], /invalid altText/],
      [[{ ...apiImage("x"), width: 0 }], /non-positive width/],
      [[{ ...apiImage("x"), height: -1 }], /non-positive height/],
      [[{ ...apiImage("x"), isCover: "yes" }], /non-boolean isCover/],
      [[null], /non-object image/],
      ["not-an-array", /non-array images/],
      [null, /non-array images/],
    ];

    for (const [images, expected] of cases) {
      respondWithRooms([apiRoom("demo-suite", { images })]);
      await assert.rejects(getRooms(), expected);
    }
  });

  it("does not carry unknown image fields through to the UI", async () => {
    respondWithRooms([
      apiRoom("demo-suite", {
        images: [{ ...apiImage("cover", { isCover: true }), storageKey: "media/secret.webp" }],
      }),
    ]);

    const [room] = await getRooms();

    assert.deepEqual(Object.keys(room.images[0]).sort(), [
      "altText",
      "height",
      "isCover",
      "url",
      "width",
    ]);
  });

  it("still renders when the API predates the images field", async () => {
    const room = apiRoom("demo-suite");
    delete (room as Record<string, unknown>).images;
    respondWithRooms([room]);

    const [result] = await getRooms();

    assert.deepEqual(result.images, []);
    assert.equal(result.image, FALLBACK_ROOM_PRESENTATION.image);
  });
});
