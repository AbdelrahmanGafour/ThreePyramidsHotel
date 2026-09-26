import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createAdminPackage,
  deleteAdminPackage,
  createAdminPackageVariant,
  deleteAdminPackageVariant,
  replaceAdminPackageContent,
  replaceAdminPackageItinerary,
  reorderAdminPackageVariants,
  setAdminPackageDefaultVariant,
  fetchAdminPackage,
  fetchAdminPackages,
  replaceAdminPackageRates,
  updateAdminPackage,
  updateAdminPackageStatus,
  updateAdminPackageVariant,
} from "./adminPackagesApi";

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
    code: "T016",
    slug: "nile-dinner-cruise",
    title: "Nile Dinner Cruise",
    summary: "An evening on the water.",
    durationLabel: "Evening",
    scheduleLabel: "Daily",
    requiresPriceConfirmation: false,
    isActive: true,
    sortOrder: 16,
    managementSource: "brochure",
    variantCount: 2,
    defaultVariantLabel: "Standard service",
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
  respondWith(200, { data: { packages: rows } });
}

describe("fetchAdminPackages", () => {
  it("returns the catalogue the API reported", async () => {
    respondWithRows([apiRow()]);

    const result = await fetchAdminPackages();

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.packages.length, 1);
    assert.deepEqual(result.data.packages[0], apiRow());
  });

  it("keeps the slug for the detail route this list will link to", async () => {
    respondWithRows([apiRow()]);

    const result = await fetchAdminPackages();

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.packages[0]!.slug, "nile-dinner-cruise");
  });

  it("preserves both ownerships and both active states", async () => {
    respondWithRows([
      apiRow({ code: "T001", managementSource: "brochure", isActive: true }),
      apiRow({ code: "A001", managementSource: "admin", isActive: false }),
    ]);

    const result = await fetchAdminPackages();

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.deepEqual(
      result.data.packages.map((item) => [item.managementSource, item.isActive]),
      [["brochure", true], ["admin", false]],
    );
  });

  it("preserves a zero-variant journey and its null default", async () => {
    respondWithRows([apiRow({ variantCount: 0, defaultVariantLabel: null })]);

    const result = await fetchAdminPackages();

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.packages[0]!.variantCount, 0);
    assert.equal(result.data.packages[0]!.defaultVariantLabel, null);
  });

  it("returns an empty catalogue as a success, not an outage", async () => {
    respondWithRows([]);

    const result = await fetchAdminPackages();

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.deepEqual(result.data.packages, []);
  });

  it("forwards the caller's Cookie header verbatim, and only when given one", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let seen: HeadersInit | undefined;
    globalThis.fetch = async (url, init) => {
      seen = init?.headers;
      assert.equal(String(url), "http://127.0.0.1:4000/api/v1/admin/packages");
      assert.equal(init?.cache, "no-store");
      return new Response(JSON.stringify({ data: { packages: [] } }), { status: 200 });
    };

    await fetchAdminPackages("admin_session=abc123");
    assert.deepEqual(seen, { Cookie: "admin_session=abc123" });

    await fetchAdminPackages();
    assert.deepEqual(seen, {}, "no Cookie header is invented when none was supplied");
  });

  it("reports a refused session as unauthenticated, never as an empty catalogue", async () => {
    respondWith(401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } });

    assert.deepEqual(await fetchAdminPackages(), { state: "unauthenticated" });
  });

  it("reports an unreachable API as unavailable, never as an empty catalogue", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED 10.0.0.5:4000");
    };

    const result = await fetchAdminPackages();

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.equal(result.reason, "The hotel API could not be reached.");
    assert.ok(!result.reason.includes("10.0.0.5"), "no host or error text leaks into the page");
  });

  it("distinguishes a misconfigured API address from an outage", async () => {
    process.env.API_BASE_URL = "not-a-url";
    globalThis.fetch = async () => {
      throw new Error("fetch must not be attempted for a configuration fault");
    };

    const result = await fetchAdminPackages();

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.equal(result.reason, "The hotel system is not configured correctly.");
  });

  it("reports a server error and an unreadable body as unavailable", async () => {
    respondWith(500, { error: { code: "X", message: "X" } });
    let result = await fetchAdminPackages();
    assert.equal(result.state, "unavailable");
    if (result.state === "unavailable") assert.match(result.reason, /returned 500/);

    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => new Response("not json", { status: 200 });
    result = await fetchAdminPackages();
    assert.equal(result.state, "unavailable");
    if (result.state === "unavailable") assert.match(result.reason, /unreadable/);
  });

  it("refuses a payload it cannot trust rather than rendering half a row", async () => {
    const cases: unknown[] = [
      apiRow({ code: 42 }),
      apiRow({ slug: null }),
      apiRow({ title: undefined }),
      apiRow({ summary: 7 }),
      apiRow({ durationLabel: 7 }),
      apiRow({ isActive: "true" }),
      apiRow({ requiresPriceConfirmation: 1 }),
      apiRow({ managementSource: "seed" }),
      apiRow({ managementSource: true }),
      apiRow({ variantCount: -1 }),
      apiRow({ variantCount: 1.5 }),
      apiRow({ sortOrder: -1 }),
      apiRow({ defaultVariantLabel: 7 }),
    ];

    for (const row of cases) {
      respondWithRows([row]);
      const result = await fetchAdminPackages();
      assert.equal(result.state, "unavailable", `${JSON.stringify(row)} should be refused`);
    }
  });

  it("refuses the whole catalogue when one row is unusable", async () => {
    respondWithRows([apiRow(), apiRow({ managementSource: "nope" })]);

    // A catalogue silently missing an offering is worse than one that says so.
    assert.equal((await fetchAdminPackages()).state, "unavailable");
  });

  it("refuses an envelope that is not the shape the API promises", async () => {
    for (const body of [null, {}, { data: null }, { data: {} }, { data: { packages: {} } }]) {
      respondWith(200, body);
      assert.equal((await fetchAdminPackages()).state, "unavailable");
    }
  });

  it("carries no unexpected field through from the payload", async () => {
    respondWithRows([apiRow({ seed_managed: true, id: "42" })]);

    const result = await fetchAdminPackages();

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    const serialized = JSON.stringify(result.data.packages[0]);
    for (const leaked of ["seed_managed", '"id"']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not be carried across`);
    }
  });
});

const SLUG = "nile-dinner-cruise";

function detailBody(overrides: Record<string, unknown> = {}) {
  return {
    ...apiRow(),
    description: "A longer passage about the cruise.",
    operatingDays: ["monday", "tuesday"],
    itinerary: [{ dayNumber: 1, heading: "Boarding", body: "Meet at the quay." }],
    content: { included: ["Dinner"], excluded: ["Drinks"], notes: ["Smart dress."] },
    variants: [
      {
        key: "standard-service", label: "Standard service", isDefault: true, sortOrder: 1,
        childMinAge: 6, childMaxAge: 12, childDiscountPercent: "50.00",
        rates: [
          { minPartySize: 1, maxPartySize: 1, adultUnitRate: "100.00", currency: "USD" },
          { minPartySize: 3, maxPartySize: null, adultUnitRate: "80.00", currency: "USD" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("fetchAdminPackage", () => {
  it("returns the journey the API reported", async () => {
    respondWith(200, { data: detailBody() });

    const result = await fetchAdminPackage(SLUG);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.code, "T016");
    assert.equal(result.data.description, "A longer passage about the cruise.");
    assert.deepEqual(result.data.operatingDays, ["monday", "tuesday"]);
    assert.deepEqual(result.data.content, {
      included: ["Dinner"], excluded: ["Drinks"], notes: ["Smart dress."],
    });
    assert.equal(result.data.variants.length, 1);
    assert.equal(result.data.variants[0]!.rates.length, 2);
  });

  it("preserves variant and rate-tier order exactly as received", async () => {
    respondWith(200, {
      data: detailBody({
        variants: [
          { key: "b", label: "B", isDefault: false, sortOrder: 1,
            childMinAge: null, childMaxAge: null, childDiscountPercent: null,
            rates: [
              { minPartySize: 5, maxPartySize: null, adultUnitRate: "10.00", currency: "USD" },
              { minPartySize: 1, maxPartySize: 1, adultUnitRate: "99.00", currency: "USD" },
            ] },
          { key: "a", label: "A", isDefault: true, sortOrder: 2,
            childMinAge: null, childMaxAge: null, childDiscountPercent: null, rates: [] },
        ],
      }),
    });

    const result = await fetchAdminPackage(SLUG);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.deepEqual(result.data.variants.map((item) => item.key), ["b", "a"]);
    assert.deepEqual(
      result.data.variants[0]!.rates.map((tier) => tier.minPartySize),
      [5, 1],
      "the client never re-sorts what the API ordered",
    );
  });

  it("preserves empty collections and null wording", async () => {
    respondWith(200, {
      data: detailBody({
        description: null, operatingDays: null, summary: null,
        itinerary: [], content: { included: [], excluded: [], notes: [] }, variants: [],
      }),
    });

    const result = await fetchAdminPackage(SLUG);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.description, null);
    assert.equal(result.data.operatingDays, null);
    assert.deepEqual(result.data.itinerary, []);
    assert.deepEqual(result.data.variants, []);
  });

  it("encodes the slug into a single path segment", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let requested = "";
    globalThis.fetch = async (url, init) => {
      requested = String(url);
      assert.deepEqual(init?.headers, { Cookie: "admin_session=abc123" });
      assert.equal(init?.cache, "no-store");
      return new Response(JSON.stringify({ data: detailBody() }), { status: 200 });
    };

    await fetchAdminPackage("a/b?c#d", "admin_session=abc123");

    assert.equal(
      requested,
      "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb%3Fc%23d",
      "a slash, query or fragment must not change which endpoint is called",
    );
  });

  it("maps the API's not-found answer to not-found", async () => {
    respondWith(404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } });

    assert.deepEqual(await fetchAdminPackage(SLUG), { state: "not-found" });
  });

  it("maps a refused slug to invalid, kept apart from not-found", async () => {
    respondWith(400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid package slug" } });

    assert.deepEqual(await fetchAdminPackage("NOPE"), { state: "invalid" });
  });

  it("treats the right status with the wrong body as an outage, not an answer", async () => {
    for (const [status, body] of [
      [404, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Different wording" } }],
      [404, { nope: true }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await fetchAdminPackage(SLUG)).state, "unavailable");
    }
  });

  it("reports a refused session and an unreachable API distinctly", async () => {
    respondWith(401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } });
    assert.deepEqual(await fetchAdminPackage(SLUG), { state: "unauthenticated" });

    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED 10.0.0.5:4000");
    };
    const result = await fetchAdminPackage(SLUG);
    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"));
  });

  it("refuses a detail payload it cannot trust", async () => {
    const cases: unknown[] = [
      detailBody({ description: 7 }),
      detailBody({ operatingDays: [1, 2] }),
      detailBody({ itinerary: "none" }),
      detailBody({ itinerary: [{ dayNumber: "1", heading: null, body: "x" }] }),
      detailBody({ content: { included: [], excluded: [] } }),
      detailBody({ content: { included: [1], excluded: [], notes: [] } }),
      detailBody({ variants: "none" }),
      // A half-set child rule cannot exist in the database.
      detailBody({ variants: [{ key: "k", label: "L", isDefault: true, sortOrder: 1,
        childMinAge: 6, childMaxAge: null, childDiscountPercent: null, rates: [] }] }),
      // Money as a number would mean precision was already lost upstream.
      detailBody({ variants: [{ key: "k", label: "L", isDefault: true, sortOrder: 1,
        childMinAge: null, childMaxAge: null, childDiscountPercent: null,
        rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: 100, currency: "USD" }] }] }),
      detailBody({ variants: [{ key: "k", label: "L", isDefault: true, sortOrder: 1,
        childMinAge: null, childMaxAge: null, childDiscountPercent: null,
        rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: "10.00", currency: "EGP" }] }] }),
      detailBody({ variants: [{ key: "k", label: "L", isDefault: true, sortOrder: 1,
        childMinAge: null, childMaxAge: null, childDiscountPercent: null,
        rates: [{ minPartySize: 3, maxPartySize: 1, adultUnitRate: "10.00", currency: "USD" }] }] }),
    ];

    for (const body of cases) {
      respondWith(200, { data: body });
      assert.equal((await fetchAdminPackage(SLUG)).state, "unavailable",
        `${JSON.stringify(body)} should be refused`);
    }
  });

  it("carries no unexpected field through from the payload", async () => {
    respondWith(200, { data: detailBody({ seed_managed: false, id: "42" }) });

    const result = await fetchAdminPackage(SLUG);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    const serialized = JSON.stringify(result.data);
    for (const leaked of ["seed_managed", '"id"']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not be carried across`);
    }
  });
});

describe("updateAdminPackageStatus", () => {
  it("sends only isActive, as a PATCH to the status sub-resource", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ data: detailBody({ isActive: false }) }), { status: 200 });
    };

    await updateAdminPackageStatus(SLUG, false, "admin_session=abc123");

    assert.equal(seen.url, `http://127.0.0.1:4000/api/v1/admin/packages/${SLUG}/status`);
    assert.equal(seen.init?.method, "PATCH");
    assert.equal(seen.init?.cache, "no-store");
    assert.deepEqual(seen.init?.headers, {
      "content-type": "application/json",
      Cookie: "admin_session=abc123",
    });

    // The body carries the target and nothing else — no slug, no wording, no
    // ownership the API already holds.
    const body = JSON.parse(String(seen.init?.body));
    assert.deepEqual(body, { isActive: false });
    assert.deepEqual(Object.keys(body), ["isActive"]);
  });

  it("encodes the slug into a single path segment", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let requested = "";
    globalThis.fetch = async (url) => {
      requested = String(url);
      return new Response(JSON.stringify({ data: detailBody() }), { status: 200 });
    };

    await updateAdminPackageStatus("a/b?c#d", true);

    assert.equal(
      requested,
      "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb%3Fc%23d/status",
      "a slash, query or fragment must not change which endpoint is called",
    );
  });

  it("returns the updated journey, read back rather than assumed", async () => {
    for (const isActive of [true, false]) {
      respondWith(200, { data: detailBody({ isActive }) });

      const result = await updateAdminPackageStatus(SLUG, isActive);

      assert.equal(result.state, "ok");
      if (result.state !== "ok") return;
      assert.equal(result.data.isActive, isActive);
    }
  });

  it("leaves ownership exactly as the API reported it", async () => {
    for (const managementSource of ["brochure", "admin"] as const) {
      respondWith(200, { data: detailBody({ managementSource, isActive: false }) });

      const result = await updateAdminPackageStatus(SLUG, false);

      assert.equal(result.state, "ok");
      if (result.state !== "ok") return;
      assert.equal(result.data.managementSource, managementSource);
    }
  });

  it("treats a same-state answer as an ordinary success", async () => {
    // The API is idempotent here; asking twice is not an error at any layer.
    respondWith(200, { data: detailBody({ isActive: true }) });

    const first = await updateAdminPackageStatus(SLUG, true);
    const second = await updateAdminPackageStatus(SLUG, true);

    assert.equal(first.state, "ok");
    assert.equal(second.state, "ok");
    assert.deepEqual(first, second);
  });

  it("keeps each refusal the API can give distinct", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid package slug" } }, "invalid"],
      [400, { error: { code: "INVALID_PACKAGE_STATUS", message: "Invalid package status" } }, "invalid"],
      [404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } }, "not-found"],
      [401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } }, "unauthenticated"],
    ];

    for (const [status, body, expected] of cases) {
      respondWith(status, body);
      assert.equal((await updateAdminPackageStatus(SLUG, false)).state, expected,
        `${status} should be ${expected}`);
    }
  });

  it("treats the right status with the wrong body as an outage, never as a decision", async () => {
    for (const [status, body] of [
      [400, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [404, { nope: true }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await updateAdminPackageStatus(SLUG, false)).state, "unavailable");
    }
  });

  it("reports a dropped connection as unavailable, never as a refusal", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await updateAdminPackageStatus(SLUG, false);

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

    const result = await updateAdminPackageStatus(SLUG, false);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.equal(result.reason, "The hotel system is not configured correctly.");
  });

  it("refuses a success payload it cannot trust", async () => {
    respondWith(200, { data: detailBody({ managementSource: "seed" }) });
    assert.equal((await updateAdminPackageStatus(SLUG, false)).state, "unavailable");

    respondWith(200, { nope: true });
    assert.equal((await updateAdminPackageStatus(SLUG, false)).state, "unavailable");
  });
});

const createInput = {
  code: "ADMIN-001",
  slug: "a-new-journey",
  title: "A New Journey",
  summary: null,
  description: null,
  durationLabel: null,
  scheduleLabel: null,
  operatingDays: ["monday"],
  requiresPriceConfirmation: false,
  sortOrder: 0,
};

describe("createAdminPackage", () => {
  it("posts exactly the ten create fields and nothing else", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(
        JSON.stringify({ data: detailBody({ slug: "a-new-journey", isActive: false, managementSource: "admin" }) }),
        { status: 201 },
      );
    };

    await createAdminPackage(createInput, "admin_session=abc123");

    assert.equal(seen.url, "http://127.0.0.1:4000/api/v1/admin/packages");
    assert.equal(seen.init?.method, "POST");
    assert.equal(seen.init?.cache, "no-store");
    assert.deepEqual(seen.init?.headers, {
      "content-type": "application/json",
      Cookie: "admin_session=abc123",
    });

    const body = JSON.parse(String(seen.init?.body));
    assert.deepEqual(Object.keys(body).sort(), [
      "code", "description", "durationLabel", "operatingDays", "requiresPriceConfirmation",
      "scheduleLabel", "slug", "sortOrder", "summary", "title",
    ]);
    assert.equal(body.isActive, undefined, "publication is never sent");
    assert.equal(body.seedManaged, undefined, "ownership is never sent");
  });

  it("returns the created journey", async () => {
    respondWith(201, {
      data: detailBody({ slug: "a-new-journey", isActive: false, managementSource: "admin" }),
    });

    const result = await createAdminPackage(createInput);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.slug, "a-new-journey");
    assert.equal(result.data.isActive, false);
    assert.equal(result.data.managementSource, "admin");
  });

  it("keeps each refusal the API can give distinct", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { code: "INVALID_PACKAGE", message: "Invalid package details" } }, "invalid"],
      [409, { error: {
        code: "RESERVED_BROCHURE_PACKAGE_IDENTITY",
        message: "That code or slug belongs to the brochure catalogue",
      } }, "reserved-brochure-identity"],
      [409, { error: {
        code: "PACKAGE_CODE_IN_USE", message: "Another package already uses that code",
      } }, "code-in-use"],
      [409, { error: {
        code: "PACKAGE_SLUG_IN_USE", message: "Another package already uses that slug",
      } }, "slug-in-use"],
      [401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } }, "unauthenticated"],
    ];

    for (const [status, body, expected] of cases) {
      respondWith(status, body);
      assert.equal((await createAdminPackage(createInput)).state, expected,
        `${status} should be ${expected}`);
    }
  });

  it("treats the right status with the wrong body as an outage, never as a decision", async () => {
    for (const [status, body] of [
      [409, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { error: { code: "INVALID_PACKAGE", message: "Different wording" } }],
      [409, { nope: true }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await createAdminPackage(createInput)).state, "unavailable");
    }
  });

  it("reports a dropped connection as unavailable, never as a failure", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await createAdminPackage(createInput);

    // The journey may have been created before the connection dropped.
    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"));
  });

  it("reports a misconfigured API address without attempting the request", async () => {
    process.env.API_BASE_URL = "not-a-url";
    globalThis.fetch = async () => {
      throw new Error("fetch must not be attempted for a configuration fault");
    };

    const result = await createAdminPackage(createInput);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.equal(result.reason, "The hotel system is not configured correctly.");
  });

  it("refuses a created payload it cannot read, rather than claiming either outcome", async () => {
    respondWith(201, { data: detailBody({ managementSource: "seed" }) });

    assert.equal((await createAdminPackage(createInput)).state, "unavailable");
  });
});

const updateInput = {
  title: "A Renamed Journey",
  summary: null,
  description: null,
  durationLabel: null,
  scheduleLabel: null,
  operatingDays: ["saturday", "sunday"],
  requiresPriceConfirmation: true,
  sortOrder: 5,
};

describe("updateAdminPackage", () => {
  it("patches exactly the eight editable fields and nothing else", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(
        JSON.stringify({ data: detailBody({ managementSource: "admin" }) }),
        { status: 200 },
      );
    };

    await updateAdminPackage(SLUG, updateInput, "admin_session=abc123");

    assert.equal(seen.url, `http://127.0.0.1:4000/api/v1/admin/packages/${SLUG}`);
    assert.equal(seen.init?.method, "PATCH");
    assert.equal(seen.init?.cache, "no-store");
    assert.deepEqual(seen.init?.headers, {
      "content-type": "application/json",
      Cookie: "admin_session=abc123",
    });

    const body = JSON.parse(String(seen.init?.body));
    assert.deepEqual(Object.keys(body).sort(), [
      "description", "durationLabel", "operatingDays", "requiresPriceConfirmation",
      "scheduleLabel", "sortOrder", "summary", "title",
    ]);
    for (const forbidden of ["code", "slug", "isActive", "seedManaged", "managementSource"]) {
      assert.equal(body[forbidden], undefined, `${forbidden} is never sent`);
    }
  });

  it("preserves an explicit null for every nullable field", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let sent = "";
    globalThis.fetch = async (_url, init) => {
      sent = String(init?.body);
      return new Response(JSON.stringify({ data: detailBody() }), { status: 200 });
    };

    await updateAdminPackage(SLUG, updateInput);

    const body = JSON.parse(sent);
    for (const field of ["summary", "description", "durationLabel", "scheduleLabel"]) {
      assert.equal(body[field], null, `${field} stays an explicit null`);
      assert.ok(field in body, `${field} is still sent`);
    }
  });

  it("encodes the slug into a single path segment", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let requested = "";
    globalThis.fetch = async (url) => {
      requested = String(url);
      return new Response(JSON.stringify({ data: detailBody() }), { status: 200 });
    };

    await updateAdminPackage("a/b?c#d", updateInput);

    assert.equal(requested, "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb%3Fc%23d");
  });

  it("returns the updated journey, which is always admin-managed afterwards", async () => {
    respondWith(200, { data: detailBody({ managementSource: "admin" }) });

    const result = await updateAdminPackage(SLUG, updateInput);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "admin");
  });

  it("keeps each refusal the API can give distinct", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { code: "INVALID_PACKAGE", message: "Invalid package details" } }, "invalid"],
      [400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid package slug" } }, "invalid"],
      [404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } }, "not-found"],
      [401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } }, "unauthenticated"],
    ];

    for (const [status, body, expected] of cases) {
      respondWith(status, body);
      assert.equal((await updateAdminPackage(SLUG, updateInput)).state, expected,
        `${status} should be ${expected}`);
    }
  });

  it("treats the right status with the wrong body as an outage", async () => {
    for (const [status, body] of [
      [400, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [404, { nope: true }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await updateAdminPackage(SLUG, updateInput)).state, "unavailable");
    }
  });

  it("reports a dropped connection as unavailable, never as a failure", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await updateAdminPackage(SLUG, updateInput);

    // The edit may have been applied before the connection dropped.
    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"));
  });

  it("refuses an updated payload it cannot read, rather than claiming either outcome", async () => {
    respondWith(200, { data: detailBody({ managementSource: "seed" }) });

    assert.equal((await updateAdminPackage(SLUG, updateInput)).state, "unavailable");
  });
});

const KEY = "standard-service";

const variantInput = {
  label: "Premium service",
  childMinAge: 6,
  childMaxAge: 12,
  childDiscountPercent: "50.00",
};

describe("updateAdminPackageVariant", () => {
  it("patches exactly the four editable fields, to the variant sub-resource", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(
        JSON.stringify({ data: detailBody({ managementSource: "admin" }) }),
        { status: 200 },
      );
    };

    await updateAdminPackageVariant(SLUG, KEY, variantInput, "admin_session=abc123");

    assert.equal(seen.url, `http://127.0.0.1:4000/api/v1/admin/packages/${SLUG}/variants/${KEY}`);
    assert.equal(seen.init?.method, "PATCH");
    assert.equal(seen.init?.cache, "no-store");
    assert.deepEqual(seen.init?.headers, {
      "content-type": "application/json",
      Cookie: "admin_session=abc123",
    });

    const body = JSON.parse(String(seen.init?.body));
    assert.deepEqual(Object.keys(body).sort(), [
      "childDiscountPercent", "childMaxAge", "childMinAge", "label",
    ]);
    for (const forbidden of ["key", "slug", "isDefault", "sortOrder", "rates", "seedManaged"]) {
      assert.equal(body[forbidden], undefined, `${forbidden} is never sent`);
    }
  });

  it("sends the discount as a string, never a number", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let sent = "";
    globalThis.fetch = async (_url, init) => {
      sent = String(init?.body);
      return new Response(JSON.stringify({ data: detailBody() }), { status: 200 });
    };

    await updateAdminPackageVariant(SLUG, KEY, variantInput);

    assert.match(sent, /"childDiscountPercent":"50\.00"/, "quoted, so no float was involved");
  });

  it("sends three nulls when the child rule is cleared", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let sent = "";
    globalThis.fetch = async (_url, init) => {
      sent = String(init?.body);
      return new Response(JSON.stringify({ data: detailBody() }), { status: 200 });
    };

    await updateAdminPackageVariant(SLUG, KEY, {
      label: "Standard", childMinAge: null, childMaxAge: null, childDiscountPercent: null,
    });

    const body = JSON.parse(sent);
    assert.equal(body.childMinAge, null);
    assert.equal(body.childMaxAge, null);
    assert.equal(body.childDiscountPercent, null);
  });

  it("encodes both path segments", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let requested = "";
    globalThis.fetch = async (url) => {
      requested = String(url);
      return new Response(JSON.stringify({ data: detailBody() }), { status: 200 });
    };

    await updateAdminPackageVariant("a/b", "c?d", variantInput);

    assert.equal(requested, "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb/variants/c%3Fd");
  });

  it("returns the journey, which is admin-managed after any successful edit", async () => {
    respondWith(200, { data: detailBody({ managementSource: "admin" }) });

    const result = await updateAdminPackageVariant(SLUG, KEY, variantInput);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "admin");
  });

  it("tells an unknown journey apart from an unknown variant", async () => {
    respondWith(404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } });
    assert.equal((await updateAdminPackageVariant(SLUG, KEY, variantInput)).state, "package-not-found");

    respondWith(404, {
      error: { code: "PACKAGE_VARIANT_NOT_FOUND", message: "Package variant not found" },
    });
    assert.equal((await updateAdminPackageVariant(SLUG, KEY, variantInput)).state, "variant-not-found");
  });

  it("maps every refusal the API can give", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { code: "INVALID_PACKAGE", message: "Invalid package details" } }, "invalid"],
      [400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid package slug" } }, "invalid"],
      [400, { error: {
        code: "INVALID_PACKAGE_VARIANT_KEY", message: "Invalid package variant key",
      } }, "invalid"],
      [401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } }, "unauthenticated"],
    ];

    for (const [status, body, expected] of cases) {
      respondWith(status, body);
      assert.equal((await updateAdminPackageVariant(SLUG, KEY, variantInput)).state, expected);
    }
  });

  it("treats the right status with the wrong body as an outage", async () => {
    for (const [status, body] of [
      [404, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { nope: true }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await updateAdminPackageVariant(SLUG, KEY, variantInput)).state, "unavailable");
    }
  });

  it("reports a dropped connection as unavailable, never as a failure", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await updateAdminPackageVariant(SLUG, KEY, variantInput);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"));
  });

  it("refuses a payload it cannot read, rather than claiming either outcome", async () => {
    respondWith(200, { data: detailBody({ managementSource: "seed" }) });

    assert.equal((await updateAdminPackageVariant(SLUG, KEY, variantInput)).state, "unavailable");
  });
});

const ratesInput = [
  { minPartySize: 1, maxPartySize: 2, adultUnitRate: "100.00" },
  { minPartySize: 3, maxPartySize: null, adultUnitRate: "80.00" },
];

/** Answers a successful replacement, recording what was asked. */
function recordingOk(seen: { url: string; init?: RequestInit }): typeof globalThis.fetch {
  process.env.API_BASE_URL = "http://127.0.0.1:4000";

  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify({ data: detailBody() }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

describe("replaceAdminPackageRates", () => {
  it("PUTs the whole set to the variant's rates sub-resource", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageRates(SLUG, KEY, ratesInput);

    assert.equal(seen.init?.method, "PUT", "the set is replaced, not merged");
    assert.equal(
      seen.url,
      `http://127.0.0.1:4000/api/v1/admin/packages/${SLUG}/variants/${KEY}/rates`,
    );
  });

  it("sends only rates, and never a currency", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageRates(SLUG, KEY, ratesInput);

    const body = String(seen.init?.body ?? "");
    const parsed = JSON.parse(body) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed), ["rates"], "no slug, key, or policy flag travels");
    assert.ok(!/currency/i.test(body), "USD is the server's, not this form's");
    assert.deepEqual(parsed.rates, ratesInput, "including the open-ended null, verbatim");
  });

  it("keeps each rate an exact string in the wire body", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageRates(SLUG, KEY, [
      { minPartySize: 1, maxPartySize: null, adultUnitRate: "0.30" },
    ]);

    // Quoted in the JSON, so nothing downstream can turn it into a float.
    assert.match(String(seen.init?.body ?? ""), /"adultUnitRate":"0\.30"/);
  });

  it("sends an empty set as an empty array, the API's own word for none", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageRates(SLUG, KEY, []);

    assert.equal(String(seen.init?.body ?? ""), JSON.stringify({ rates: [] }));
  });

  it("sends the rows in the order given, so the same set always looks the same", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageRates(SLUG, KEY, ratesInput);

    const { rates } = JSON.parse(String(seen.init?.body ?? "")) as {
      rates: Array<{ minPartySize: number }>;
    };
    assert.deepEqual(rates.map((row) => row.minPartySize), [1, 3]);
  });

  it("encodes both path segments", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageRates("a/b", "c?d", ratesInput);

    assert.equal(
      seen.url,
      "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb/variants/c%3Fd/rates",
    );
  });

  it("forwards the administrator's session, and only when it has one", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageRates(SLUG, KEY, ratesInput, "session=abc");
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, "session=abc");

    await replaceAdminPackageRates(SLUG, KEY, ratesInput);
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, undefined);
  });

  it("returns the journey, which is admin-managed after any successful save", async () => {
    respondWith(200, { data: detailBody({ managementSource: "admin" }) });

    const result = await replaceAdminPackageRates(SLUG, KEY, ratesInput);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "admin");
  });

  it("keeps the two conflicts apart, because each needs a different remedy", async () => {
    respondWith(409, {
      error: {
        code: "OVERLAPPING_RATE_TIERS",
        message: "Rate tiers must not cover overlapping party sizes",
      },
    });
    assert.equal((await replaceAdminPackageRates(SLUG, KEY, ratesInput)).state, "overlapping");

    // Matched on the code alone: the message names two remedies and may be
    // reworded without this client mistaking it for an outage.
    respondWith(409, {
      error: { code: "PACKAGE_RATES_REQUIRED", message: "Reworded entirely." },
    });
    assert.equal((await replaceAdminPackageRates(SLUG, KEY, [])).state, "rates-required");
  });

  it("tells an unknown journey apart from an unknown variant", async () => {
    respondWith(404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } });
    assert.equal(
      (await replaceAdminPackageRates(SLUG, KEY, ratesInput)).state,
      "package-not-found",
    );

    respondWith(404, {
      error: { code: "PACKAGE_VARIANT_NOT_FOUND", message: "Package variant not found" },
    });
    assert.equal(
      (await replaceAdminPackageRates(SLUG, KEY, ratesInput)).state,
      "variant-not-found",
    );
  });

  it("maps every other refusal the API can give", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { code: "INVALID_PACKAGE", message: "Invalid package details" } }, "invalid"],
      [400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid package slug" } }, "invalid"],
      [400, { error: {
        code: "INVALID_PACKAGE_VARIANT_KEY", message: "Invalid package variant key",
      } }, "invalid"],
      [401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
        "unauthenticated"],
    ];

    for (const [status, body, expected] of cases) {
      respondWith(status, body);
      assert.equal((await replaceAdminPackageRates(SLUG, KEY, ratesInput)).state, expected);
    }
  });

  it("treats the right status with the wrong body as an outage", async () => {
    for (const [status, body] of [
      [409, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [404, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { nope: true }],
      [500, { error: { code: "INTERNAL", message: "Boom" } }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await replaceAdminPackageRates(SLUG, KEY, ratesInput)).state, "unavailable");
    }
  });

  it("reports a dropped connection as unknown, never as a failure", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await replaceAdminPackageRates(SLUG, KEY, ratesInput);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"), "no internal address reaches the screen");
  });

  it("refuses a payload it cannot read, rather than claiming either outcome", async () => {
    respondWith(200, { data: detailBody({ managementSource: "seed" }) });

    assert.equal((await replaceAdminPackageRates(SLUG, KEY, ratesInput)).state, "unavailable");
  });
});

const variantCreateInput = {
  key: "premium-service",
  label: "Premium service",
  childMinAge: 6,
  childMaxAge: 12,
  childDiscountPercent: "33.33",
};

describe("createAdminPackageVariant", () => {
  it("POSTs to the journey's variants collection", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await createAdminPackageVariant(SLUG, variantCreateInput);

    assert.equal(seen.init?.method, "POST");
    assert.equal(seen.url, `http://127.0.0.1:4000/api/v1/admin/packages/${SLUG}/variants`);
  });

  it("sends exactly the five fields, and nothing the server owns", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await createAdminPackageVariant(SLUG, variantCreateInput);

    const body = String(seen.init?.body ?? "");
    const parsed = JSON.parse(body) as Record<string, unknown>;

    assert.deepEqual(Object.keys(parsed).sort(), [
      "childDiscountPercent", "childMaxAge", "childMinAge", "key", "label",
    ]);
    for (const forbidden of ["isDefault", "sortOrder", "rates", "isActive", "seedManaged",
      "managementSource", "slug"]) {
      assert.ok(!body.includes(forbidden), `${forbidden} must not be sent`);
    }
  });

  it("keeps the discount an exact string in the wire body", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await createAdminPackageVariant(SLUG, { ...variantCreateInput, childDiscountPercent: "7.50" });

    // Quoted in the JSON, so nothing downstream can turn it into a float.
    assert.match(String(seen.init?.body ?? ""), /"childDiscountPercent":"7\.50"/);
  });

  it("sends a variant with no child rule as three nulls", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await createAdminPackageVariant(SLUG, {
      key: "basic", label: "Basic",
      childMinAge: null, childMaxAge: null, childDiscountPercent: null,
    });

    const parsed = JSON.parse(String(seen.init?.body ?? "")) as Record<string, unknown>;
    assert.equal(parsed.childMinAge, null);
    assert.equal(parsed.childMaxAge, null);
    assert.equal(parsed.childDiscountPercent, null);
  });

  it("encodes the slug into one path segment", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await createAdminPackageVariant("a/b?c", variantCreateInput);

    assert.equal(seen.url, "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb%3Fc/variants");
  });

  it("forwards the administrator's session, and only when it has one", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await createAdminPackageVariant(SLUG, variantCreateInput, "session=abc");
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, "session=abc");

    await createAdminPackageVariant(SLUG, variantCreateInput);
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, undefined);
  });

  it("returns the journey, which is admin-managed after any successful create", async () => {
    respondWith(201, { data: detailBody({ managementSource: "admin" }) });

    const result = await createAdminPackageVariant(SLUG, variantCreateInput);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "admin");
  });

  it("keeps the four conflicts apart, because each needs a different remedy", async () => {
    const cases: Array<[unknown, string]> = [
      [{ error: {
        code: "PACKAGE_VARIANT_KEY_IN_USE",
        message: "This journey already has a variant with that key",
      } }, "key-in-use"],
      [{ error: {
        code: "PACKAGE_VARIANT_ORDER_EXHAUSTED",
        message: "This journey has no ordering position left for another variant",
      } }, "order-exhausted"],
      // The two advisory refusals are matched on their code alone: each names
      // remedies at length and may be reworded.
      [{ error: { code: "PACKAGE_MUST_BE_INACTIVE", message: "Reworded entirely." } },
        "package-inactive-required"],
      [{ error: { code: "PACKAGE_VARIANT_DEFAULT_UNSAFE", message: "Also reworded." } },
        "default-unsafe"],
    ];

    for (const [body, expected] of cases) {
      respondWith(409, body);
      assert.equal((await createAdminPackageVariant(SLUG, variantCreateInput)).state, expected);
    }
  });

  it("maps every other refusal the API can give", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { code: "INVALID_PACKAGE", message: "Invalid package details" } }, "invalid"],
      [400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid package slug" } }, "invalid"],
      [404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } },
        "package-not-found"],
      [401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
        "unauthenticated"],
    ];

    for (const [status, body, expected] of cases) {
      respondWith(status, body);
      assert.equal((await createAdminPackageVariant(SLUG, variantCreateInput)).state, expected);
    }
  });

  it("treats the right status with the wrong body as an outage", async () => {
    for (const [status, body] of [
      [409, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [404, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { nope: true }],
      [500, { error: { code: "INTERNAL", message: "Boom" } }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await createAdminPackageVariant(SLUG, variantCreateInput)).state, "unavailable");
    }
  });

  it("reports a dropped connection as unknown, never as a failure", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await createAdminPackageVariant(SLUG, variantCreateInput);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"), "no internal address reaches the screen");
  });

  it("refuses a payload it cannot read, rather than claiming either outcome", async () => {
    respondWith(201, { data: detailBody({ managementSource: "seed" }) });

    assert.equal((await createAdminPackageVariant(SLUG, variantCreateInput)).state, "unavailable");
  });
});

describe("setAdminPackageDefaultVariant", () => {
  it("PUTs to the journey's default-variant slot", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await setAdminPackageDefaultVariant(SLUG, "premium-service");

    assert.equal(seen.init?.method, "PUT", "the slot is replaced, not patched");
    assert.equal(seen.url, `http://127.0.0.1:4000/api/v1/admin/packages/${SLUG}/default-variant`);
  });

  it("sends exactly { variantKey } and nothing else", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await setAdminPackageDefaultVariant(SLUG, "premium-service");

    const body = String(seen.init?.body ?? "");
    assert.equal(body, JSON.stringify({ variantKey: "premium-service" }));

    for (const forbidden of ["isDefault", "sortOrder", "rates", "label", "isActive",
      "seedManaged", "managementSource", "slug", "childMinAge"]) {
      assert.ok(!body.includes(forbidden), `${forbidden} must not be sent`);
    }
  });

  it("sends the key exactly as the journey reported it", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await setAdminPackageDefaultVariant(SLUG, "standard-service");

    const parsed = JSON.parse(String(seen.init?.body ?? "")) as { variantKey: string };
    assert.equal(parsed.variantKey, "standard-service", "never trimmed or recased");
  });

  it("encodes the slug into one path segment", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await setAdminPackageDefaultVariant("a/b?c", "premium-service");

    assert.equal(
      seen.url,
      "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb%3Fc/default-variant",
    );
  });

  it("forwards the administrator's session, and only when it has one", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await setAdminPackageDefaultVariant(SLUG, "premium-service", "session=abc");
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, "session=abc");

    await setAdminPackageDefaultVariant(SLUG, "premium-service");
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, undefined);
  });

  it("returns the journey, which is admin-managed after a real change", async () => {
    respondWith(200, { data: detailBody({ managementSource: "admin" }) });

    const result = await setAdminPackageDefaultVariant(SLUG, "premium-service");

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "admin");
  });

  it("treats the API's idempotent answer as the success it is", async () => {
    // Asking for the variant that already leads is a 200 there, so a stale
    // page whose button has since become meaningless does nothing rather
    // than failing — and the journey stays brochure-owned.
    respondWith(200, { data: detailBody({ managementSource: "brochure" }) });

    const result = await setAdminPackageDefaultVariant(SLUG, "standard-service");

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "brochure");
  });

  it("reports a live journey as its own outcome", async () => {
    // Matched on the code alone: the message names a remedy and may be
    // reworded.
    respondWith(409, {
      error: { code: "PACKAGE_MUST_BE_INACTIVE", message: "Reworded entirely." },
    });

    assert.equal(
      (await setAdminPackageDefaultVariant(SLUG, "premium-service")).state,
      "package-inactive-required",
    );
  });

  it("tells an unknown journey apart from an unknown variant", async () => {
    respondWith(404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } });
    assert.equal(
      (await setAdminPackageDefaultVariant(SLUG, "premium-service")).state,
      "package-not-found",
    );

    respondWith(404, {
      error: { code: "PACKAGE_VARIANT_NOT_FOUND", message: "Package variant not found" },
    });
    assert.equal(
      (await setAdminPackageDefaultVariant(SLUG, "premium-service")).state,
      "variant-not-found",
    );
  });

  it("maps every other refusal the API can give", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { code: "INVALID_PACKAGE", message: "Invalid package details" } }, "invalid"],
      [400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid package slug" } }, "invalid"],
      [401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
        "unauthenticated"],
    ];

    for (const [status, body, expected] of cases) {
      respondWith(status, body);
      assert.equal(
        (await setAdminPackageDefaultVariant(SLUG, "premium-service")).state,
        expected,
      );
    }
  });

  it("treats the right status with the wrong body as an outage", async () => {
    for (const [status, body] of [
      [409, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [404, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { nope: true }],
      [500, { error: { code: "INTERNAL", message: "Boom" } }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal(
        (await setAdminPackageDefaultVariant(SLUG, "premium-service")).state,
        "unavailable",
      );
    }
  });

  it("reports a dropped connection as unknown, never as a failure", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await setAdminPackageDefaultVariant(SLUG, "premium-service");

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"), "no internal address reaches the screen");
  });

  it("refuses a payload it cannot read, rather than claiming either outcome", async () => {
    respondWith(200, { data: detailBody({ managementSource: "seed" }) });

    assert.equal(
      (await setAdminPackageDefaultVariant(SLUG, "premium-service")).state,
      "unavailable",
    );
  });
});

const ORDER = ["premium-service", "standard-service"];

describe("reorderAdminPackageVariants", () => {
  it("PUTs to the journey's variant-order slot", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await reorderAdminPackageVariants(SLUG, ORDER);

    assert.equal(seen.init?.method, "PUT", "the whole order is stated, not patched");
    assert.equal(seen.url, `http://127.0.0.1:4000/api/v1/admin/packages/${SLUG}/variant-order`);
  });

  it("sends exactly { variantKeys } and nothing else", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await reorderAdminPackageVariants(SLUG, ORDER);

    const body = String(seen.init?.body ?? "");
    assert.equal(body, JSON.stringify({ variantKeys: ORDER }));

    for (const forbidden of ["sortOrder", "isDefault", "rates", "direction", "key\":",
      "isActive", "seedManaged", "slug"]) {
      assert.ok(!body.includes(forbidden), `${forbidden} must not be sent`);
    }
  });

  it("sends the complete list in the order given, keys verbatim", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await reorderAdminPackageVariants(SLUG, ["gamma", "alpha", "beta"]);

    const parsed = JSON.parse(String(seen.init?.body ?? "")) as { variantKeys: string[] };
    assert.deepEqual(parsed.variantKeys, ["gamma", "alpha", "beta"], "never resorted");
  });

  it("encodes the slug into one path segment", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await reorderAdminPackageVariants("a/b?c", ORDER);

    assert.equal(seen.url, "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb%3Fc/variant-order");
  });

  it("forwards the administrator's session, and only when it has one", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await reorderAdminPackageVariants(SLUG, ORDER, "session=abc");
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, "session=abc");

    await reorderAdminPackageVariants(SLUG, ORDER);
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, undefined);
  });

  it("returns the journey, which is admin-managed after a real reorder", async () => {
    respondWith(200, { data: detailBody({ managementSource: "admin" }) });

    const result = await reorderAdminPackageVariants(SLUG, ORDER);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "admin");
  });

  it("keeps the two stale conflicts apart from an outage", async () => {
    // Both matched on code alone: each names a remedy and may be reworded.
    respondWith(409, {
      error: { code: "PACKAGE_VARIANT_SET_MISMATCH", message: "Reworded entirely." },
    });
    assert.equal((await reorderAdminPackageVariants(SLUG, ORDER)).state, "set-mismatch");

    respondWith(409, {
      error: { code: "PACKAGE_VARIANT_ORDER_EXHAUSTED", message: "Also reworded." },
    });
    assert.equal((await reorderAdminPackageVariants(SLUG, ORDER)).state, "order-exhausted");
  });

  it("tells an unknown journey apart from an unknown variant", async () => {
    respondWith(404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } });
    assert.equal((await reorderAdminPackageVariants(SLUG, ORDER)).state, "package-not-found");

    respondWith(404, {
      error: { code: "PACKAGE_VARIANT_NOT_FOUND", message: "Package variant not found" },
    });
    assert.equal((await reorderAdminPackageVariants(SLUG, ORDER)).state, "variant-not-found");
  });

  it("maps every other refusal the API can give", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { code: "INVALID_PACKAGE", message: "Invalid package details" } }, "invalid"],
      [400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid package slug" } }, "invalid"],
      [401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
        "unauthenticated"],
    ];

    for (const [status, body, expected] of cases) {
      respondWith(status, body);
      assert.equal((await reorderAdminPackageVariants(SLUG, ORDER)).state, expected);
    }
  });

  it("treats the right status with the wrong body as an outage", async () => {
    for (const [status, body] of [
      [409, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [404, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { nope: true }],
      [500, { error: { code: "INTERNAL", message: "Boom" } }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await reorderAdminPackageVariants(SLUG, ORDER)).state, "unavailable");
    }
  });

  it("reports a dropped connection as unknown, never as a failure", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await reorderAdminPackageVariants(SLUG, ORDER);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"), "no internal address reaches the screen");
  });

  it("refuses a payload it cannot read, rather than claiming either outcome", async () => {
    respondWith(200, { data: detailBody({ managementSource: "seed" }) });

    assert.equal((await reorderAdminPackageVariants(SLUG, ORDER)).state, "unavailable");
  });
});

describe("deleteAdminPackageVariant", () => {
  it("sends DELETE to the variant's own address, with no body", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await deleteAdminPackageVariant(SLUG, KEY);

    assert.equal(seen.init?.method, "DELETE");
    assert.equal(seen.url, `http://127.0.0.1:4000/api/v1/admin/packages/${SLUG}/variants/${KEY}`);
    assert.equal(seen.init?.body, undefined, "a removal has nothing to say");
  });

  it("sends no content-type, because there is no content", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await deleteAdminPackageVariant(SLUG, KEY);

    const headers = seen.init?.headers as Record<string, string>;
    assert.equal(headers["content-type"], undefined);
  });

  it("encodes both path segments", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await deleteAdminPackageVariant("a/b", "c?d");

    assert.equal(seen.url, "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb/variants/c%3Fd");
  });

  it("forwards the administrator's session, and only when it has one", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await deleteAdminPackageVariant(SLUG, KEY, "session=abc");
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, "session=abc");

    await deleteAdminPackageVariant(SLUG, KEY);
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, undefined);
  });

  it("returns the journey, which is admin-managed after a real removal", async () => {
    respondWith(200, { data: detailBody({ managementSource: "admin" }) });

    const result = await deleteAdminPackageVariant(SLUG, KEY);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "admin");
  });

  it("keeps the three conflicts apart, because each needs a different answer", async () => {
    // All matched on code alone: each names a remedy and may be reworded.
    const cases: Array<[string, string]> = [
      ["PACKAGE_MUST_BE_INACTIVE", "package-inactive-required"],
      ["PACKAGE_VARIANT_IS_DEFAULT", "variant-is-default"],
      ["PACKAGE_VARIANT_HAS_RESERVATIONS", "variant-has-reservations"],
    ];

    for (const [code, expected] of cases) {
      respondWith(409, { error: { code, message: "Reworded entirely." } });
      assert.equal((await deleteAdminPackageVariant(SLUG, KEY)).state, expected);
    }
  });

  it("tells an unknown journey apart from an unknown variant", async () => {
    respondWith(404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } });
    assert.equal((await deleteAdminPackageVariant(SLUG, KEY)).state, "package-not-found");

    respondWith(404, {
      error: { code: "PACKAGE_VARIANT_NOT_FOUND", message: "Package variant not found" },
    });
    assert.equal((await deleteAdminPackageVariant(SLUG, KEY)).state, "variant-not-found");
  });

  it("maps both malformed-address refusals", async () => {
    for (const code of ["INVALID_PACKAGE_SLUG", "INVALID_PACKAGE_VARIANT_KEY"]) {
      respondWith(400, {
        error: {
          code,
          message: code === "INVALID_PACKAGE_SLUG"
            ? "Invalid package slug"
            : "Invalid package variant key",
        },
      });
      assert.equal((await deleteAdminPackageVariant(SLUG, KEY)).state, "invalid");
    }
  });

  it("maps an ended session", async () => {
    respondWith(401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } });

    assert.equal((await deleteAdminPackageVariant(SLUG, KEY)).state, "unauthenticated");
  });

  it("treats the right status with the wrong body as an outage", async () => {
    for (const [status, body] of [
      [409, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [404, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { nope: true }],
      [500, { error: { code: "INTERNAL", message: "Boom" } }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await deleteAdminPackageVariant(SLUG, KEY)).state, "unavailable");
    }
  });

  it("reports a dropped connection as unknown, never as a failure", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await deleteAdminPackageVariant(SLUG, KEY);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"), "no internal address reaches the screen");
  });

  it("refuses a payload it cannot read, rather than claiming either outcome", async () => {
    respondWith(200, { data: detailBody({ managementSource: "seed" }) });

    assert.equal((await deleteAdminPackageVariant(SLUG, KEY)).state, "unavailable");
  });
});

const CONTENT = {
  included: ["Dinner", "Guide"],
  excluded: ["Drinks"],
  notes: ["Smart dress."],
};

describe("replaceAdminPackageContent", () => {
  it("PUTs to the journey's content slot", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageContent(SLUG, CONTENT);

    assert.equal(seen.init?.method, "PUT", "the whole set is stated, not patched");
    assert.equal(seen.url, `http://127.0.0.1:4000/api/v1/admin/packages/${SLUG}/content`);
  });

  it("sends exactly the three lists, always", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageContent(SLUG, CONTENT);

    const body = String(seen.init?.body ?? "");
    const parsed = JSON.parse(body) as Record<string, unknown>;

    assert.deepEqual(Object.keys(parsed).sort(), ["excluded", "included", "notes"]);
    for (const forbidden of ["sortOrder", "kind", "seedManaged", "isActive", "slug",
      "managementSource", "itinerary"]) {
      assert.ok(!body.includes(forbidden), `${forbidden} must not be sent`);
    }
  });

  it("sends all three even when two are empty", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageContent(SLUG, { included: ["Dinner"], excluded: [], notes: [] });

    assert.equal(
      String(seen.init?.body ?? ""),
      JSON.stringify({ included: ["Dinner"], excluded: [], notes: [] }),
    );
  });

  it("sends three empty arrays when everything is cleared", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageContent(SLUG, { included: [], excluded: [], notes: [] });

    assert.equal(
      String(seen.init?.body ?? ""),
      JSON.stringify({ included: [], excluded: [], notes: [] }),
    );
  });

  it("carries nothing the caller happens to be holding", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    // Built field by field, so an extra property cannot reach the wire.
    await replaceAdminPackageContent(SLUG, {
      ...CONTENT, sortOrder: 1, kind: "note",
    } as never);

    const parsed = JSON.parse(String(seen.init?.body ?? "")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed).sort(), ["excluded", "included", "notes"]);
  });

  it("preserves order and duplicates on the wire", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageContent(SLUG, {
      included: ["zebra", "Transfer", "apple", "Transfer"], excluded: [], notes: [],
    });

    const parsed = JSON.parse(String(seen.init?.body ?? "")) as { included: string[] };
    assert.deepEqual(parsed.included, ["zebra", "Transfer", "apple", "Transfer"]);
  });

  it("encodes the slug into one path segment", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageContent("a/b?c", CONTENT);

    assert.equal(seen.url, "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb%3Fc/content");
  });

  it("forwards the administrator's session, and only when it has one", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageContent(SLUG, CONTENT, "session=abc");
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, "session=abc");

    await replaceAdminPackageContent(SLUG, CONTENT);
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, undefined);
  });

  it("returns the journey, which is admin-managed after a real change", async () => {
    respondWith(200, { data: detailBody({ managementSource: "admin" }) });

    const result = await replaceAdminPackageContent(SLUG, CONTENT);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "admin");
  });

  it("treats the API's no-op answer as the success it is", async () => {
    respondWith(200, { data: detailBody({ managementSource: "brochure" }) });

    const result = await replaceAdminPackageContent(SLUG, CONTENT);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "brochure", "ownership did not move");
  });

  it("maps every refusal the API can give", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { code: "INVALID_PACKAGE", message: "Invalid package details" } }, "invalid"],
      [400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid package slug" } }, "invalid"],
      [404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } },
        "package-not-found"],
      [401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
        "unauthenticated"],
    ];

    for (const [status, body, expected] of cases) {
      respondWith(status, body);
      assert.equal((await replaceAdminPackageContent(SLUG, CONTENT)).state, expected);
    }
  });

  it("treats the right status with the wrong body as an outage", async () => {
    for (const [status, body] of [
      [404, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { nope: true }],
      [500, { error: { code: "INTERNAL", message: "Boom" } }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await replaceAdminPackageContent(SLUG, CONTENT)).state, "unavailable");
    }
  });

  it("reports a dropped connection as unknown, never as a failure", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await replaceAdminPackageContent(SLUG, CONTENT);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"), "no internal address reaches the screen");
  });

  it("refuses a payload it cannot read, rather than claiming either outcome", async () => {
    respondWith(200, { data: detailBody({ managementSource: "seed" }) });

    assert.equal((await replaceAdminPackageContent(SLUG, CONTENT)).state, "unavailable");
  });
});

const SECTIONS = [
  { dayNumber: 1, heading: "Arrival", body: "Meet at the airport." },
  { dayNumber: null, heading: null, body: "Applies throughout." },
];

describe("replaceAdminPackageItinerary", () => {
  it("PUTs to the journey's itinerary slot", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageItinerary(SLUG, SECTIONS);

    assert.equal(seen.init?.method, "PUT", "the whole itinerary is stated, not patched");
    assert.equal(seen.url, `http://127.0.0.1:4000/api/v1/admin/packages/${SLUG}/itinerary`);
  });

  it("sends only sections, and each section only its three fields", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageItinerary(SLUG, SECTIONS);

    const body = String(seen.init?.body ?? "");
    const parsed = JSON.parse(body) as { sections: Array<Record<string, unknown>> };

    assert.deepEqual(Object.keys(parsed), ["sections"]);
    for (const section of parsed.sections) {
      assert.deepEqual(Object.keys(section).sort(), ["body", "dayNumber", "heading"]);
    }

    for (const forbidden of ["sortOrder", "position", "seedManaged", "isActive", "slug",
      "managementSource", "content"]) {
      assert.ok(!body.includes(forbidden), `${forbidden} must not be sent`);
    }
  });

  it("carries nothing the caller happens to be holding", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    // Rebuilt field by field, so an extra property cannot reach the wire.
    await replaceAdminPackageItinerary(SLUG, [
      { ...SECTIONS[0]!, sortOrder: 1, id: "7" } as never,
    ]);

    const parsed = JSON.parse(String(seen.init?.body ?? "")) as {
      sections: Array<Record<string, unknown>>;
    };
    assert.deepEqual(Object.keys(parsed.sections[0]!).sort(), ["body", "dayNumber", "heading"]);
  });

  it("sends both nullable fields as null, never omitted", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageItinerary(SLUG, [
      { dayNumber: null, heading: null, body: "Applies throughout." },
    ]);

    assert.match(String(seen.init?.body ?? ""), /"dayNumber":null/);
    assert.match(String(seen.init?.body ?? ""), /"heading":null/);
  });

  it("preserves order and duplicates on the wire", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageItinerary(SLUG, [
      { dayNumber: 3, heading: null, body: "Third." },
      { dayNumber: 1, heading: null, body: "Repeated." },
      { dayNumber: 1, heading: null, body: "Repeated." },
    ]);

    const parsed = JSON.parse(String(seen.init?.body ?? "")) as {
      sections: Array<{ dayNumber: number | null; body: string }>;
    };
    assert.deepEqual(parsed.sections.map((s) => s.dayNumber), [3, 1, 1]);
    assert.equal(parsed.sections[1]!.body, parsed.sections[2]!.body);
  });

  it("sends an empty array when the itinerary is cleared", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageItinerary(SLUG, []);

    assert.equal(String(seen.init?.body ?? ""), JSON.stringify({ sections: [] }));
  });

  it("encodes the slug into one path segment", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageItinerary("a/b?c", SECTIONS);

    assert.equal(seen.url, "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb%3Fc/itinerary");
  });

  it("forwards the administrator's session, and only when it has one", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = recordingOk(seen);

    await replaceAdminPackageItinerary(SLUG, SECTIONS, "session=abc");
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, "session=abc");

    await replaceAdminPackageItinerary(SLUG, SECTIONS);
    assert.equal((seen.init?.headers as Record<string, string>).Cookie, undefined);
  });

  it("returns the journey, which is admin-managed after a real change", async () => {
    respondWith(200, { data: detailBody({ managementSource: "admin" }) });

    const result = await replaceAdminPackageItinerary(SLUG, SECTIONS);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "admin");
  });

  it("treats the API's no-op answer as the success it is", async () => {
    respondWith(200, { data: detailBody({ managementSource: "brochure" }) });

    const result = await replaceAdminPackageItinerary(SLUG, SECTIONS);

    assert.equal(result.state, "ok");
    if (result.state !== "ok") return;
    assert.equal(result.data.managementSource, "brochure", "ownership did not move");
  });

  it("maps every refusal the API can give", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { code: "INVALID_PACKAGE", message: "Invalid package details" } }, "invalid"],
      [400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid package slug" } }, "invalid"],
      [404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } },
        "package-not-found"],
      [401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
        "unauthenticated"],
    ];

    for (const [status, body, expected] of cases) {
      respondWith(status, body);
      assert.equal((await replaceAdminPackageItinerary(SLUG, SECTIONS)).state, expected);
    }
  });

  it("treats the right status with the wrong body as an outage", async () => {
    for (const [status, body] of [
      [404, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { nope: true }],
      [500, { error: { code: "INTERNAL", message: "Boom" } }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await replaceAdminPackageItinerary(SLUG, SECTIONS)).state, "unavailable");
    }
  });

  it("reports a dropped connection as unknown, never as a failure", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await replaceAdminPackageItinerary(SLUG, SECTIONS);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"), "no internal address reaches the screen");
  });

  it("refuses a payload it cannot read, rather than claiming either outcome", async () => {
    respondWith(200, { data: detailBody({ managementSource: "seed" }) });

    assert.equal((await replaceAdminPackageItinerary(SLUG, SECTIONS)).state, "unavailable");
  });
});

/** A 204, which carries no body at all. */
function respondNoContent(): void {
  process.env.API_BASE_URL = "http://127.0.0.1:4000";
  globalThis.fetch = async () => new Response(null, { status: 204 });
}

describe("deleteAdminPackage", () => {
  it("sends DELETE to the journey's own address, with no body", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    const seen: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.url = String(url);
      seen.init = init;
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;

    await deleteAdminPackage(SLUG);

    assert.equal(seen.init?.method, "DELETE");
    assert.equal(seen.url, `http://127.0.0.1:4000/api/v1/admin/packages/${SLUG}`);
    assert.equal(seen.init?.body, undefined, "a removal has nothing to say");
    assert.equal(
      (seen.init?.headers as Record<string, string>)["content-type"],
      undefined,
      "and no content-type, because there is no content",
    );
  });

  it("reads a 204 as success without trying to parse a body", async () => {
    respondNoContent();

    const result = await deleteAdminPackage(SLUG);

    assert.deepEqual(result, { state: "ok" }, "no journey comes back, because none remains");
  });

  it("encodes the slug into one path segment", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let requested = "";
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      requested = String(url);
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;

    await deleteAdminPackage("a/b?c");

    assert.equal(requested, "http://127.0.0.1:4000/api/v1/admin/packages/a%2Fb%3Fc");
  });

  it("forwards the administrator's session, and only when it has one", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    let headers: HeadersInit | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      headers = init?.headers;
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;

    await deleteAdminPackage(SLUG, "session=abc");
    assert.equal((headers as Record<string, string>).Cookie, "session=abc");

    await deleteAdminPackage(SLUG);
    assert.equal((headers as Record<string, string>).Cookie, undefined);
  });

  it("keeps the three conflicts apart, because each is a different fact", async () => {
    // All matched on code alone: each names a remedy and may be reworded.
    const cases: Array<[string, string]> = [
      ["PACKAGE_MUST_BE_INACTIVE", "must-be-inactive"],
      ["PACKAGE_IS_BROCHURE_MANAGED", "brochure-managed"],
      ["PACKAGE_HAS_RESERVATIONS", "has-reservations"],
    ];

    for (const [code, expected] of cases) {
      respondWith(409, { error: { code, message: "Reworded entirely." } });
      assert.equal((await deleteAdminPackage(SLUG)).state, expected);
    }
  });

  it("maps a missing journey and a malformed address", async () => {
    respondWith(404, { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } });
    assert.equal((await deleteAdminPackage(SLUG)).state, "package-not-found");

    respondWith(400, { error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid package slug" } });
    assert.equal((await deleteAdminPackage(SLUG)).state, "invalid");
  });

  it("maps an ended session", async () => {
    respondWith(401, { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } });

    assert.equal((await deleteAdminPackage(SLUG)).state, "unauthenticated");
  });

  it("treats the right status with the wrong body as an outage", async () => {
    for (const [status, body] of [
      [409, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [404, { error: { code: "SOMETHING_ELSE", message: "Nope" } }],
      [400, { nope: true }],
      [500, { error: { code: "INTERNAL", message: "Boom" } }],
    ] as Array<[number, unknown]>) {
      respondWith(status, body);
      assert.equal((await deleteAdminPackage(SLUG)).state, "unavailable");
    }
  });

  it("treats a 200 as an outage, because this endpoint answers 204", async () => {
    respondWith(200, { data: detailBody() });

    assert.equal((await deleteAdminPackage(SLUG)).state, "unavailable");
  });

  it("reports a dropped connection as unknown, never as a failure", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET 10.0.0.5:4000");
    };

    const result = await deleteAdminPackage(SLUG);

    assert.equal(result.state, "unavailable");
    if (result.state !== "unavailable") return;
    assert.ok(!result.reason.includes("10.0.0.5"), "no internal address reaches the screen");
  });
});
