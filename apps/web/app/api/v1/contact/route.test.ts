import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";

// The contact bridge, exercised through its real path: the route handler, the
// real `forwardToExpress`, and a stubbed `fetch` standing in for Express.
//
// Stubbing fetch rather than the proxy is deliberate. What matters about a
// bridge is exactly the part a proxy mock would replace — that the body goes
// out untouched, that the status comes back unchanged, and that the API
// address stays on the server. Mocking the proxy would assert that the
// handler calls a function, which is not the same claim.

type RouteModule = typeof import("./route.js");

let POST: RouteModule["POST"];

const API_BASE_URL = "http://api.internal.test:4000";

type Outbound = { url: string; init: RequestInit };

let outbound: Outbound[] = [];
let realFetch: typeof globalThis.fetch;

/** Answers the next outbound request with this status and JSON body. */
function expressAnswers(status: number, body: unknown): void {
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    outbound.push({ url: String(url), init: (init ?? {}) as RequestInit });

    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers({ "content-type": "application/json" }),
      async json() {
        return body;
      },
      async text() {
        return JSON.stringify(body);
      },
    } as unknown as Response;
  }) as typeof globalThis.fetch;
}

const submission = {
  firstName: "Amina",
  lastName: "Khalil",
  email: "amina@example.test",
  phone: "+20 100 000 0000",
  inquiryType: "Room reservation",
  message: "Do you have a room with a view of the plateau in April?",
  website: "",
};

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/v1/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

before(async () => {
  process.env.API_BASE_URL ??= API_BASE_URL;
  realFetch = globalThis.fetch;
  ({ POST } = await import("./route.js"));
});

beforeEach(() => {
  outbound = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the contact bridge", () => {
  it("forwards a POST to the contact endpoint on the Express API", async () => {
    expressAnswers(202, { data: { received: true } });

    await post(submission);

    assert.equal(outbound.length, 1, "one request, never retried");
    assert.equal(outbound[0]?.url, `${process.env.API_BASE_URL}/api/v1/contact`);
    assert.equal(outbound[0]?.init.method, "POST");
  });

  it("forwards the body untouched, honeypot included", async () => {
    expressAnswers(202, { data: { received: true } });

    await post(submission);

    // Byte-identical: the bridge parses nothing, so Express remains the thing
    // that validates. `website` must arrive exactly as the browser sent it —
    // it is what Express uses to decide whether a submission is real.
    assert.equal(String(outbound[0]?.init.body), JSON.stringify(submission));
  });

  it("forwards a filled honeypot rather than stripping it", async () => {
    expressAnswers(400, {
      error: { code: "INVALID_CONTACT_INQUIRY", message: "Your inquiry could not be accepted" },
    });

    await post({ ...submission, website: "http://spam.example" });

    assert.ok(String(outbound[0]?.init.body).includes("spam.example"), "the trap must reach Express");
  });

  it("forwards malformed JSON as text rather than rejecting it here", async () => {
    // Parsing here would make the bridge, not Express, the thing that rejects
    // malformed JSON — replacing Express's own contract.
    expressAnswers(400, {
      error: { code: "INVALID_CONTACT_INQUIRY", message: "Your inquiry could not be accepted" },
    });

    const response = await post("{ not json");

    assert.equal(String(outbound[0]?.init.body), "{ not json");
    assert.equal(response.status, 400);
  });

  it("preserves a 202 and its acknowledgement exactly", async () => {
    expressAnswers(202, { data: { received: true } });

    const response = await post(submission);

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { data: { received: true } });
  });

  it("preserves a 400 refusal exactly", async () => {
    const refusal = {
      error: { code: "INVALID_CONTACT_INQUIRY", message: "Your inquiry could not be accepted" },
    };
    expressAnswers(400, refusal);

    const response = await post({ ...submission, email: "nope" });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), refusal);
  });

  it("preserves a 500 failure exactly", async () => {
    const failure = {
      error: { code: "CONTACT_INQUIRY_FAILED", message: "Your inquiry could not be submitted" },
    };
    expressAnswers(500, failure);

    const response = await post(submission);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), failure);
  });

  it("answers safely when Express cannot be reached, without leaking the address", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;

    const response = await post(submission);
    const serialised = JSON.stringify(await response.json());

    assert.ok(response.status >= 500, "an unreachable API is a server-side problem");
    assert.equal(serialised.includes("api.internal.test"), false, "the API address must not leak");
    assert.equal(serialised.includes("4000"), false);
  });

  it("never names the API address in its own source", async () => {
    // The browser calls a relative path; only the server resolves the address.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/v1/contact/route.ts", "utf8");

    // By USE, not by mention: the comment above the handler explains that
    // API_BASE_URL stays on the server, and saying so is not reading it.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

    assert.equal(code.includes("process.env"), false, "the address is resolved inside forwardToExpress");
    assert.equal(code.includes("NEXT_PUBLIC"), false);
    assert.equal(code.toLowerCase().includes("resend"), false, "no provider is contacted here");
  });
});
