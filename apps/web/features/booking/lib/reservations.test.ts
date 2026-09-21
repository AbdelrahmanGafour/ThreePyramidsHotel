import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  classifyReservationResponse,
  submitReservation,
  UNCERTAIN_RESERVATION_MESSAGE,
  type ReservationRequestInput,
} from "./reservations";
import type { ClientResponse } from "@/lib/api/client";

const VALID_DATA = {
  bookingReference: "TPH-A2B3C4D5E6F7",
  status: "pending" as const,
  roomType: { slug: "room-concept-01", name: "Room concept 01" },
  checkIn: "2026-10-10",
  checkOut: "2026-10-12",
  nights: 2,
  adults: 2,
  children: 0,
  nightlyRate: "1000.00",
  totalAmount: "2000.00",
  currency: "EGP" as const,
};

const INPUT: ReservationRequestInput = {
  roomTypeSlug: "room-concept-01",
  checkIn: "2026-10-10",
  checkOut: "2026-10-12",
  adults: 2,
  children: 0,
  guestFirstName: "Ada",
  guestLastName: "Lovelace",
  guestEmail: "ada@example.com",
  guestPhone: "+201000000000",
  guestCountry: "Egypt",
  specialRequests: "",
};

function response(status: number, body: unknown): ClientResponse<unknown> {
  return { status, body };
}

// ── A) valid 201 -----------------------------------------------------------

describe("classifyReservationResponse — success", () => {
  it("a valid 201 body classifies as success and preserves the backend data exactly", () => {
    const result = classifyReservationResponse(response(201, { data: VALID_DATA }));
    assert.deepEqual(result, { outcome: "success", data: VALID_DATA });
  });
});

// ── B) known domain refusals -------------------------------------------------

describe("classifyReservationResponse — known refusals", () => {
  it("400 + INVALID_RESERVATION -> refused", () => {
    const result = classifyReservationResponse(
      response(400, { error: { code: "INVALID_RESERVATION", message: "adults must be at least 1" } }),
    );
    assert.deepEqual(result, {
      outcome: "refused",
      code: "INVALID_RESERVATION",
      message: "adults must be at least 1",
    });
  });

  it("404 + ROOM_TYPE_NOT_FOUND -> refused", () => {
    const result = classifyReservationResponse(
      response(404, { error: { code: "ROOM_TYPE_NOT_FOUND", message: "Room type not found: x" } }),
    );
    assert.deepEqual(result, {
      outcome: "refused",
      code: "ROOM_TYPE_NOT_FOUND",
      message: "Room type not found: x",
    });
  });

  it("409 + NO_AVAILABILITY -> refused", () => {
    const result = classifyReservationResponse(
      response(409, { error: { code: "NO_AVAILABILITY", message: "No room available" } }),
    );
    assert.deepEqual(result, { outcome: "refused", code: "NO_AVAILABILITY", message: "No room available" });
  });
});

// ── C) uncertain --------------------------------------------------------------

describe("classifyReservationResponse — uncertain", () => {
  it("HTTP 500 -> uncertain", () => {
    const result = classifyReservationResponse(response(500, { error: { code: "INTERNAL", message: "oops" } }));
    assert.deepEqual(result, { outcome: "uncertain", message: UNCERTAIN_RESERVATION_MESSAGE });
  });

  it("malformed/unreadable body (null, from a JSON parse failure) -> uncertain", () => {
    const result = classifyReservationResponse(response(500, null));
    assert.deepEqual(result, { outcome: "uncertain", message: UNCERTAIN_RESERVATION_MESSAGE });
  });

  it("malformed 201 body (missing data) -> uncertain, never success", () => {
    const result = classifyReservationResponse(response(201, {}));
    assert.equal(result.outcome, "uncertain");
  });

  it("malformed 201 body (data fails contract validation) -> uncertain", () => {
    const result = classifyReservationResponse(response(201, { data: { ...VALID_DATA, nightlyRate: -100 } }));
    assert.equal(result.outcome, "uncertain");
  });

  it("an unexpected/unknown HTTP status -> uncertain", () => {
    const result = classifyReservationResponse(response(418, { error: { code: "TEAPOT", message: "?" } }));
    assert.equal(result.outcome, "uncertain");
  });

  it("an unknown backend error code -> uncertain, not refused", () => {
    const result = classifyReservationResponse(response(400, { error: { code: "SOMETHING_ELSE", message: "?" } }));
    assert.equal(result.outcome, "uncertain");
  });

  it("a known error code on the WRONG status -> uncertain, not refused (status/code must agree)", () => {
    const result = classifyReservationResponse(
      response(500, { error: { code: "NO_AVAILABILITY", message: "?" } }),
    );
    assert.equal(result.outcome, "uncertain");
  });
});

// ── submitReservation: network path + no-automatic-retry ---------------------

describe("submitReservation", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("a rejected fetch (network failure) classifies as uncertain, not failure", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network error");
    }) as typeof fetch;

    const result = await submitReservation(INPUT);
    assert.deepEqual(result, { outcome: "uncertain", message: UNCERTAIN_RESERVATION_MESSAGE });
  });

  it("performs exactly one request per call, even when the outcome is uncertain", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new TypeError("network error");
    }) as typeof fetch;

    const result = await submitReservation(INPUT);

    assert.equal(calls, 1);
    assert.equal(result.outcome, "uncertain");
  });

  it("a successful call issues exactly one request and returns the backend data", async () => {
    let calls = 0;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: VALID_DATA }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const wrapped = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      calls += 1;
      return wrapped(...args);
    }) as typeof fetch;

    const result = await submitReservation(INPUT);

    assert.equal(calls, 1);
    assert.deepEqual(result, { outcome: "success", data: VALID_DATA });
  });

  it("a known refusal issues exactly one request", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { code: "NO_AVAILABILITY", message: "No room available" } }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await submitReservation(INPUT);

    assert.equal(calls, 1);
    assert.deepEqual(result, { outcome: "refused", code: "NO_AVAILABILITY", message: "No room available" });
  });
});
