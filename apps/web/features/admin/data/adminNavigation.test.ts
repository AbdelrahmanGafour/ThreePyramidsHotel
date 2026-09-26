import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  adminNavigation,
  isAdminNavItemActive,
  sidebarNavigation,
} from "./adminNavigation";

// What the administration sidebar offers, and where each entry goes.
//
// The list itself is plain data, so it is asserted directly. The sidebar that
// renders it is a Client Component reaching `usePathname`, which cannot be
// loaded here — so the one structural fact the data cannot carry, that
// `View Website` is the sixth and last entry and leaves the admin, is
// asserted against the component's source.

const sidebarSource = readFileSync(
  "features/admin/components/AdminSidebar.tsx",
  "utf8",
);

/** The order an administrator reads down the sidebar. */
const EXPECTED = [
  { key: "overview", label: "Overview", href: "/admin" },
  { key: "rooms", label: "Rooms", href: "/admin/room-types" },
  { key: "reservations", label: "Room Reservations", href: "/admin/reservations" },
  { key: "journeys", label: "Journeys", href: "/admin/journeys" },
  {
    key: "packageReservations",
    label: "Journey Reservations",
    href: "/admin/package-reservations",
  },
] as const;

describe("admin sidebar navigation", () => {
  it("renders exactly the five in-admin entries, in order", () => {
    assert.deepEqual(
      sidebarNavigation.map((item) => [item.label, item.href]),
      EXPECTED.map((item) => [item.label, item.href]),
    );
  });

  it("keeps each entry pointing at the page that already exists", () => {
    for (const expected of EXPECTED) {
      const item = sidebarNavigation.find((entry) => entry.key === expected.key);

      assert.ok(item, `${expected.key} should be in the sidebar`);
      assert.equal(item.href, expected.href, `${expected.key} should keep its route`);
      assert.equal(item.label, expected.label);
    }
  });

  it("offers nothing that is not a real page", () => {
    for (const item of sidebarNavigation) {
      assert.equal(item.available, true, `${item.key} must be a real link, never a dead one`);
    }
  });

  it("no longer offers the areas that are not built", () => {
    for (const key of ["inquiries", "content", "media", "settings"]) {
      assert.ok(
        !sidebarNavigation.some((item) => item.key === key),
        `${key} should not be in the sidebar`,
      );
    }
  });

  it("keeps those areas defined, so nothing was deleted", () => {
    // Navigation cleanup only: their pages, routes and descriptions survive,
    // and the overview page still lists them as coming.
    for (const key of ["inquiries", "content", "media", "settings"]) {
      const item = adminNavigation.find((entry) => entry.key === key);

      assert.ok(item, `${key} should still be defined`);
      assert.equal(item.available, false, `${key} is still unbuilt`);
      assert.ok(item.description.length > 0, `${key} keeps its description`);
    }
  });

  it("names the two kinds of reservation apart", () => {
    const labels = sidebarNavigation.map((item) => item.label);

    assert.ok(labels.includes("Room Reservations"));
    assert.ok(labels.includes("Journey Reservations"));
    assert.ok(
      !labels.includes("Reservations"),
      "the bare label no longer says which kind",
    );
  });

  it("gives every entry a distinct key and route", () => {
    const keys = sidebarNavigation.map((item) => item.key);
    const hrefs = sidebarNavigation.map((item) => item.href);

    assert.equal(new Set(keys).size, keys.length);
    assert.equal(new Set(hrefs).size, hrefs.length);
  });
});

describe("admin sidebar: View Website", () => {
  it("is the sixth and last entry", () => {
    const foot = sidebarSource.slice(sidebarSource.indexOf('className="adm-sidebar-foot"'));

    assert.match(foot, /View Website/);
    assert.equal(
      (foot.match(/<li>/g) ?? []).length,
      1,
      "one entry below the five, so the sidebar reads six",
    );
  });

  it("keeps opening the public site in a new tab", () => {
    assert.match(sidebarSource, /href="\/" target="_blank" rel="noopener noreferrer"/);
    assert.match(sidebarSource, /\(opens in a new tab\)/);
  });

  it("is not a navigation item, because it leaves the admin", () => {
    // An external link has no area to highlight, so it is an anchor rather
    // than a NavEntry and holds no active state.
    const foot = sidebarSource.slice(sidebarSource.indexOf('className="adm-sidebar-foot"'));

    assert.ok(!foot.includes("<NavEntry"), "no active state to hold");
    assert.ok(!foot.includes("settingsNavigation"), "settings is no longer rendered here");
  });
});

describe("isAdminNavItemActive", () => {
  const entry = (key: string) => {
    const item = sidebarNavigation.find((candidate) => candidate.key === key);
    assert.ok(item, `${key} should be in the sidebar`);
    return item;
  };

  it("highlights Overview only on the overview itself", () => {
    assert.equal(isAdminNavItemActive("/admin", entry("overview")), true);

    // Otherwise it would claim every page in the admin.
    for (const pathname of ["/admin/journeys", "/admin/reservations", "/admin/room-types"]) {
      assert.equal(isAdminNavItemActive(pathname, entry("overview")), false, pathname);
    }
  });

  it("keeps Journeys highlighted on every page beneath it", () => {
    for (const pathname of [
      "/admin/journeys",
      "/admin/journeys/new",
      "/admin/journeys/nile-dinner-cruise",
      "/admin/journeys/nile-dinner-cruise/edit",
      "/admin/journeys/nile-dinner-cruise/content",
      "/admin/journeys/nile-dinner-cruise/itinerary",
      "/admin/journeys/nile-dinner-cruise/variants/new",
      "/admin/journeys/nile-dinner-cruise/variants/standard/edit",
      "/admin/journeys/nile-dinner-cruise/variants/standard/rates",
    ]) {
      assert.equal(isAdminNavItemActive(pathname, entry("journeys")), true, pathname);
    }
  });

  it("keeps Journey Reservations highlighted on a booking's detail", () => {
    for (const pathname of [
      "/admin/package-reservations",
      "/admin/package-reservations/TPP-ABCDEFGHJKLM",
    ]) {
      assert.equal(isAdminNavItemActive(pathname, entry("packageReservations")), true, pathname);
    }
  });

  it("keeps Rooms highlighted on a room type's pages", () => {
    for (const pathname of [
      "/admin/room-types",
      "/admin/room-types/new",
      "/admin/room-types/room-concept-01",
    ]) {
      assert.equal(isAdminNavItemActive(pathname, entry("rooms")), true, pathname);
    }
  });

  it("keeps Room Reservations highlighted on a booking's detail", () => {
    for (const pathname of ["/admin/reservations", "/admin/reservations/TPH-123456"]) {
      assert.equal(isAdminNavItemActive(pathname, entry("reservations")), true, pathname);
    }
  });

  it("never highlights two areas at once", () => {
    // The two reservation routes are the pair that could collide, since one
    // label contains the other. They do not: the prefixes differ.
    for (const pathname of [
      "/admin",
      "/admin/room-types",
      "/admin/room-types/room-concept-01",
      "/admin/reservations",
      "/admin/reservations/TPH-123456",
      "/admin/journeys",
      "/admin/journeys/nile-dinner-cruise/edit",
      "/admin/package-reservations",
      "/admin/package-reservations/TPP-ABCDEFGHJKLM",
    ]) {
      const active = sidebarNavigation.filter((item) => isAdminNavItemActive(pathname, item));

      assert.equal(active.length, 1, `${pathname} highlighted ${active.length} areas`);
    }
  });

  it("resolves a journey booking to its own area, not to the room one", () => {
    assert.equal(
      isAdminNavItemActive("/admin/package-reservations", entry("reservations")),
      false,
      "a journey booking is not a room booking",
    );
  });

  it("highlights nothing on a page outside the sidebar's areas", () => {
    const active = sidebarNavigation.filter(
      (item) => isAdminNavItemActive("/admin/settings", item),
    );

    assert.deepEqual(active, [], "an unlisted area claims no highlight");
  });
});
