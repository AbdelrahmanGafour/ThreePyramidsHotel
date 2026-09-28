import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTACT_SUBMISSION_ERROR_MESSAGE,
  classifyContactResponse,
  type ContactInquiryRequest,
} from "./contactApi";
import type { ClientResponse } from "@/lib/api/client";

// How the browser reads the bridge's answer.
//
// The classifier is pure and exported for exactly this reason — the same
// arrangement `features/booking/lib/reservations.ts` uses, so the decisions can
// be tested without a network.
//
// The rule that matters most: a success is only a success if it can be read.
// Telling somebody their message was received when it may not have been is the
// one mistake worth guarding against on this page.

const response = (status: number, body: unknown): ClientResponse<unknown> => ({ status, body });

const ACCEPTED = { data: { received: true } };

describe("classifyContactResponse — success", () => {
  it("treats a 202 carrying the acknowledgement as success", () => {
    assert.deepEqual(classifyContactResponse(response(202, ACCEPTED)), { outcome: "success" });
  });

  it("ignores anything extra the backend might add later", () => {
    assert.deepEqual(
      classifyContactResponse(response(202, { data: { received: true, somethingNew: 1 } })),
      { outcome: "success" },
    );
  });
});

describe("classifyContactResponse — a 202 it cannot read", () => {
  it("does not claim success for a malformed body", () => {
    // The inquiry may well have been queued, but the page must not claim an
    // outcome it cannot verify.
    for (const body of [
      null,
      undefined,
      "received",
      42,
      [],
      {},
      { data: null },
      { data: {} },
      { data: { received: false } },
      { data: { received: "true" } },
      { received: true },
      { error: { code: "X" } },
    ]) {
      assert.deepEqual(
        classifyContactResponse(response(202, body)),
        { outcome: "failed" },
        `202 with ${JSON.stringify(body) ?? "undefined"} is not a verified success`,
      );
    }
  });
});

describe("classifyContactResponse — refusals and faults", () => {
  it("treats a 400 as a refusal", () => {
    assert.deepEqual(
      classifyContactResponse(
        response(400, {
          error: { code: "INVALID_CONTACT_INQUIRY", message: "Your inquiry could not be accepted" },
        }),
      ),
      { outcome: "refused" },
    );
  });

  it("treats a 400 with an unreadable body as a refusal too", () => {
    // The status is the part that matters; the backend's message is generic by
    // design and is never shown to the visitor anyway.
    assert.deepEqual(classifyContactResponse(response(400, null)), { outcome: "refused" });
  });

  it("treats every other status as a failure", () => {
    for (const status of [200, 201, 204, 401, 403, 404, 429, 500, 502, 503]) {
      assert.deepEqual(
        classifyContactResponse(response(status, ACCEPTED)),
        { outcome: "failed" },
        `${status} is not a contact success`,
      );
    }
  });

  it("does not accept a 200 dressed as a 202", () => {
    // The backend answers 202. A 200 means something else is responding.
    assert.deepEqual(classifyContactResponse(response(200, ACCEPTED)), { outcome: "failed" });
  });
});

describe("what a visitor is told when it does not go through", () => {
  it("is one fixed, generic sentence", () => {
    assert.equal(typeof CONTACT_SUBMISSION_ERROR_MESSAGE, "string");
    assert.ok(CONTACT_SUBMISSION_ERROR_MESSAGE.length > 0);
  });

  it("names no status, code or internal detail", () => {
    const lowered = CONTACT_SUBMISSION_ERROR_MESSAGE.toLowerCase();

    for (const leak of [
      "400",
      "500",
      "invalid_contact_inquiry",
      "contact_inquiry_failed",
      "server",
      "api",
      "honeypot",
      "spam",
      "tpc-",
    ]) {
      assert.equal(lowered.includes(leak), false, `must not mention ${leak}`);
    }
  });

  it("tells the visitor what they can do instead", () => {
    assert.match(CONTACT_SUBMISSION_ERROR_MESSAGE, /try again/i);
  });
});

describe("the client stays inside the same-origin boundary", () => {
  it("calls the relative bridge path and never an absolute API address", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("features/contact/lib/contactApi.ts", "utf8");
    // By USE, not by mention: the file's own comments explain that it never
    // reads the API address, and saying so is not reading it.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

    assert.ok(code.includes('"/api/v1/contact"'), "the same-origin bridge path");
    assert.equal(code.includes("API_BASE_URL"), false, "the browser never knows the address");
    assert.equal(code.includes("NEXT_PUBLIC"), false);
    assert.equal(code.includes("http://"), false, "no absolute URL");
    assert.equal(code.includes("https://"), false);
  });

  it("sends exactly the seven fields the backend accepts", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("features/contact/lib/contactApi.ts", "utf8");
    const body = /body: JSON\.stringify\(\{([\s\S]*?)\}\)/.exec(source)?.[1];

    assert.ok(body, "the request body is built field by field");
    assert.deepEqual(
      [...body.matchAll(/^\s{8}(\w+):/gm)].map((match) => match[1]),
      ["firstName", "lastName", "email", "phone", "inquiryType", "message", "website"],
      "including the honeypot, which the server decides about",
    );
  });

  it("issues one request and never retries", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("features/contact/lib/contactApi.ts", "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");

    // A POST that was not answered may already have queued the inquiry, and a
    // retry would mean a second email about the same message.
    assert.equal(code.match(/requestJson\(/g)?.length, 1, "one call site");
    assert.doesNotMatch(code, /\bfor\s*\(|\bwhile\s*\(/, "no retry loop");
  });
});

/** A compile-time check that the request type carries the honeypot. */
const _request: ContactInquiryRequest = {
  firstName: "Amina",
  lastName: "Khalil",
  email: "amina@example.test",
  phone: "",
  inquiryType: "General inquiry",
  message: "Hello.",
  website: "",
};
void _request;
