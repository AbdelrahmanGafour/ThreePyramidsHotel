import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminOverview } from "./AdminOverview";

const render = (displayName: string | null) =>
  renderToStaticMarkup(<AdminOverview displayName={displayName} />);

describe("AdminOverview", () => {
  it("greets the administrator by name", () => {
    assert.match(render("Amira"), /<h1 class="adm-overview-greeting">Welcome, Amira<\/h1>/);
  });

  it("greets without a name when the session could not be read", () => {
    const html = render(null);

    assert.match(html, /<h1 class="adm-overview-greeting">Welcome back<\/h1>/);
    assert.ok(!html.includes("null") && !html.includes("undefined"));
  });

  it("says the welcome line under the greeting", () => {
    const html = render("Amira");

    assert.match(html, /class="adm-overview-lede">Welcome back to the hotel admin\./);
    assert.ok(html.indexOf("Welcome, Amira") < html.indexOf("Welcome back to the hotel admin"));
  });

  it("offers the four ways on, each to its existing route", () => {
    const html = render("Amira");

    for (const [label, href] of [
      ["Rooms", "/admin/room-types"],
      ["Room Reservations", "/admin/reservations"],
      ["Journeys", "/admin/journeys"],
      ["Journey Reservations", "/admin/package-reservations"],
    ] as const) {
      assert.ok(
        html.includes(`<a class="adm-quicklink" href="${href}">${label}</a>`),
        `${label} should link to ${href}`,
      );
    }
  });

  it("offers exactly those four, in that order, and no more", () => {
    const html = render("Amira");
    const links = html.match(/class="adm-quicklink" href="([^"]+)"/g) ?? [];

    assert.deepEqual(links.map((link) => link.split('href="')[1]?.slice(0, -1)), [
      "/admin/room-types",
      "/admin/reservations",
      "/admin/journeys",
      "/admin/package-reservations",
    ]);
  });

  it("names the group of links, so it is not four unexplained buttons", () => {
    assert.match(render("Amira"), /<nav class="adm-quicklinks" aria-label="Go to">/);
  });

  it("is the whole page: a greeting, a line, and the links", () => {
    // Anything else here would be the dashboard this page deliberately is not.
    const html = render("Amira");

    assert.equal((html.match(/<h1/g) ?? []).length, 1);
    assert.equal((html.match(/<h2/g) ?? []).length, 0, "no panels, so no panel headings");
    assert.ok(!html.includes("adm-panel"), "no cards");
    assert.ok(!html.includes("<table"), "no tables");
  });
});

describe("the admin overview page", () => {
  const page = readFileSync("app/(dashboard)/admin/page.tsx", "utf8");

  it("renders none of the dashboard modules it used to", () => {
    for (const gone of [
      "OverviewMetrics",
      "TodaysStays",
      "RoomStatusPanel",
      "LatestInquiries",
      "ManagementAreas",
    ]) {
      assert.ok(!page.includes(gone), `${gone} is no longer on the overview`);
    }
  });

  it("shows no counts, demo notice or panel grid", () => {
    for (const gone of ["adm-metrics", "adm-grid", "adm-demo-note", "Showing demo data"]) {
      assert.ok(!page.includes(gone), `${gone} is gone from the overview`);
    }
  });

  it("takes the display name from the session the layout already read", () => {
    // Memoised per request, so this adds no call to the API.
    assert.match(page, /getCurrentAdminSession\(\)/);
    assert.match(page, /session\.administrator\.displayName/);
    assert.ok(!page.includes("fetch("), "and makes no request of its own");
  });

  it("falls back to a nameless greeting rather than throwing", () => {
    assert.match(page, /session\.state === "authenticated" \? .* : null/s);
  });
});

describe("the session read the overview shares with the layout", () => {
  const source = readFileSync("features/admin/server/currentAdminSession.ts", "utf8");

  it("is memoised per request, so two readers make one call", () => {
    assert.match(source, /import \{ cache \} from "react";/);
    assert.match(source, /export const getCurrentAdminSession = cache\(/);
  });
});
