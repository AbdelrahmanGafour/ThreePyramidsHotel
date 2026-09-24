import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatUsdMoney, lowestPackageFrom } from "./publicPresentation.js";
import type { PublicPackageCard } from "@/features/packages/api/contracts";

// Pure presentation helpers for the public packages pages. The V1 package
// catalogue is USD-only, and every amount arriving here is a backend
// `numeric(12,2)` decimal string that must survive to the screen unchanged.

function card(adultUnitRate: string | null): PublicPackageCard {
  return {
    code: "T001",
    slug: "sample-tour",
    title: "Sample tour",
    summary: null,
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    currency: "USD",
    requiresPriceConfirmation: false,
    pricing:
      adultUnitRate === null
        ? { status: "unavailable", unit: "per_person", from: null }
        : {
            status: "available",
            unit: "per_person",
            from: { variantKey: "standard", minPartySize: 1, maxPartySize: null, adultUnitRate, currency: "USD" },
          },
  } as PublicPackageCard;
}

describe("formatUsdMoney", () => {
  it("renders the backend amount as USD", () => {
    assert.equal(formatUsdMoney("420.00"), "$420.00");
  });

  it("groups thousands without touching the decimals", () => {
    assert.equal(formatUsdMoney("1234.50"), "$1,234.50");
    assert.equal(formatUsdMoney("1234567.89"), "$1,234,567.89");
  });

  it("preserves the exact digits it was given, never re-deriving them", () => {
    // The whole point: these are backend decimal strings, not numbers. A
    // float round-trip would turn 0.10 + 0.20 arithmetic into 0.30000000000000004
    // and would drop the trailing zero from "80.10".
    for (const amount of ["0.00", "0.01", "80.10", "99.99", "9999999999.99"]) {
      const formatted = formatUsdMoney(amount);
      const [whole, fraction] = amount.split(".");

      assert.ok(formatted.startsWith("$"), `${amount} must be marked as USD`);
      assert.equal(formatted.replace(/[$,]/g, ""), `${whole}.${fraction}`, `${amount} must survive verbatim`);
    }
  });

  it("never emits a currency other than USD", () => {
    for (const amount of ["420.00", "1234.50"]) {
      assert.doesNotMatch(formatUsdMoney(amount), /EGP/);
    }
  });

  it("renders a value with no decimal part sensibly rather than as undefined", () => {
    // Unreachable through the contract parser, which requires \d+\.\d{2};
    // guarded so a future caller cannot produce "$420.undefined".
    assert.equal(formatUsdMoney("420"), "$420.00");
  });
});

describe("lowestPackageFrom", () => {
  it("compares amounts numerically in minor units, not lexicographically", () => {
    // "90.00" sorts after "1000.00" as text; 9000 is below 100000 in minor units.
    assert.equal(lowestPackageFrom([card("1000.00"), card("90.00")]), "90.00");
  });

  it("ignores packages with no published rate", () => {
    assert.equal(lowestPackageFrom([card(null), card("250.00")]), "250.00");
  });

  it("returns null when nothing is priced", () => {
    assert.equal(lowestPackageFrom([card(null)]), null);
  });
});
