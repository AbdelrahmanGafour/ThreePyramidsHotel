import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bridgePackageDetail, bridgePackageList, bridgePackageReservation } from "./packageBridge";

const originalFetch = globalThis.fetch;
const originalApiBaseUrl = process.env.API_BASE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiBaseUrl === undefined) delete process.env.API_BASE_URL;
  else process.env.API_BASE_URL = originalApiBaseUrl;
});

describe("narrow package bridge", () => {
  it("uses only the fixed package catalogue endpoint and forwards no cookies", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "http://127.0.0.1:4000/api/v1/packages");
      assert.equal(init?.method, "GET");
      assert.equal(init?.cache, "no-store");
      assert.equal((init?.headers as Record<string, string> | undefined)?.cookie, undefined);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    assert.deepEqual(await bridgePackageList(), { status: 200, body: { data: [] } });
  });

  it("encodes the detail segment instead of allowing it to alter the fixed path", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "http://127.0.0.1:4000/api/v1/packages/bad%2Fsegment");
      return new Response(JSON.stringify({ error: { code: "INVALID_PACKAGE_SLUG", message: "Invalid" } }), { status: 400 });
    };
    assert.equal((await bridgePackageDetail("bad/segment")).status, 400);
  });

  it("forwards reservation bodies verbatim so Express owns INVALID_JSON", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "http://127.0.0.1:4000/api/v1/package-reservations");
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, "{broken");
      assert.deepEqual(init?.headers, { "content-type": "application/json" });
      return new Response(JSON.stringify({ error: { code: "INVALID_JSON", message: "bad json" } }), { status: 400 });
    };
    assert.equal((await bridgePackageReservation("{broken", "application/json")).status, 400);
  });

  it("sanitizes transport and malformed-upstream failures", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:4000";
    globalThis.fetch = async () => { throw new Error("secret host failure"); };
    assert.deepEqual(await bridgePackageList(), {
      status: 502,
      body: { error: { code: "PACKAGE_UPSTREAM_UNREACHABLE", message: "Package API could not be reached." } },
    });

    globalThis.fetch = async () => new Response("not json", { status: 201 });
    assert.deepEqual(await bridgePackageList(), {
      status: 502,
      body: { error: { code: "PACKAGE_UPSTREAM_INVALID_RESPONSE", message: "Package API returned an unusable response." } },
    });
  });
});
