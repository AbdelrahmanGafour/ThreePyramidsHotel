import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";

// Covers the physical-room client's contract logic: which HTTP answers become
// which result, how a response body is validated, and how a URL is built.
//
// The real server-only module is imported, not a shadow copy. `import
// "server-only"` resolves to an empty module under the `react-server` export
// condition, which is the same condition Next.js uses for Server Components,
// so the test runner loads it exactly as the real runtime does. The boundary
// is untouched — `npm test` passes `--conditions=react-server`, and importing
// this module from client code still fails the build.
//
// `fetch` is replaced per test with a stand-in that records the call and
// returns a programmed response. No network, no API, no database.

type ApiModule = typeof import("./adminRoomsApi.js");

let fetchAdminPhysicalRooms: ApiModule["fetchAdminPhysicalRooms"];
let createAdminPhysicalRoom: ApiModule["createAdminPhysicalRoom"];
let updateAdminPhysicalRoom: ApiModule["updateAdminPhysicalRoom"];

const BASE = "http://127.0.0.1:4000";
const SLUG = "garden-suite";
const COOKIE = "tph_admin_session=abc123";

type RecordedCall = { url: string; init: RequestInit };

let calls: RecordedCall[] = [];
let realFetch: typeof globalThis.fetch;

/** A well-formed room, as the API returns one. */
const roomBody = (roomNumber: string, isActive = true) => ({
  roomNumber,
  isActive,
  createdAt: "2026-09-18T08:30:00.000Z",
  updatedAt: "2026-09-22T09:15:00.000Z",
});

const apiError = (code: string, message: string) => ({ error: { code, message } });

/** Programs the next fetch to answer with this status and body. */
function respondWith(status: number, body: unknown): void {
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });

    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

/** Programs the next fetch to answer with a body that is not JSON at all. */
function respondWithGarbage(status: number): void {
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });

    return new Response("<html>gateway</html>", {
      status,
      headers: { "Content-Type": "text/html" },
    });
  }) as unknown as typeof globalThis.fetch;
}

/** Programs the next fetch to reject, as a dropped connection does. */
function respondWithTransportFailure(): void {
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    throw new TypeError("fetch failed");
  }) as unknown as typeof globalThis.fetch;
}

before(async () => {
  // Pinned so URL assertions are exact rather than relying on the development
  // default.
  process.env.API_BASE_URL = BASE;

  ({ fetchAdminPhysicalRooms, createAdminPhysicalRoom, updateAdminPhysicalRoom } = await import(
    "./adminRoomsApi.js"
  ));

  realFetch = globalThis.fetch;
});

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fetchAdminPhysicalRooms", () => {
  it("maps a well-formed list", async () => {
    respondWith(200, { data: { rooms: [roomBody("D-101"), roomBody("D-102", false)] } });

    const result = await fetchAdminPhysicalRooms(SLUG, COOKIE);

    assert.equal(result.state, "ok");
    assert.deepEqual(result.state === "ok" && result.data.map((r) => [r.roomNumber, r.isActive]), [
      ["D-101", true],
      ["D-102", false],
    ]);
  });

  it("maps an empty list as a success", async () => {
    respondWith(200, { data: { rooms: [] } });

    assert.deepEqual(await fetchAdminPhysicalRooms(SLUG, COOKIE), { state: "ok", data: [] });
  });

  it("reads exactly the four contracted fields, producing no identifier", async () => {
    respondWith(200, {
      data: { rooms: [{ ...roomBody("D-101"), id: "42", roomTypeId: "7" }] },
    });

    const result = await fetchAdminPhysicalRooms(SLUG, COOKIE);

    assert.equal(result.state, "ok");
    const room = result.state === "ok" ? result.data[0]! : null;
    assert.deepEqual(Object.keys(room!).sort(), ["createdAt", "isActive", "roomNumber", "updatedAt"]);
    assert.ok(!("id" in room!) && !("roomTypeId" in room!), "an internal id must never be carried across");
  });

  it("preserves case and internal spaces exactly", async () => {
    respondWith(200, { data: { rooms: [roomBody("d-101"), roomBody("Ph-Suite"), roomBody("Suite 4")] } });

    const result = await fetchAdminPhysicalRooms(SLUG, COOKIE);

    assert.deepEqual(result.state === "ok" && result.data.map((r) => r.roomNumber), [
      "d-101",
      "Ph-Suite",
      "Suite 4",
    ]);
  });

  describe("rejects a malformed row, invalidating the whole list", () => {
    for (const [label, bad] of [
      ["a missing room number", { ...roomBody("X"), roomNumber: undefined }],
      ["an empty room number", { ...roomBody("X"), roomNumber: "" }],
      ["a non-string room number", { ...roomBody("X"), roomNumber: 101 }],
      ["a string boolean", { ...roomBody("X"), isActive: "true" }],
      ["a numeric boolean", { ...roomBody("X"), isActive: 1 }],
      ["a null boolean", { ...roomBody("X"), isActive: null }],
      ["a non-canonical createdAt", { ...roomBody("X"), createdAt: "2026-09-18" }],
      ["an offset updatedAt", { ...roomBody("X"), updatedAt: "2026-09-22T09:15:00+02:00" }],
      ["an unparseable timestamp", { ...roomBody("X"), createdAt: "not a date" }],
      ["a non-object row", "D-101"],
    ] as const) {
      it(label, async () => {
        respondWith(200, { data: { rooms: [roomBody("D-101"), bad] } });

        const result = await fetchAdminPhysicalRooms(SLUG, COOKIE);

        assert.equal(result.state, "unavailable", "one bad row must not be silently dropped");
      });
    }
  });

  describe("rejects an unexpected envelope", () => {
    for (const [label, body] of [
      ["a bare array", [roomBody("D-101")]],
      ["rooms at the top level", { rooms: [roomBody("D-101")] }],
      ["data as an array", { data: [roomBody("D-101")] }],
      ["rooms as an object", { data: { rooms: { "0": roomBody("D-101") } } }],
      ["no data key", { result: { rooms: [] } }],
    ] as const) {
      it(label, async () => {
        respondWith(200, body);

        assert.equal((await fetchAdminPhysicalRooms(SLUG, COOKIE)).state, "unavailable");
      });
    }
  });

  describe("classifies known answers by status AND body", () => {
    it("401 with the guard's own body is unauthenticated", async () => {
      respondWith(401, apiError("NOT_AUTHENTICATED", "Authentication required"));

      assert.deepEqual(await fetchAdminPhysicalRooms(SLUG, COOKIE), { state: "unauthenticated" });
    });

    it("401 from something else in front of the API is unavailable", async () => {
      respondWith(401, apiError("PROXY_AUTH_REQUIRED", "Gateway credentials required"));

      assert.equal((await fetchAdminPhysicalRooms(SLUG, COOKIE)).state, "unavailable");
    });

    it("400 with the exact slug body is invalid-reference", async () => {
      respondWith(400, apiError("INVALID_ROOM_TYPE_SLUG", "Invalid room type slug"));

      assert.deepEqual(await fetchAdminPhysicalRooms(SLUG, COOKIE), { state: "invalid-reference" });
    });

    it("404 with the exact room-type body is not-found", async () => {
      respondWith(404, apiError("ROOM_TYPE_NOT_FOUND", "Room type not found"));

      assert.deepEqual(await fetchAdminPhysicalRooms(SLUG, COOKIE), { state: "not-found" });
    });

    it("400 with the right code but a different message is unavailable", async () => {
      respondWith(400, apiError("INVALID_ROOM_TYPE_SLUG", "Slug is invalid"));

      assert.equal((await fetchAdminPhysicalRooms(SLUG, COOKIE)).state, "unavailable");
    });

    it("404 carrying a room-number body, not a room-type one, is unavailable", async () => {
      respondWith(404, apiError("ROOM_NOT_FOUND", "Room not found"));

      assert.equal((await fetchAdminPhysicalRooms(SLUG, COOKIE)).state, "unavailable");
    });
  });

  it("treats 500, unreadable bodies and transport failure as unavailable", async () => {
    respondWith(500, apiError("INTERNAL", "boom"));
    assert.equal((await fetchAdminPhysicalRooms(SLUG, COOKIE)).state, "unavailable");

    respondWithGarbage(200);
    assert.equal((await fetchAdminPhysicalRooms(SLUG, COOKIE)).state, "unavailable");

    respondWithTransportFailure();
    assert.equal((await fetchAdminPhysicalRooms(SLUG, COOKIE)).state, "unavailable");
  });

  it("sends one GET, with the cookie verbatim and no caching", async () => {
    respondWith(200, { data: { rooms: [] } });

    await fetchAdminPhysicalRooms(SLUG, COOKIE);

    assert.equal(calls.length, 1, "exactly one request");
    assert.equal(calls[0]!.init.method, "GET");
    assert.equal(calls[0]!.init.cache, "no-store");
    assert.deepEqual(calls[0]!.init.headers, { Cookie: COOKIE });
    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/room-types/garden-suite/rooms`);
  });

  it("sends no Cookie header at all when there is no session", async () => {
    respondWith(200, { data: { rooms: [] } });

    await fetchAdminPhysicalRooms(SLUG);

    assert.deepEqual(calls[0]!.init.headers, {});
  });
});

describe("createAdminPhysicalRoom", () => {
  it("maps a well-formed 201", async () => {
    respondWith(201, { data: roomBody("D-101") });

    const result = await createAdminPhysicalRoom(SLUG, { roomNumber: "D-101" }, COOKIE);

    assert.equal(result.state, "ok");
    assert.equal(result.state === "ok" && result.data.roomNumber, "D-101");
    assert.equal(result.state === "ok" && result.data.isActive, true);
  });

  it("treats a malformed 201 as unavailable", async () => {
    respondWith(201, { data: { roomNumber: "D-101", isActive: "yes" } });

    assert.equal((await createAdminPhysicalRoom(SLUG, { roomNumber: "D-101" }, COOKIE)).state, "unavailable");
  });

  describe("classifies known answers by status AND body", () => {
    const cases: [string, number, unknown, string][] = [
      ["the guard's 401", 401, apiError("NOT_AUTHENTICATED", "Authentication required"), "unauthenticated"],
      ["an invalid slug", 400, apiError("INVALID_ROOM_TYPE_SLUG", "Invalid room type slug"), "invalid-reference"],
      ["an invalid body", 400, apiError("INVALID_ROOM_CREATE", "Invalid room creation request"), "invalid-create"],
      ["a missing room type", 404, apiError("ROOM_TYPE_NOT_FOUND", "Room type not found"), "not-found"],
      ["a taken number", 409, apiError("ROOM_NUMBER_TAKEN", "Room number is already in use"), "room-number-taken"],
    ];

    for (const [label, status, body, expected] of cases) {
      it(`${label} maps to ${expected}`, async () => {
        respondWith(status, body);

        assert.equal((await createAdminPhysicalRoom(SLUG, { roomNumber: "D-101" }, COOKIE)).state, expected);
      });
    }

    it("shares one contract for exact and case-insensitive duplicates", async () => {
      // The API answers the same body for both unique indexes, so the client
      // has one state for both — and never sees a constraint name.
      respondWith(409, apiError("ROOM_NUMBER_TAKEN", "Room number is already in use"));
      const exact = await createAdminPhysicalRoom(SLUG, { roomNumber: "D-101" }, COOKIE);

      respondWith(409, apiError("ROOM_NUMBER_TAKEN", "Room number is already in use"));
      const caseOnly = await createAdminPhysicalRoom(SLUG, { roomNumber: "d-101" }, COOKIE);

      assert.deepEqual(exact, { state: "room-number-taken" });
      assert.deepEqual(caseOnly, { state: "room-number-taken" });
    });

    it("does not read a room-update body on this endpoint", async () => {
      respondWith(400, apiError("INVALID_ROOM_UPDATE", "Invalid room update"));

      assert.equal((await createAdminPhysicalRoom(SLUG, { roomNumber: "D-101" }, COOKIE)).state, "unavailable");
    });

    it("treats a bare 409 with no body as unavailable", async () => {
      respondWithGarbage(409);

      assert.equal((await createAdminPhysicalRoom(SLUG, { roomNumber: "D-101" }, COOKIE)).state, "unavailable");
    });
  });

  it("sends one POST and never retries after a transport failure", async () => {
    respondWithTransportFailure();

    const result = await createAdminPhysicalRoom(SLUG, { roomNumber: "D-101" }, COOKIE);

    assert.equal(result.state, "unavailable", "the outcome is unknown, never 'failed'");
    assert.equal(calls.length, 1, "a dropped POST may already have committed; it must not be repeated");
  });

  it("sends the room number verbatim as a JSON body", async () => {
    respondWith(201, { data: roomBody("Suite 4") });

    await createAdminPhysicalRoom(SLUG, { roomNumber: "  Suite 4  " }, COOKIE);

    assert.equal(calls[0]!.init.method, "POST");
    assert.equal(calls[0]!.init.cache, "no-store");
    assert.deepEqual(calls[0]!.init.headers, { "Content-Type": "application/json", Cookie: COOKIE });
    assert.equal(calls[0]!.init.body, JSON.stringify({ roomNumber: "  Suite 4  " }), "never trimmed here");
  });
});

describe("updateAdminPhysicalRoom", () => {
  it("maps a well-formed 200 with the same number", async () => {
    respondWith(200, { data: roomBody("D-101", false) });

    const result = await updateAdminPhysicalRoom("D-101", { isActive: false }, COOKIE);

    assert.equal(result.state, "ok");
    assert.equal(result.state === "ok" && result.data.roomNumber, "D-101");
    assert.equal(result.state === "ok" && result.data.isActive, false);
  });

  it("accepts a DIFFERENT returned number, because that is what a rename is", async () => {
    // The room-type detail client checks the returned slug against the request;
    // doing that here would reject exactly the case this endpoint exists for.
    respondWith(200, { data: roomBody("D-201") });

    const result = await updateAdminPhysicalRoom("D-101", { roomNumber: "D-201" }, COOKIE);

    assert.equal(result.state, "ok");
    assert.equal(result.state === "ok" && result.data.roomNumber, "D-201");
  });

  it("accepts a rename that differs only by case", async () => {
    respondWith(200, { data: roomBody("d-101") });

    const result = await updateAdminPhysicalRoom("D-101", { roomNumber: "d-101" }, COOKIE);

    assert.equal(result.state === "ok" && result.data.roomNumber, "d-101");
  });

  it("treats a malformed 200 as unavailable", async () => {
    respondWith(200, { data: { roomNumber: "D-101", isActive: true, createdAt: "2026-09-18" } });

    assert.equal((await updateAdminPhysicalRoom("D-101", { isActive: true }, COOKIE)).state, "unavailable");
  });

  describe("classifies known answers by status AND body", () => {
    const cases: [string, number, unknown, string][] = [
      ["the guard's 401", 401, apiError("NOT_AUTHENTICATED", "Authentication required"), "unauthenticated"],
      ["a malformed route number", 400, apiError("INVALID_ROOM_NUMBER", "Invalid room number"), "invalid-reference"],
      ["a malformed body", 400, apiError("INVALID_ROOM_UPDATE", "Invalid room update"), "invalid-update"],
      ["a missing room", 404, apiError("ROOM_NOT_FOUND", "Room not found"), "not-found"],
      ["a taken number", 409, apiError("ROOM_NUMBER_TAKEN", "Room number is already in use"), "room-number-taken"],
      [
        "upcoming reservations",
        409,
        apiError("ROOM_HAS_FUTURE_RESERVATIONS", "Room has upcoming reservations"),
        "has-future-reservations",
      ],
    ];

    for (const [label, status, body, expected] of cases) {
      it(`${label} maps to ${expected}`, async () => {
        respondWith(status, body);

        assert.equal((await updateAdminPhysicalRoom("D-101", { isActive: false }, COOKIE)).state, expected);
      });
    }

    it("keeps the route and body 400s apart", async () => {
      respondWith(400, apiError("INVALID_ROOM_NUMBER", "Invalid room number"));
      const route = await updateAdminPhysicalRoom("D-101", { roomNumber: "D/1" }, COOKIE);

      respondWith(400, apiError("INVALID_ROOM_UPDATE", "Invalid room update"));
      const body = await updateAdminPhysicalRoom("D-101", { roomNumber: "D/1" }, COOKIE);

      assert.deepEqual(route, { state: "invalid-reference" });
      assert.deepEqual(body, { state: "invalid-update" });
    });

    it("does not read a room-type not-found body on this endpoint", async () => {
      respondWith(404, apiError("ROOM_TYPE_NOT_FOUND", "Room type not found"));

      assert.equal((await updateAdminPhysicalRoom("D-101", { isActive: true }, COOKIE)).state, "unavailable");
    });
  });

  it("sends one PATCH and never retries after a transport failure", async () => {
    respondWithTransportFailure();

    const result = await updateAdminPhysicalRoom("D-101", { roomNumber: "D-201" }, COOKIE);

    assert.equal(result.state, "unavailable", "the outcome is unknown, never 'failed'");
    assert.equal(calls.length, 1, "a dropped PATCH may already have committed; it must not be repeated");
  });

  it("sends the update verbatim as a JSON body", async () => {
    respondWith(200, { data: roomBody("D-201", false) });

    await updateAdminPhysicalRoom("D-101", { roomNumber: "D-201", isActive: false }, COOKIE);

    assert.equal(calls[0]!.init.method, "PATCH");
    assert.equal(calls[0]!.init.cache, "no-store");
    assert.deepEqual(calls[0]!.init.headers, { "Content-Type": "application/json", Cookie: COOKIE });
    assert.equal(calls[0]!.init.body, JSON.stringify({ roomNumber: "D-201", isActive: false }));
  });
});

describe("path encoding", () => {
  it("encodes the room-type slug as one segment", async () => {
    respondWith(200, { data: { rooms: [] } });

    await fetchAdminPhysicalRooms("garden/suite", COOKIE);

    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/room-types/garden%2Fsuite/rooms`);
  });

  it("percent-encodes an internal space in a room number", async () => {
    respondWith(200, { data: roomBody("Suite 4") });

    await updateAdminPhysicalRoom("Suite 4", { isActive: true }, COOKIE);

    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/rooms/Suite%204`);
    assert.doesNotMatch(calls[0]!.url, / /, "a raw space is not a legal URL character");
  });

  it("leaves room-number case untouched", async () => {
    respondWith(200, { data: roomBody("Ph-Suite") });
    await updateAdminPhysicalRoom("Ph-Suite", { isActive: true }, COOKIE);
    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/rooms/Ph-Suite`);

    calls = [];
    respondWith(200, { data: roomBody("ph-suite") });
    await updateAdminPhysicalRoom("ph-suite", { isActive: true }, COOKIE);
    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/rooms/ph-suite`);
  });

  it("does not trim the identifier before encoding it", async () => {
    // A padded number is not the name of anything, and the API says so with
    // INVALID_ROOM_NUMBER. Trimming here would hide that by silently asking
    // about a different room.
    respondWith(400, apiError("INVALID_ROOM_NUMBER", "Invalid room number"));

    await updateAdminPhysicalRoom(" D-101 ", { isActive: true }, COOKIE);

    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/rooms/%20D-101%20`);
  });
});
