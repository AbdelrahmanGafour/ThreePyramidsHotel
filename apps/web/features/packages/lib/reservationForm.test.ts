import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PublicPackageDetail } from "@/features/packages/api/contracts";
import {
  buildPackageReservationRequest,
  emptyPackageReservationDraft,
  initialVariantKey,
  resizeChildAges,
  validatePackageReservationDraft,
  variantNeedsChildAges,
} from "./reservationForm";

const pkg: PublicPackageDetail = {
  code: "T001", slug: "sample-tour", title: "Sample tour", summary: "Summary", description: "Description",
  durationLabel: "4 hours", scheduleLabel: "Daily", operatingDays: null, currency: "USD",
  requiresPriceConfirmation: false, pricing: { status: "from", unit: "per_person", from: { adultUnitRate: "100.00", variantKey: "standard", minPartySize: 1, maxPartySize: null } },
  itinerary: [], included: [], excluded: [], notes: [],
  variants: [{ key: "standard", label: "Standard", isDefault: true, childMinAge: 6, childMaxAge: 12, childDiscountPercent: "50.00", rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: "100.00", currency: "USD" }] }],
};

describe("package reservation form mapping", () => {
  it("uses the single/default variant", () => {
    assert.equal(initialVariantKey(pkg), "standard");
    assert.equal(initialVariantKey({ variants: [{ ...pkg.variants[0], key: "a", isDefault: false }, { ...pkg.variants[0], key: "b", isDefault: true }] }), "b");
  });

  it("collects child ages only when the selected variant has an explicit child rule", () => {
    assert.equal(variantNeedsChildAges(pkg.variants[0], 2), true);
    assert.equal(variantNeedsChildAges({ ...pkg.variants[0], childDiscountPercent: null }, 2), false);
    assert.deepEqual(resizeChildAges(["8"], 2), ["8", ""]);
  });

  it("builds only the public reservation request fields", () => {
    const draft = { ...emptyPackageReservationDraft(pkg), tourDate: "2030-01-07", adults: "2", children: "1", childAges: ["10"], guestFirstName: " Ada ", guestLastName: " Guest ", guestEmail: "ada@example.com", guestPhone: "+201000000000", guestCountry: "Egypt", specialRequests: " Window seat " };
    assert.deepEqual(buildPackageReservationRequest(pkg, draft), {
      packageSlug: "sample-tour", variantKey: "standard", tourDate: "2030-01-07", adults: 2, children: 1, childAges: [10], guestFirstName: "Ada", guestLastName: "Guest", guestEmail: "ada@example.com", guestPhone: "+201000000000", guestCountry: "Egypt", specialRequests: "Window seat",
    });
  });

  it("rejects missing guest/date/party data before POST", () => {
    const errors = validatePackageReservationDraft(pkg, emptyPackageReservationDraft(pkg));
    assert.ok(errors.tourDate);
    assert.ok(errors.guestFirstName);
    assert.ok(errors.guestLastName);
    assert.ok(errors.guestEmail);
    assert.ok(errors.guestPhone);
    assert.ok(errors.guestCountry);
  });
});
