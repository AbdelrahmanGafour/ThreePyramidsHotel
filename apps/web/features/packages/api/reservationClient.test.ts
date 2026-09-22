import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { submitPackageReservation, type PackageReservationRequest } from "./reservationClient";

const input: PackageReservationRequest = {
  packageSlug: "giza-pyramids",
  tourDate: "2026-10-01",
  adults: 2,
  children: 0,
  guestFirstName: "Ada",
  guestLastName: "Lovelace",
  guestEmail: "ada@example.com",
  guestPhone: "+201000000000",
  guestCountry: "Egypt",
};

const confirmation = {
  data: {
    bookingReference: "TPP-23456789ABCD",
    status: "pending",
    package: { code: "T001", slug: "giza-pyramids", title: "Giza Pyramids" },
    variant: { key: "standard", label: "Standard" },
    tourDate: "2026-10-01",
    adults: 2,
    children: 0,
    pricingStatus: "quoted",
    currency: "EGP",
    adultUnitRate: "100.00",
    childUnitRate: null,
    totalAmount: "200.00",
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("package reservation outcomes", () => {
  it("returns success after exactly one same-origin POST", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async (url, init) => {
      calls += 1;
      assert.equal(url, "/api/v1/package-reservations");
      assert.equal(init?.method, "POST");
      assert.ok(!String(url).includes("ada@example.com"));
      return jsonResponse(201, confirmation);
    };
    const outcome = await submitPackageReservation(input, fakeFetch);
    assert.equal(calls, 1);
    assert.equal(outcome.kind, "success");
  });

  it("treats only known status/code pairs as refused", async () => {
    const cases = [
      [400, "INVALID_PACKAGE_RESERVATION"],
      [400, "PACKAGE_VARIANT_REQUIRED"],
      [400, "PACKAGE_OPERATING_DAY_MISMATCH"],
      [404, "PACKAGE_NOT_FOUND"],
      [404, "PACKAGE_VARIANT_NOT_FOUND"],
      [409, "PACKAGE_VARIANT_UNAVAILABLE"],
      [409, "PACKAGE_RATE_UNAVAILABLE"],
      [409, "PACKAGE_TOTAL_OUT_OF_RANGE"],
    ] as const;

    for (const [status, code] of cases) {
      let calls = 0;
      const outcome = await submitPackageReservation(input, async () => {
        calls += 1;
        return jsonResponse(status, { error: { code, message: "Refused" } });
      });
      assert.equal(calls, 1);
      assert.equal(outcome.kind, "refused");
      if (outcome.kind === "refused") assert.equal(outcome.error.code, code);
    }
  });

  it("treats unknown or status-mismatched refusal codes as uncertain", async () => {
    for (const [status, code] of [
      [400, "SOMETHING_ELSE"],
      [400, "PACKAGE_NOT_FOUND"],
      [404, "PACKAGE_RATE_UNAVAILABLE"],
      [409, "INVALID_PACKAGE_RESERVATION"],
    ] as const) {
      const outcome = await submitPackageReservation(
        input,
        async () => jsonResponse(status, { error: { code, message: "Not trusted" } }),
      );
      assert.equal(outcome.kind, "uncertain");
    }
  });

  it("treats network failure, 5xx and malformed 201 as uncertain with no retry", async () => {
    const cases: Array<(calls: { value: number }) => Promise<Response>> = [
      async (calls) => { calls.value += 1; throw new Error("network"); },
      async (calls) => { calls.value += 1; return jsonResponse(500, { error: { code: "X", message: "X" } }); },
      async (calls) => { calls.value += 1; return jsonResponse(201, { data: { status: "pending" } }); },
    ];
    for (const fake of cases) {
      const calls = { value: 0 };
      const outcome = await submitPackageReservation(input, () => fake(calls));
      assert.equal(calls.value, 1);
      assert.equal(outcome.kind, "uncertain");
    }
  });

  it("does not treat a malformed refusal payload as definitely refused", async () => {
    const outcome = await submitPackageReservation(input, async () => jsonResponse(409, { nope: true }));
    assert.equal(outcome.kind, "uncertain");
  });
});
