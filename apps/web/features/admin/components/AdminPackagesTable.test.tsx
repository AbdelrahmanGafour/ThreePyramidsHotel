import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminPackagesTable } from "./AdminPackagesTable";
import { adminNavigation } from "../data/adminNavigation";
import type { AdminPackageListItem } from "../types";

// Rendered rather than inspected: what matters is the text an administrator
// reads — above all whether a journey is on sale and whether editing it would
// be undone by the catalogue seed.

function offering(overrides: Partial<AdminPackageListItem> = {}): AdminPackageListItem {
  return {
    code: "T016",
    slug: "nile-dinner-cruise",
    title: "Nile Dinner Cruise",
    summary: "An evening on the water.",
    durationLabel: "Evening",
    scheduleLabel: "Daily",
    requiresPriceConfirmation: false,
    isActive: true,
    sortOrder: 16,
    managementSource: "brochure",
    variantCount: 2,
    defaultVariantLabel: "Standard service",
    ...overrides,
  };
}

const render = (packages: AdminPackageListItem[]) =>
  renderToStaticMarkup(<AdminPackagesTable data={{ packages }} />);

describe("AdminPackagesTable", () => {
  it("renders a journey with every field an administrator needs", () => {
    const html = render([offering()]);

    for (const expected of [
      "T016",
      "Nile Dinner Cruise",
      "An evening on the water.",
      "Evening",
      "Daily",
      "2 variants",
      "Standard service",
      "Active",
      "Brochure-managed",
    ]) {
      assert.ok(html.includes(expected), `the page should show ${expected}`);
    }
  });

  it("shows active and inactive distinctly", () => {
    const active = render([offering({ isActive: true })]);
    assert.match(active, /Active/);
    assert.ok(!/Inactive/.test(active));

    const inactive = render([offering({ isActive: false })]);
    assert.match(inactive, /Inactive/);
  });

  it("labels both ownerships in words an administrator can act on", () => {
    assert.match(render([offering({ managementSource: "brochure" })]), /Brochure-managed/);
    assert.match(render([offering({ managementSource: "admin" })]), /Admin-managed/);
  });

  it("flags a manual-confirmation journey, and only that one", () => {
    const onRequest = render([offering({ requiresPriceConfirmation: true })]);
    assert.match(onRequest, /Price on request/);

    const priced = render([offering({ requiresPriceConfirmation: false })]);
    assert.ok(!/Price on request/.test(priced), "an absent badge means priced outright");
  });

  it("says a journey has no variants rather than showing a bare zero", () => {
    const html = render([offering({ variantCount: 0, defaultVariantLabel: null })]);

    assert.match(html, /No variants/);
    assert.ok(!/Default:/.test(html), "there is no default to name");
    assert.ok(!/>0</.test(html), "never a bare count");
  });

  it("counts one variant in the singular", () => {
    assert.match(render([offering({ variantCount: 1 })]), /1 variant(?!s)/);
  });

  it("names unset duration and schedule rather than leaving them blank", () => {
    const html = render([offering({ durationLabel: null, scheduleLabel: null, summary: null })]);

    assert.match(html, /Not set/);
    assert.ok(!/null|undefined/.test(html), "no raw absence value reaches the page");
  });

  it("renders the empty state rather than an empty table", () => {
    const html = render([]);

    assert.match(html, /No journeys yet/);
    assert.ok(!/<table/.test(html), "there is no table to show");
  });

  it("renders several journeys in the order given", () => {
    const html = render([
      offering({ code: "T001", title: "First Journey" }),
      offering({ code: "P01", title: "Second Journey" }),
    ]);

    assert.ok(html.indexOf("First Journey") < html.indexOf("Second Journey"), "API order is preserved");
  });

  it("links the journey title to its detail page", () => {
    const html = render([offering()]);

    assert.match(
      html,
      /href="\/admin\/journeys\/nile-dinner-cruise"/,
      "the title is the way into the detail page",
    );
  });

  it("encodes a slug that would otherwise change the link's shape", () => {
    // The API only ever issues canonical slugs, but the href is built from
    // data rather than trusted, so this proves the encoding is real.
    const html = render([offering({ slug: "a/b?c#d" })]);

    assert.match(html, /href="\/admin\/journeys\/a%2Fb%3Fc%23d"/);
  });

  it("exposes no internal identifiers or raw ownership column", () => {
    const html = render([offering()]);

    for (const leaked of ["packageId", "package_id", "seed_managed", "seedManaged"]) {
      assert.ok(!html.includes(leaked), `${leaked} must not reach the page`);
    }
  });
});

describe("admin navigation", () => {
  it("makes the reserved journeys entry available and points it at the route", () => {
    const journeys = adminNavigation.find((item) => item.key === "journeys");

    assert.ok(journeys, "the journeys entry should still exist");
    assert.equal(journeys.href, "/admin/journeys");
    assert.equal(journeys.available, true, "the page exists now, so it is a real link");
    assert.equal(journeys.label, "Journeys");
  });

  it("leaves the areas that are still unbuilt unavailable", () => {
    for (const key of ["inquiries", "content", "media", "settings"]) {
      const item = adminNavigation.find((entry) => entry.key === key);
      assert.equal(item?.available, false, `${key} has no page yet`);
    }
  });
});
