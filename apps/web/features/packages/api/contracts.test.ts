import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parsePackageDetailResponse,
  parsePackageListResponse,
  parsePackageReservationResponse,
} from "./contracts";

const card = {
  code: "T001",
  slug: "giza-pyramids",
  title: "Giza Pyramids",
  summary: null,
  durationLabel: "Approx. 2 hrs",
  scheduleLabel: "Every Day",
  operatingDays: null,
  currency: "EGP",
  requiresPriceConfirmation: false,
  pricing: {
    status: "from",
    unit: "per_person",
    from: { adultUnitRate: "100.00", variantKey: "standard", minPartySize: 1, maxPartySize: 1 },
  },
} as const;

const detail = {
  ...card,
  description: "A package",
  itinerary: [{ dayNumber: null, heading: null, body: "Visit Giza" }],
  included: ["Guide"],
  excluded: [],
  notes: [],
  variants: [{
    key: "standard",
    label: "Standard",
    isDefault: true,
    childMinAge: 6,
    childMaxAge: 12,
    childDiscountPercent: "50.00",
    rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: "100.00", currency: "EGP" }],
  }],
};

describe("public package response contracts", () => {
  it("parses valid list and detail contracts", () => {
    assert.equal(parsePackageListResponse({ data: [card] }).data[0].slug, "giza-pyramids");
    assert.equal(parsePackageDetailResponse({ data: detail }).data.variants[0].rates[0].adultUnitRate, "100.00");
  });

  it("fails the whole list when one package is malformed", () => {
    assert.throws(() => parsePackageListResponse({ data: [card, { ...card, currency: "USD" }] }));
  });

  it("rejects internal or unexpected fields at every public boundary", () => {
    assert.throws(() => parsePackageListResponse({ data: [{ ...card, id: "1" }] }));
    assert.throws(() => parsePackageDetailResponse({ data: { ...detail, createdAt: "secret" } }));
  });

  it("preserves display rates on confirmation-required packages", () => {
    const parsed = parsePackageListResponse({
      data: [{ ...card, requiresPriceConfirmation: true, pricing: { ...card.pricing, status: "requires_confirmation" } }],
    });
    assert.equal(parsed.data[0].pricing.status, "requires_confirmation");
    assert.equal(parsed.data[0].pricing.from?.adultUnitRate, "100.00");
  });

  it("strictly validates reservation success and pricing consistency", () => {
    const success = {
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
    assert.equal(parsePackageReservationResponse(success).data.totalAmount, "200.00");
    assert.throws(() => parsePackageReservationResponse({
      data: { ...success.data, pricingStatus: "requires_confirmation", totalAmount: "200.00" },
    }));
    assert.throws(() => parsePackageReservationResponse({
      data: { ...success.data, tourDate: "2026-02-30" },
    }));
    assert.throws(() => parsePackageReservationResponse({
      data: { ...success.data, totalAmount: "199.99" },
    }));
    assert.throws(() => parsePackageReservationResponse({
      data: { ...success.data, children: 1, childUnitRate: null, totalAmount: "200.00" },
    }));
  });
});
