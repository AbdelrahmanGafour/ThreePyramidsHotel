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
  currency: "USD",
  requiresPriceConfirmation: false,
  pricing: {
    status: "from",
    unit: "per_person",
    from: { adultUnitRate: "100.00", variantKey: "standard", minPartySize: 1, maxPartySize: 1 },
  },
  image: null,
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
    rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: "100.00", currency: "USD" }],
  }],
};

describe("public package response contracts", () => {
  it("parses valid list and detail contracts", () => {
    assert.equal(parsePackageListResponse({ data: [card] }).data[0].slug, "giza-pyramids");
    assert.equal(parsePackageDetailResponse({ data: detail }).data.variants[0].rates[0].adultUnitRate, "100.00");
  });

  it("fails the whole list when one package is malformed", () => {
    // A non-USD currency is malformed: the V1 package catalogue is USD-only.
    assert.throws(() => parsePackageListResponse({ data: [card, { ...card, currency: "EGP" }] }));
  });

  it("rejects internal or unexpected fields at every public boundary", () => {
    assert.throws(() => parsePackageListResponse({ data: [{ ...card, id: "1" }] }));
    assert.throws(() => parsePackageDetailResponse({ data: { ...detail, createdAt: "secret" } }));
  });

  it("parses a journey's uploaded image", () => {
    const image = {
      url: "https://media.example.com/media/3f1c/9a2b4c6d8e0f1234.webp",
      altText: "Dawn light along the causeway",
      width: 2048,
      height: 1365,
    };

    assert.deepEqual(parsePackageListResponse({ data: [{ ...card, image }] }).data[0].image, image);
    assert.deepEqual(parsePackageDetailResponse({ data: { ...detail, image } }).data.image, image);
  });

  it("keeps a decorative image, whose description is deliberately null", () => {
    const image = { url: "https://media.example.com/media/aa/bb.webp", altText: null, width: 10, height: 10 };

    assert.equal(parsePackageListResponse({ data: [{ ...card, image }] }).data[0].image?.altText, null);
  });

  it("requires the image key, so an older response cannot pass as imageless", () => {
    const withoutImage: Record<string, unknown> = { ...card };
    delete withoutImage.image;

    assert.throws(() => parsePackageListResponse({ data: [withoutImage] }));
    assert.throws(() => parsePackageDetailResponse({ data: { ...detail, image: undefined } }));
  });

  it("fails closed on a malformed image rather than treating it as none", () => {
    // Every one of these would otherwise become a placeholder on the public
    // site, which looks exactly like a journey nobody has uploaded a picture
    // for and would hide the fault completely.
    const valid = { url: "https://media.example.com/media/aa/bb.webp", altText: null, width: 10, height: 10 };

    for (const broken of [
      { ...valid, url: "" },
      { ...valid, url: "not-a-url" },
      { ...valid, url: "/media/aa/bb.webp" },
      { ...valid, url: "ftp://media.example.com/media/aa/bb.webp" },
      { ...valid, url: 42 },
      { ...valid, altText: 7 },
      { ...valid, width: 0 },
      { ...valid, height: -1 },
      { ...valid, width: 10.5 },
      { ...valid, width: "2048" },
      { url: valid.url, altText: null, width: 10 },
      [valid],
      "https://media.example.com/media/aa/bb.webp",
      false,
    ]) {
      assert.throws(
        () => parsePackageListResponse({ data: [{ ...card, image: broken }] }),
        `${JSON.stringify(broken)} should be refused`,
      );
    }
  });

  it("refuses an image carrying internal media fields", () => {
    // The reference, the object key, the checksum, the content type, the
    // byte size and the row ids are all internal. If the API ever started
    // sending one, this website would refuse the response rather than begin
    // depending on it.
    const valid = { url: "https://media.example.com/media/aa/bb.webp", altText: null, width: 10, height: 10 };

    for (const leaked of [
      "reference",
      "storageKey",
      "storage_key",
      "checksum",
      "contentType",
      "byteSize",
      "mediaAssetId",
      "bucket",
    ]) {
      assert.throws(
        () => parsePackageListResponse({ data: [{ ...card, image: { ...valid, [leaked]: "x" } }] }),
        `${leaked} should be refused`,
      );
    }
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
        currency: "USD",
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
