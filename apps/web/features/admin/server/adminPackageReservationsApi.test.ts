import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  fetchAdminPackageReservation,
  fetchAdminPackageReservations,
  updateAdminPackageReservationStatus,
} from "./adminPackageReservationsApi";

// What this client does with each answer the API can give: the three outcome
// states, the Cookie it forwards, and which payloads it refuses to render.

const originalFetch = globalThis.fetch;
const originalApiBaseUrl = process.env.API_BASE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiBaseUrl === undefined) delete process.env.API_BASE_URL;
  else process.env.API_BASE_URL = originalApiBaseUrl;
});

function apiRow(overrides: Record<string, unknown> = {}) {
  return {
    bookingReference: "TPP-23456789ABCD",
    package: { code: "T016", slug: "nile-dinner-cruise", title: "Nile Dinner Cruise" },
    variant: { key: "premium-service", label: "Premium service" },
    guestName: "Amira Hassan",
    guestEmail: "amira@example.test",
    guestPhone: "+201000000000",
    tourDate: "2026-10-01",
    adults: 2,
    children: 0,
    status: "pending",
    pricingStatus: "quoted",
    currency: "USD",
    totalAmountSnapshot: "300.00",
    createdAt: "2026-09-20T18:45:22.411Z",
    ...overrides,
  };
}

function respondWith(status: number, body: unknown): void {
  process.env.API_BASE_URL = "http://127.0.0.1:4000";
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

function respondWithRows(rows: unknown[]): void {
  respondWith(200, { data: { reservations: rows } });
}

describe("fetchAdminPackageReservations", () => {
  it("returns the reservations the API reported", async () => {
    respondWithRows([apiRow()]);

    const result = await fetchAdminPackageReservations();

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.reservations.length, 1);
    assert.deepEqual(result.data.reservations[0], apiRow());
  });

  it("preserves a null total for a confirmation-required reservation", async () => {
    respondWithRows([
      apiRow({ pricingStatus: "requires_confirmation", totalAmountSnapshot: null }),
    ]);

    const result = await fetchAdminPackageReservations();

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.reservations[0]!.totalAmountSnapshot, null, "never coerced to 0 or ''");
  });

  it("returns an empty list as a success, not an outage", async () => {
    respondWithRows([]);

    const result = await fetchAdminPackageReservations();

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.deepEqual(result.data.reservations, []);
  });

  it("forwards the caller's Cookie header verbatim, and only when given one", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let seen: HeadersInit | undefined;
    globalThis.fetch = async (url, init) => {
      seen = init?.headers;
      assert.equal(String(url), "http://127.0.0.1:4000/api/v1/admin/package-reservations");
      assert.equal(init?.cache, "no-store");
      return new Response(JSON.stringify({ data: { reservations: [] } }), { status: 200 });
    };

    await fetchAdminPackageReservations("admin_session=abc123");
    assert.deepEqual(seen, { Cookie: "admin_session=abc123" });

    await fetchAdminPackageReservations();
    assert.deepEqual(seen, {}, "no Cookie header is invented when none was supplied");
  });

  it("reports a refused session as unauthenticated, never as an empty list", async () => {
    respondWith(401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } });

    assert.deepEqual(await fetchAdminPackageReservations(), { state: "unauthenticated" });
  });

  it("reports an unreachable API as unavailable, never as an empty list", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED 10.0.0.5:4000");
    };

    const result = await fetchAdminPackageReservations();

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.equal(result.reason, "The hotel API could not be reached.");
    assert.ok(!result.reason.includes("10.0.0.5"), "no host or error text leaks into the page");
  });

  it("distinguishes a misconfigured API address from an outage", async () => {
    // A malformed value throws ApiConfigurationError whatever NODE_ENV is, so
    // this reaches the configuration branch without touching the environment
    // every other test in this process depends on.
    for (const configured of ["not-a-url", "ftp://example.test", "http://user:pw@example.test"]) {
      process.env.API_BASE_URL = configured;
      // Any attempt to reach the network here would be the bug under test.
      globalThis.fetch = async () => {
        throw new Error("fetch must not be attempted for a configuration fault");
      };

      const result = await fetchAdminPackageReservations();

      assert.equal(result.state, "unavailable");
      if (result.state !== "unavailable") return;
      assert.equal(
        result.reason,
        "The hotel system is not configured correctly.",
        `${configured} is a deployment fault, not an outage`,
      );
      assert.ok(!result.reason.includes(configured), "the configured value never reaches the page");
    }
  });

  it("reports a server error and an unreadable body as unavailable", async () => {
    respondWith(500, { error: { code: "X", message: "X" } });
    let result = await fetchAdminPackageReservations();
    assert.equal(result.state, "unavailable");
    if (result.state === "unavailable") assert.match(result.reason, /returned 500/);

    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => new Response("not json", { status: 200 });
    result = await fetchAdminPackageReservations();
    assert.equal(result.state, "unavailable");
    if (result.state === "unavailable") assert.match(result.reason, /unreadable/);
  });

  it("refuses a payload it cannot trust rather than rendering half a row", async () => {
    const cases: unknown[] = [
      apiRow({ bookingReference: 42 }),
      apiRow({ package: { code: "T016", slug: "x" } }),
      apiRow({ variant: null }),
      apiRow({ currency: "EGP" }),
      apiRow({ totalAmountSnapshot: 300 }),
      apiRow({ status: "refunded" }),
      apiRow({ pricingStatus: "estimated" }),
      apiRow({ adults: -1 }),
      apiRow({ children: 1.5 }),
      // The pricing pair contradicting itself, both ways round.
      apiRow({ pricingStatus: "quoted", totalAmountSnapshot: null }),
      apiRow({ pricingStatus: "requires_confirmation", totalAmountSnapshot: "300.00" }),
    ];

    for (const row of cases) {
      respondWithRows([row]);
      const result = await fetchAdminPackageReservations();
      assert.equal(result.state, "unavailable", `${JSON.stringify(row)} should be refused`);
    }
  });

  it("refuses the whole list when one row is unusable", async () => {
    respondWithRows([apiRow(), apiRow({ status: "nope" })]);

    const result = await fetchAdminPackageReservations();

    // A list silently missing a booking is worse than one that says so.
    assert.equal(result.state, "unavailable");
  });

  it("refuses an envelope that is not the shape the API promises", async () => {
    for (const body of [null, {}, { data: null }, { data: {} }, { data: { reservations: {} } }]) {
      respondWith(200, body);
      assert.equal((await fetchAdminPackageReservations()).state, "unavailable");
    }
  });

  it("carries no unexpected field through from the payload", async () => {
    respondWithRows([apiRow({ storageKey: "secret", packageId: "7" })]);

    const result = await fetchAdminPackageReservations();

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    const serialized = JSON.stringify(result.data.reservations[0]);
    assert.ok(!serialized.includes("storageKey"));
    assert.ok(!serialized.includes("packageId"));
  });
});

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    ...apiRow(),
    guestCountry: "Egypt",
    childAges: [7, 9],
    children: 2,
    specialRequests: "Window table if possible",
    adultUnitRateSnapshot: "100.00",
    childUnitRateSnapshot: "50.00",
    ...overrides,
  };
}

const REFERENCE = "TPP-23456789ABCD";

describe("fetchAdminPackageReservation", () => {
  it("returns the reservation the API reported", async () => {
    respondWith(200, { data: detailRow() });

    const result = await fetchAdminPackageReservation(REFERENCE);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.bookingReference, REFERENCE);
    assert.equal(result.data.guestCountry, "Egypt");
    assert.deepEqual(result.data.childAges, [7, 9]);
    assert.equal(result.data.specialRequests, "Window table if possible");
    assert.equal(result.data.adultUnitRateSnapshot, "100.00");
    assert.equal(result.data.childUnitRateSnapshot, "50.00");
  });

  it("preserves every nullable field as null", async () => {
    respondWith(200, {
      data: detailRow({
        children: 0,
        childAges: null,
        childUnitRateSnapshot: null,
        specialRequests: null,
        pricingStatus: "requires_confirmation",
        totalAmountSnapshot: null,
      }),
    });

    const result = await fetchAdminPackageReservation(REFERENCE);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.childAges, null);
    assert.equal(result.data.childUnitRateSnapshot, null);
    assert.equal(result.data.specialRequests, null);
    assert.equal(result.data.totalAmountSnapshot, null, "never coerced to 0 or ''");
  });

  it("encodes the reference into a single path segment", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let requested = "";
    globalThis.fetch = async (url, init) => {
      requested = String(url);
      assert.deepEqual(init?.headers, { Cookie: "admin_session=abc123" });
      assert.equal(init?.cache, "no-store");
      return new Response(JSON.stringify({ data: detailRow() }), { status: 200 });
    };

    await fetchAdminPackageReservation("TPP-A/B?C#D", "admin_session=abc123");

    assert.equal(
      requested,
      "http://127.0.0.1:4000/api/v1/admin/package-reservations/TPP-A%2FB%3FC%23D",
      "a slash, query or fragment must not change which endpoint is called",
    );
  });

  it("maps the API's not-found answer to not-found", async () => {
    respondWith(404, {
      error: { code: "PACKAGE_RESERVATION_NOT_FOUND", message: "Package reservation not found" },
    });

    assert.deepEqual(await fetchAdminPackageReservation(REFERENCE), { state: "not-found" });
  });

  it("maps a refused reference to invalid, kept apart from not-found", async () => {
    respondWith(400, {
      error: {
        code: "INVALID_PACKAGE_BOOKING_REFERENCE",
        message: "Invalid package booking reference",
      },
    });

    assert.deepEqual(await fetchAdminPackageReservation("nope"), { state: "invalid" });
  });

  it("treats the right status with the wrong body as an outage, not an answer", async () => {
    for (const [status, body] of [
      [404, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { error: { code: "INVALID_PACKAGE_BOOKING_REFERENCE", message: "Different wording" } }],
      [404, { nope: true }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      const result = await fetchAdminPackageReservation(REFERENCE);
      assert.equal(result.state, "unavailable", `${status} with an unknown body is not a decision`);
    }
  });

  it("reports a refused session as unauthenticated", async () => {
    respondWith(401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } });

    assert.deepEqual(await fetchAdminPackageReservation(REFERENCE), { state: "unauthenticated" });
  });

  it("reports an unreachable API as unavailable, never as a missing reservation", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED 10.0.0.5:4000");
    };

    const result = await fetchAdminPackageReservation(REFERENCE);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.equal(result.reason, "The hotel API could not be reached.");
    assert.ok(!result.reason.includes("10.0.0.5"));
  });

  it("reports a misconfigured API address distinctly", async () => {
    process.env.API_BASE_URL = "not-a-url";
    globalThis.fetch = async () => {
      throw new Error("fetch must not be attempted for a configuration fault");
    };

    const result = await fetchAdminPackageReservation(REFERENCE);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.equal(result.reason, "The hotel system is not configured correctly.");
  });

  it("refuses a detail payload it cannot trust", async () => {
    const cases: unknown[] = [
      detailRow({ guestCountry: null }),
      detailRow({ guestCountry: 42 }),
      detailRow({ adultUnitRateSnapshot: 100 }),
      detailRow({ adultUnitRateSnapshot: null }),
      detailRow({ childUnitRateSnapshot: 50 }),
      detailRow({ specialRequests: 7 }),
      detailRow({ childAges: "7,9" }),
      detailRow({ childAges: [7, -1] }),
      detailRow({ childAges: [7, 1.5] }),
      // Ages must agree with the child count the same row reports.
      detailRow({ childAges: [7], children: 2 }),
      detailRow({ status: "refunded" }),
    ];

    for (const row of cases) {
      respondWith(200, { data: row });
      const result = await fetchAdminPackageReservation(REFERENCE);
      assert.equal(result.state, "unavailable", `${JSON.stringify(row)} should be refused`);
    }
  });

  it("refuses an envelope that is not the shape the API promises", async () => {
    for (const body of [null, {}, { data: null }, { data: [] }]) {
      respondWith(200, body);
      assert.equal((await fetchAdminPackageReservation(REFERENCE)).state, "unavailable");
    }

    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => new Response("not json", { status: 200 });
    assert.equal((await fetchAdminPackageReservation(REFERENCE)).state, "unavailable");
  });

  it("carries no unexpected field through from the payload", async () => {
    respondWith(200, { data: detailRow({ packageId: "7", variantId: "9", storageKey: "secret" }) });

    const result = await fetchAdminPackageReservation(REFERENCE);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    const serialized = JSON.stringify(result.data);
    for (const leaked of ["packageId", "variantId", "storageKey"]) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not be carried across`);
    }
  });
});

describe("updateAdminPackageReservationStatus", () => {
  it("sends only the target status, as a PATCH to the status sub-resource", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ data: detailRow({ status: "confirmed" }) }), {
        status: 200,
      });
    };

    await updateAdminPackageReservationStatus(REFERENCE, "confirmed", "admin_session=abc123");

    assert.equal(
      seen.url,
      `http://127.0.0.1:4000/api/v1/admin/package-reservations/${REFERENCE}/status`,
    );
    assert.equal(seen.init?.method, "PATCH");
    assert.equal(seen.init?.cache, "no-store");
    assert.deepEqual(seen.init?.headers, {
      "content-type": "application/json",
      Cookie: "admin_session=abc123",
    });

    // The body carries the target and nothing else — no reference, no pricing,
    // no snapshot the API already holds.
    assert.deepEqual(JSON.parse(String(seen.init?.body)), { status: "confirmed" });
  });

  it("encodes the reference into a single path segment", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let requested = "";
    globalThis.fetch = async (url) => {
      requested = String(url);
      return new Response(JSON.stringify({ data: detailRow({ status: "cancelled" }) }), {
        status: 200,
      });
    };

    await updateAdminPackageReservationStatus("TPP-A/B?C#D", "cancelled");

    assert.equal(
      requested,
      "http://127.0.0.1:4000/api/v1/admin/package-reservations/TPP-A%2FB%3FC%23D/status",
      "a slash, query or fragment must not change which endpoint is called",
    );
  });

  it("returns the updated reservation, read back rather than assumed", async () => {
    for (const status of ["confirmed", "cancelled"] as const) {
      respondWith(200, { data: detailRow({ status }) });

      const result = await updateAdminPackageReservationStatus(REFERENCE, status);

      assert.equal(result.state, "ok");
      if (result.state !== "ok") return;
      assert.equal(result.data.status, status);
      // Snapshots come back untouched by the transition.
      assert.equal(result.data.adultUnitRateSnapshot, "100.00");
      assert.equal(result.data.totalAmountSnapshot, "300.00");
    }
  });

  it("maps a refused transition to invalid-transition, not to a failure", async () => {
    respondWith(409, {
      error: {
        code: "INVALID_PACKAGE_RESERVATION_STATUS_TRANSITION",
        message: "Package reservation status transition is not allowed",
      },
    });

    assert.deepEqual(await updateAdminPackageReservationStatus(REFERENCE, "confirmed"), {
      state: "invalid-transition",
    });
  });

  it("keeps each refusal the API can give distinct", async () => {
    const cases: Array<[number, unknown, string]> = [
      [
        400,
        { error: { code: "INVALID_PACKAGE_BOOKING_REFERENCE", message: "Invalid package booking reference" } },
        "invalid-reference",
      ],
      [
        400,
        { error: { code: "INVALID_PACKAGE_RESERVATION_STATUS", message: "Invalid package reservation status" } },
        "invalid-status",
      ],
      [
        404,
        { error: { code: "PACKAGE_RESERVATION_NOT_FOUND", message: "Package reservation not found" } },
        "not-found",
      ],
      [401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } }, "unauthenticated"],
    ];

    for (const [status, body, expected] of cases) {
      respondWith(status, body);
      const result = await updateAdminPackageReservationStatus(REFERENCE, "confirmed");
      assert.equal(result.state, expected, `${status} should be ${expected}`);
    }
  });

  it("treats the right status with the wrong body as an outage, never as a decision", async () => {
    for (const [status, body] of [
      [409, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { error: { code: "INVALID_PACKAGE_RESERVATION_STATUS", message: "Different wording" } }],
      [404, { nope: true }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      const result = await updateAdminPackageReservationStatus(REFERENCE, "confirmed");
      assert.equal(result.state, "unavailable");
    }
  });

  it("reports a dropped connection as unavailable, never as a refusal", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await updateAdminPackageReservationStatus(REFERENCE, "confirmed");

    // A mutation whose connection dropped may have been applied first, so the
    // only honest answer is that the outcome is unknown.
    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.equal(result.reason, "The hotel API could not be reached.");
    assert.ok(!result.reason.includes("10.0.0.5"));
  });

  it("reports a misconfigured API address without attempting the request", async () => {
    process.env.API_BASE_URL = "not-a-url";
    globalThis.fetch = async () => {
      throw new Error("fetch must not be attempted for a configuration fault");
    };

    const result = await updateAdminPackageReservationStatus(REFERENCE, "confirmed");

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.equal(result.reason, "The hotel system is not configured correctly.");
  });

  it("refuses a success payload it cannot trust", async () => {
    respondWith(200, { data: detailRow({ status: "refunded" }) });
    assert.equal((await updateAdminPackageReservationStatus(REFERENCE, "confirmed")).state, "unavailable");

    respondWith(200, { nope: true });
    assert.equal((await updateAdminPackageReservationStatus(REFERENCE, "confirmed")).state, "unavailable");
  });
});
