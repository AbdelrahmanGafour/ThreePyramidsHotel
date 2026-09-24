import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyPackageDetailResult, classifyPackageListResult } from "./publicPackages";

const card = { code: "T001", slug: "sample-tour", title: "Sample tour", summary: null, durationLabel: null, scheduleLabel: null, operatingDays: null, currency: "USD", requiresPriceConfirmation: false, pricing: { status: "unavailable", unit: "per_person", from: null } };
const detail = { ...card, description: null, itinerary: [], included: [], excluded: [], notes: [], variants: [] };

describe("public package page loaders", () => {
  it("fails closed on malformed list responses", () => {
    assert.equal(classifyPackageListResult({ status: 200, body: { data: [{ ...card, id: 1 }] } }).kind, "unavailable");
  });

  it("distinguishes trusted not-found from upstream failure", () => {
    assert.equal(classifyPackageDetailResult({ status: 404, body: { error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } } }).kind, "not_found");
    assert.equal(classifyPackageDetailResult({ status: 404, body: { error: { code: "OTHER", message: "No" } } }).kind, "unavailable");
    assert.equal(classifyPackageDetailResult({ status: 500, body: { error: { code: "PACKAGES_UNAVAILABLE", message: "Unavailable" } } }).kind, "unavailable");
  });

  it("accepts a strict detail contract", () => {
    assert.equal(classifyPackageDetailResult({ status: 200, body: { data: detail } }).kind, "success");
  });
});
