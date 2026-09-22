import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import type { AdminRoomTypeCreate } from "../types";

// Covers the two operations T02 adds to the room-type client: creating a room
// type and changing its capacity. The T01 reads and the nine-field update are
// unchanged and are not re-tested here.
//
// The real server-only module is imported, not a shadow copy — see the note in
// adminRoomsApi.test.ts about the `react-server` export condition. `fetch` is
// replaced per test; no network, no API, no database.

type ApiModule = typeof import("./adminRoomTypesApi.js");

let createAdminRoomType: ApiModule["createAdminRoomType"];
let updateAdminRoomTypeCapacity: ApiModule["updateAdminRoomTypeCapacity"];

const BASE = "http://127.0.0.1:4000";
const SLUG = "garden-suite";
const COOKIE = "tph_admin_session=abc123";

type RecordedCall = { url: string; init: RequestInit };

let calls: RecordedCall[] = [];
let realFetch: typeof globalThis.fetch;

const CREATE: AdminRoomTypeCreate = {
  slug: SLUG,
  name: "Garden Suite",
  capacity: 3,
  baseNightlyRate: "2400.50",
  sortOrder: 0,
  shortDescription: null,
  description: null,
  bedType: null,
  bedCount: null,
  sizeSqm: null,
  view: null,
};

/** A well-formed room-type detail, as the API returns one. */
const detailBody = (overrides: Record<string, unknown> = {}) => ({
  slug: SLUG,
  name: "Garden Suite",
  shortDescription: null,
  description: null,
  capacity: 3,
  bedType: null,
  bedCount: null,
  sizeSqm: null,
  view: null,
  baseNightlyRate: "2400.50",
  currency: "EGP",
  isActive: false,
  sortOrder: 0,
  roomCount: 0,
  createdAt: "2026-09-18T08:30:00.000Z",
  updatedAt: "2026-09-22T09:15:00.000Z",
  ...overrides,
});

const apiError = (code: string, message: string) => ({ error: { code, message } });

function respondWith(status: number, body: unknown): void {
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });

    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

function respondWithTransportFailure(): void {
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    throw new TypeError("fetch failed");
  }) as unknown as typeof globalThis.fetch;
}

before(async () => {
  process.env.API_BASE_URL = BASE;

  ({ createAdminRoomType, updateAdminRoomTypeCapacity } = await import("./adminRoomTypesApi.js"));

  realFetch = globalThis.fetch;
});

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("createAdminRoomType", () => {
  it("maps a well-formed 201, carrying the draft state through", async () => {
    respondWith(201, { data: detailBody() });

    const result = await createAdminRoomType(CREATE, COOKIE);

    assert.equal(result.state, "ok");
    assert.equal(result.state === "ok" && result.data.slug, SLUG);
    assert.equal(result.state === "ok" && result.data.isActive, false);
    assert.equal(result.state === "ok" && result.data.roomCount, 0);
    assert.equal(result.state === "ok" && result.data.baseNightlyRate, "2400.50");
  });

  describe("treats a malformed 201 as unavailable", () => {
    for (const [label, overrides] of [
      ["a numeric rate", { baseNightlyRate: 2400.5 }],
      ["a wrong currency", { currency: "USD" }],
      ["a string boolean", { isActive: "false" }],
      ["a non-canonical timestamp", { createdAt: "2026-09-18" }],
      ["a negative sort order", { sortOrder: -1 }],
      ["a different slug than requested", { slug: "someone-elses-suite" }],
    ] as const) {
      it(label, async () => {
        respondWith(201, { data: detailBody(overrides) });

        assert.equal((await createAdminRoomType(CREATE, COOKIE)).state, "unavailable");
      });
    }

    it("a missing envelope", async () => {
      respondWith(201, detailBody());

      assert.equal((await createAdminRoomType(CREATE, COOKIE)).state, "unavailable");
    });
  });

  describe("classifies known answers by status AND body", () => {
    it("400 with the exact create body is invalid-create", async () => {
      respondWith(400, apiError("INVALID_ROOM_TYPE_CREATE", "Invalid room type creation request"));

      assert.deepEqual(await createAdminRoomType(CREATE, COOKIE), { state: "invalid-create" });
    });

    it("409 with the exact slug-taken body is slug-taken", async () => {
      respondWith(409, apiError("ROOM_TYPE_SLUG_TAKEN", "Room type reference is already in use"));

      assert.deepEqual(await createAdminRoomType(CREATE, COOKIE), { state: "slug-taken" });
    });

    it("401 with the guard's own body is unauthenticated", async () => {
      respondWith(401, apiError("NOT_AUTHENTICATED", "Authentication required"));

      assert.deepEqual(await createAdminRoomType(CREATE, COOKIE), { state: "unauthenticated" });
    });

    it("400 with the right status but the wrong code is unavailable", async () => {
      respondWith(400, apiError("INVALID_ROOM_TYPE_UPDATE", "Invalid room type update"));

      assert.equal((await createAdminRoomType(CREATE, COOKIE)).state, "unavailable");
    });

    it("409 with the right code but the wrong message is unavailable", async () => {
      respondWith(409, apiError("ROOM_TYPE_SLUG_TAKEN", "Slug taken"));

      assert.equal((await createAdminRoomType(CREATE, COOKIE)).state, "unavailable");
    });

    it("the create body on a 409 rather than a 400 is unavailable", async () => {
      respondWith(409, apiError("INVALID_ROOM_TYPE_CREATE", "Invalid room type creation request"));

      assert.equal((await createAdminRoomType(CREATE, COOKIE)).state, "unavailable");
    });

    it("500 is unavailable", async () => {
      respondWith(500, apiError("INTERNAL", "boom"));

      assert.equal((await createAdminRoomType(CREATE, COOKIE)).state, "unavailable");
    });
  });

  it("sends one POST and never retries after a transport failure", async () => {
    respondWithTransportFailure();

    const result = await createAdminRoomType(CREATE, COOKIE);

    assert.equal(result.state, "unavailable", "the outcome is unknown, never 'failed'");
    assert.equal(calls.length, 1, "a dropped POST may already have created the room type");
  });

  it("posts to the collection with the cookie verbatim and no caching", async () => {
    respondWith(201, { data: detailBody() });

    await createAdminRoomType(CREATE, COOKIE);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/room-types`);
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal(calls[0]!.init.cache, "no-store");
    assert.deepEqual(calls[0]!.init.headers, { "Content-Type": "application/json", Cookie: COOKIE });
  });

  it("never sends isActive", async () => {
    respondWith(201, { data: detailBody() });

    await createAdminRoomType(CREATE, COOKIE);

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.ok(!("isActive" in body), "the API decides this, and the type has no such field");
    assert.deepEqual(Object.keys(body).sort(), [
      "baseNightlyRate",
      "bedCount",
      "bedType",
      "capacity",
      "description",
      "name",
      "shortDescription",
      "sizeSqm",
      "slug",
      "sortOrder",
      "view",
    ]);
  });
});

describe("updateAdminRoomTypeCapacity", () => {
  it("maps a well-formed 200", async () => {
    respondWith(200, { data: detailBody({ capacity: 6 }) });

    const result = await updateAdminRoomTypeCapacity(SLUG, 6, COOKIE);

    assert.equal(result.state, "ok");
    assert.equal(result.state === "ok" && result.data.capacity, 6);
  });

  it("treats a malformed 200 as unavailable", async () => {
    respondWith(200, { data: detailBody({ capacity: 0 }) });

    assert.equal((await updateAdminRoomTypeCapacity(SLUG, 6, COOKIE)).state, "unavailable");
  });

  describe("classifies known answers by status AND body", () => {
    const cases: [string, number, unknown, string][] = [
      ["the guard's 401", 401, apiError("NOT_AUTHENTICATED", "Authentication required"), "unauthenticated"],
      ["an invalid slug", 400, apiError("INVALID_ROOM_TYPE_SLUG", "Invalid room type slug"), "invalid-reference"],
      [
        "an invalid capacity",
        400,
        apiError("INVALID_ROOM_TYPE_CAPACITY", "Invalid room type capacity"),
        "invalid-capacity",
      ],
      ["a missing room type", 404, apiError("ROOM_TYPE_NOT_FOUND", "Room type not found"), "not-found"],
      [
        "a capacity below booked guests",
        409,
        apiError(
          "ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS",
          "Room type capacity conflicts with existing upcoming reservations",
        ),
        "capacity-conflict",
      ],
    ];

    for (const [label, status, body, expected] of cases) {
      it(`${label} maps to ${expected}`, async () => {
        respondWith(status, body);

        assert.equal((await updateAdminRoomTypeCapacity(SLUG, 2, COOKIE)).state, expected);
      });
    }

    it("keeps the two 400s apart", async () => {
      respondWith(400, apiError("INVALID_ROOM_TYPE_SLUG", "Invalid room type slug"));
      const slug = await updateAdminRoomTypeCapacity(SLUG, 2, COOKIE);

      respondWith(400, apiError("INVALID_ROOM_TYPE_CAPACITY", "Invalid room type capacity"));
      const capacity = await updateAdminRoomTypeCapacity(SLUG, 2, COOKIE);

      assert.deepEqual(slug, { state: "invalid-reference" });
      assert.deepEqual(capacity, { state: "invalid-capacity" });
    });

    it("a mismatched status and body is unavailable", async () => {
      // The conflict body on a 404 is not this contract.
      respondWith(
        404,
        apiError(
          "ROOM_TYPE_CAPACITY_BELOW_BOOKED_GUESTS",
          "Room type capacity conflicts with existing upcoming reservations",
        ),
      );

      assert.equal((await updateAdminRoomTypeCapacity(SLUG, 2, COOKIE)).state, "unavailable");
    });

    it("a 409 carrying a room-number body is unavailable", async () => {
      respondWith(409, apiError("ROOM_NUMBER_TAKEN", "Room number is already in use"));

      assert.equal((await updateAdminRoomTypeCapacity(SLUG, 2, COOKIE)).state, "unavailable");
    });
  });

  it("sends one PATCH and never retries after a transport failure", async () => {
    respondWithTransportFailure();

    const result = await updateAdminRoomTypeCapacity(SLUG, 2, COOKIE);

    assert.equal(result.state, "unavailable", "the outcome is unknown, never 'failed'");
    assert.equal(calls.length, 1, "a dropped PATCH may already have committed");
  });

  it("patches the capacity sub-resource with only the capacity in the body", async () => {
    respondWith(200, { data: detailBody({ capacity: 6 }) });

    await updateAdminRoomTypeCapacity(SLUG, 6, COOKIE);

    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/room-types/garden-suite/capacity`);
    assert.equal(calls[0]!.init.method, "PATCH");
    assert.equal(calls[0]!.init.cache, "no-store");
    assert.deepEqual(calls[0]!.init.headers, { "Content-Type": "application/json", Cookie: COOKIE });
    assert.equal(calls[0]!.init.body, JSON.stringify({ capacity: 6 }));
  });

  it("encodes the slug as one path segment", async () => {
    respondWith(404, apiError("ROOM_TYPE_NOT_FOUND", "Room type not found"));

    await updateAdminRoomTypeCapacity("garden/suite", 2, COOKIE);

    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/room-types/garden%2Fsuite/capacity`);
  });
});
