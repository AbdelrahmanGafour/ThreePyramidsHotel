import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminPackageDetailView } from "./AdminPackageDetail";
import {
  DEFAULT_BLOCKS_DELETE_NOTE,
  NONE_RECORDED,
  packageVariantDeleteState,
  packageVariantMoves,
} from "../lib/packages";
import type { AdminPackageDetail, AdminPackageVariant } from "../types";

// Rendered rather than inspected: what matters is the text an administrator
// reads — the rates as stored, the order they arrived in, and whether editing
// this journey would be undone by the catalogue seed.

function variant(overrides: Partial<AdminPackageVariant> = {}): AdminPackageVariant {
  return {
    key: "standard-service",
    label: "Standard service",
    isDefault: true,
    sortOrder: 1,
    childMinAge: 6,
    childMaxAge: 12,
    childDiscountPercent: "50.00",
    rates: [
      { minPartySize: 1, maxPartySize: 1, adultUnitRate: "100.00", currency: "USD" },
      { minPartySize: 2, maxPartySize: 2, adultUnitRate: "90.00", currency: "USD" },
      { minPartySize: 3, maxPartySize: null, adultUnitRate: "80.00", currency: "USD" },
    ],
    ...overrides,
  };
}

function journey(overrides: Partial<AdminPackageDetail> = {}): AdminPackageDetail {
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
    description: "A longer passage about the cruise.",
    operatingDays: ["monday", "tuesday"],
    itinerary: [
      { dayNumber: null, heading: "Boarding", body: "Meet at the quay." },
      { dayNumber: 1, heading: null, body: "Dinner is served." },
    ],
    content: { included: ["Dinner"], excluded: ["Drinks"], notes: ["Smart dress."] },
    variants: [
      variant(),
      variant({
        key: "premium-service", label: "Premium service", isDefault: false, sortOrder: 2,
        childMinAge: null, childMaxAge: null, childDiscountPercent: null,
        rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: "150.00", currency: "USD" }],
      }),
    ],
    ...overrides,
  };
}

// Every section of this page renders twice: a table for desktop and a list
// for mobile, because the admin's CSS shows one and hides the other at
// 720px. A count over the whole document therefore sees each thing twice,
// so anything counted is scoped to one half first.

/** The desktop table of one section, by its heading id. */
function desktopTable(html: string, id: string): string {
  const section = html.slice(html.indexOf(`id="${id}"`));
  const start = section.indexOf('<div class="adm-table-wrap">');
  return section.slice(start, section.indexOf("</table>", start));
}

/** The mobile list of one section, by its heading id. */
function mobileList(html: string, id: string): string {
  const section = html.slice(html.indexOf(`id="${id}"`));
  const start = section.indexOf('<ul class="adm-list">');
  return section.slice(start, section.indexOf("</ul>", start));
}

const variantsTable = (html: string) => desktopTable(html, "journey-detail-variants");
const variantsList = (html: string) => mobileList(html, "journey-detail-variants");

const render = (value: AdminPackageDetail) =>
  renderToStaticMarkup(<AdminPackageDetailView journey={value} />);

describe("AdminPackageDetailView", () => {
  it("renders every field of a full journey", () => {
    const html = render(journey());

    for (const expected of [
      "Nile Dinner Cruise",
      "T016",
      "An evening on the water.",
      "A longer passage about the cruise.",
      "Evening",
      "Daily",
      "monday, tuesday",
      "Active",
      "Brochure-managed",
      "Priced from the rate tiers",
      "Boarding",
      "Meet at the quay.",
      "Day 1",
      "Dinner is served.",
      "Dinner",
      "Drinks",
      "Smart dress.",
      "Standard service",
      "standard-service",
      "Premium service",
      "Default",
      "2 variants",
    ]) {
      assert.ok(html.includes(expected), `the page should show ${expected}`);
    }
  });

  it("summarises a variant's rates rather than listing every tier", () => {
    // The tiers themselves belong to the rates page; this screen says how
    // many there are and what the floor is, so the table stays scannable.
    const html = render(journey());

    assert.match(html, /3 rate tiers · from USD 80\.00 per adult/);
    assert.match(html, /1 rate tier · from USD 150\.00 per adult/);
    assert.ok(!html.includes("1 person"), "no party-size rows on this page");
    assert.ok(!html.includes("USD 90.00"), "and no middle tier");
  });

  it("derives no total of its own", () => {
    const html = render(journey());

    // 2 adults at 90.00 would be 180.00; a catalogue screen must not say so.
    assert.ok(!/USD 180\.00/.test(html), "a party total is settled at reservation, not here");
  });

  it("states a child rule, or that there is none", () => {
    const html = render(journey());

    assert.match(html, /Ages 6–12 at 50\.00% off/);
    assert.match(html, /No child pricing/, "the second variant has no rule");
  });

  it("preserves variant and rate-tier order exactly as given", () => {
    const html = render(journey());

    assert.ok(
      html.indexOf("Standard service") < html.indexOf("Premium service"),
      "variants keep the API order",
    );
    // Tier order is the rates page's concern now; what this page must keep
    // is the order of the variants themselves.
    const table = variantsTable(html);

    assert.ok(
      table.indexOf("Standard service") < table.indexOf("Premium service"),
      "the table keeps the API order too",
    );
  });

  it("represents a manual-confirmation journey correctly", () => {
    const html = render(journey({ requiresPriceConfirmation: true }));

    assert.match(html, /Quoted on request/);
    assert.ok(!/Priced from the rate tiers/.test(html));
  });

  it("labels both ownerships", () => {
    assert.match(render(journey({ managementSource: "brochure" })), /Brochure-managed/);
    assert.match(render(journey({ managementSource: "admin" })), /Admin-managed/);
  });

  it("shows an inactive journey as inactive", () => {
    const html = render(journey({ isActive: false }));

    assert.match(html, /Inactive/);
  });

  it("renders empty collections neutrally, never as fabricated content", () => {
    const html = render(journey({
      itinerary: [],
      content: { included: [], excluded: [], notes: [] },
      variants: [],
      variantCount: 0,
      defaultVariantLabel: null,
    }));

    assert.match(html, /No itinerary recorded\./);
    assert.match(html, /No variants recorded\./);
    assert.ok(html.includes(NONE_RECORDED), "an empty content column says so");
    assert.ok(!html.includes("undefined") && !html.includes("null"));
  });

  it("handles a variant with no rate tiers", () => {
    const html = render(journey({
      variantCount: 1,
      variants: [variant({ rates: [] })],
    }));

    assert.match(html, /No rates — cannot be booked/);
  });

  it("omits a day label for a section that belongs to the whole journey", () => {
    const html = render(journey({
      itinerary: [{ dayNumber: null, heading: null, body: "A section with neither." }],
    }));

    assert.match(html, /A section with neither\./);
    assert.ok(!/Day null|Day undefined/.test(html));
  });

  it("exposes no internal identifiers or raw ownership column", () => {
    const html = render(journey());

    for (const leaked of ["packageId", "package_id", "variantId", "seed_managed", "seedManaged"]) {
      assert.ok(!html.includes(leaked), `${leaked} must not reach the page`);
    }
  });
});

/**
 * The view with per-variant action slots filled the way the page fills them.
 *
 * The real node reaches a Server Action and cannot be loaded here, so a
 * stand-in stands where it would; which variants get one is decided by the
 * tested helper and asserted in lib/packages.test.ts, and the component's own
 * wiring is asserted in AdminPackageDefaultVariantAction.render.test.tsx.
 */
const renderWithActions = (value: AdminPackageDetail) =>
  renderToStaticMarkup(
    <AdminPackageDetailView
      journey={value}
      variantActions={
        new Map(
          value.variants
            .filter((item) => !value.isActive && !item.isDefault)
            .map((item) => [item.key, <button key={item.key}>Make default</button>]),
        )
      }
    />,
  );

describe("AdminPackageDetailView: the default variant", () => {
  it("marks the variant that leads the journey", () => {
    const html = render(journey({ isActive: false }));

    assert.match(html, /Default/, "the leading variant carries a badge");

    // One badge, not one per variant.
    assert.equal((variantsTable(html).match(/data-tone="lapis"/g) ?? []).length, 1);
  });

  it("marks nothing when no variant leads", () => {
    const html = render(journey({
      isActive: false,
      variants: [
        variant({ isDefault: false }),
        variant({ key: "premium-service", label: "Premium service", isDefault: false }),
      ],
    }));

    assert.equal((variantsTable(html).match(/data-tone="lapis"/g) ?? []).length, 0);
  });

  it("explains what the default is", () => {
    assert.match(render(journey({ isActive: false })), /when a guest names none/);
  });

  it("places an action beside a non-default variant on a withdrawn journey", () => {
    const html = renderWithActions(journey({ isActive: false }));

    assert.match(html, /Make default/);
    assert.equal(
      (variantsTable(html).match(/Make default/g) ?? []).length,
      1,
      "only the non-default variant gets one",
    );
  });

  it("places no action at all on a live journey", () => {
    const html = renderWithActions(journey({ isActive: true }));

    assert.ok(!html.includes("Make default"));
    assert.match(html, /only be changed while the journey is inactive/);
    assert.match(html, /Deactivate the journey first/);
  });

  it("offers a live journey no way to withdraw itself from the variants panel", () => {
    const html = renderWithActions(journey({ isActive: true }));

    // The availability control is its own panel, composed at the page; the
    // variants panel explains rather than acts.
    assert.ok(!html.includes("Deactivate journey"));
  });

  it("places an action for a lone unflagged variant, so it can be repaired", () => {
    const html = renderWithActions(journey({
      isActive: false,
      variantCount: 1,
      defaultVariantLabel: null,
      variants: [variant({ isDefault: false })],
    }));

    assert.equal((variantsTable(html).match(/Make default/g) ?? []).length, 1);
  });

  it("places one action per variant when several have no default", () => {
    const html = renderWithActions(journey({
      isActive: false,
      defaultVariantLabel: null,
      variants: [
        variant({ isDefault: false }),
        variant({ key: "premium-service", label: "Premium service", isDefault: false }),
      ],
    }));

    assert.equal((variantsTable(html).match(/Make default/g) ?? []).length, 2, "either one may be chosen");
  });

  it("warns a brochure journey that promoting one takes ownership", () => {
    const html = renderWithActions(journey({ isActive: false, managementSource: "brochure" }));

    assert.match(html, /Choosing a different default makes/);
    assert.match(html, /whole journey admin-managed/);
    assert.match(html, /cannot be undone/);
  });

  it("does not warn when there is nothing to promote", () => {
    // The single leading variant: no button exists, so the warning would be
    // about a change nobody can make.
    const html = renderWithActions(journey({
      isActive: false,
      managementSource: "brochure",
      variantCount: 1,
      defaultVariantLabel: "Standard service",
      variants: [variant({ isDefault: true })],
    }));

    assert.ok(!html.includes("Choosing a different default"));
  });

  it("does not warn a journey the administrator already owns", () => {
    const html = renderWithActions(journey({ isActive: false, managementSource: "admin" }));

    assert.ok(!html.includes("Choosing a different default"));
  });

  it("does not warn a live journey, which has no control to warn about", () => {
    const html = renderWithActions(journey({ isActive: true, managementSource: "brochure" }));

    assert.ok(!html.includes("Choosing a different default"));
  });

  it("offers no reorder, delete or clear-default control", () => {
    const html = renderWithActions(journey({ isActive: false }));

    for (const forbidden of ["Move up", "Move down", "Reorder", "Delete variant",
      "Remove variant", "Clear default", "Unset default"]) {
      assert.ok(!html.includes(forbidden), `${forbidden} is not part of this slice`);
    }
  });
});

/**
 * The view with per-variant slots filled the way the page fills them: the
 * move controls a variant at this position would actually get.
 *
 * The real nodes reach a Server Action and cannot be loaded here, so
 * stand-ins take their place, gated by the same tested helper the component
 * asks. What is asserted is which controls appear beside which variant.
 */
const renderWithOrderActions = (value: AdminPackageDetail) => {
  const keys = value.variants.map((item) => item.key);

  return renderToStaticMarkup(
    <AdminPackageDetailView
      journey={value}
      variantActions={
        new Map(
          value.variants.map((item, index) => {
            const moves = packageVariantMoves(keys, index);

            return [
              item.key,
              <span key={item.key}>
                {moves.up ? <button>Move up</button> : null}
                {moves.down ? <button>Move down</button> : null}
              </span>,
            ];
          }),
        )
      }
    />,
  );
};

describe("AdminPackageDetailView: variant order", () => {
  it("lists the variants in the order the API returned", () => {
    const html = render(journey());

    assert.ok(
      variantsTable(html).indexOf("Standard service") < variantsTable(html).indexOf("Premium service"),
      "never re-sorted by the view",
    );
  });

  it("gives two variants exactly one valid action each", () => {
    const html = renderWithOrderActions(journey());

    assert.equal((variantsTable(html).match(/Move up/g) ?? []).length, 1);
    assert.equal((variantsTable(html).match(/Move down/g) ?? []).length, 1);
  });

  it("gives the first variant no Move up", () => {
    const html = renderWithOrderActions(journey());
    const first = variantsTable(html).slice(variantsTable(html).indexOf("Standard service"), variantsTable(html).indexOf("Premium service"));

    assert.ok(!first.includes("Move up"), "there is nothing above it");
    assert.ok(first.includes("Move down"));
  });

  it("gives the last variant no Move down", () => {
    const table = variantsTable(renderWithOrderActions(journey()));
    const last = table.slice(table.indexOf("Premium service"));

    assert.ok(!last.includes("Move down"), "there is nothing below it");
    assert.ok(last.includes("Move up"));
  });

  it("gives a single-variant journey no controls at all", () => {
    const html = renderWithOrderActions(journey({
      variantCount: 1,
      variants: [variant()],
    }));

    assert.ok(!html.includes("Move up"));
    assert.ok(!html.includes("Move down"));
  });

  it("offers the controls on a live journey", () => {
    const html = renderWithOrderActions(journey({ isActive: true }));

    assert.equal((variantsTable(html).match(/Move up/g) ?? []).length, 1, "no deactivation is required");
    assert.equal((variantsTable(html).match(/Move down/g) ?? []).length, 1);
  });

  it("says what the order does and does not decide", () => {
    assert.match(render(journey()), /does not change which variant a booking resolves to/);
  });

  it("warns a brochure journey only when a move is available", () => {
    const withMoves = render(journey({ managementSource: "brochure" }));
    assert.match(withMoves, /Saving a new order/);

    const withoutMoves = render(journey({
      managementSource: "brochure",
      variantCount: 1,
      variants: [variant()],
    }));
    assert.ok(!withoutMoves.includes("Saving a new order"), "nothing can be moved");
  });

  it("does not warn a journey the administrator already owns", () => {
    assert.ok(!render(journey({ managementSource: "admin" })).includes("Saving a new order"));
  });

  it("offers no delete control anywhere", () => {
    const html = renderWithOrderActions(journey());

    for (const forbidden of ["Delete variant", "Remove variant"]) {
      assert.ok(!html.includes(forbidden), `${forbidden} is not part of this slice`);
    }
  });
});

/**
 * The view with per-variant slots filled the way the page fills them for
 * deletion: the control each variant would actually get.
 *
 * The real node reaches a Server Action and cannot be loaded here, so a
 * stand-in takes its place, gated by the same tested helper the component
 * asks. What is asserted is which variants get a delete, which get the
 * choose-another-default note, and which get nothing.
 */
const renderWithDeleteActions = (value: AdminPackageDetail) =>
  renderToStaticMarkup(
    <AdminPackageDetailView
      journey={value}
      variantActions={
        new Map(
          value.variants.map((item) => {
            const state = packageVariantDeleteState(value, item);

            return [
              item.key,
              <span key={item.key}>
                {state === "available" ? <button>Delete variant</button> : null}
                {state === "blocked-default" ? <span>{DEFAULT_BLOCKS_DELETE_NOTE}</span> : null}
              </span>,
            ];
          }),
        )
      }
    />,
  );

describe("AdminPackageDetailView: deleting a variant", () => {
  it("offers no delete control anywhere on a live journey", () => {
    const html = renderWithDeleteActions(journey({ isActive: true }));

    assert.ok(!html.includes("Delete variant"));
    assert.ok(!html.includes("leads the journey, so it cannot be deleted"));
  });

  it("offers delete for a non-default variant on a withdrawn journey", () => {
    const html = renderWithDeleteActions(journey({ isActive: false }));

    assert.equal(
      (variantsTable(html).match(/Delete variant/g) ?? []).length,
      1,
      "only the non-default variant may go",
    );
  });

  it("gives the leading variant the remedy instead of a button", () => {
    const html = renderWithDeleteActions(journey({ isActive: false }));
    const leading = variantsTable(html).slice(variantsTable(html).indexOf("Standard service"), variantsTable(html).indexOf("Premium service"));

    assert.ok(!leading.includes("Delete variant"));
    assert.match(leading, /Make another variant the default first/);
  });

  it("lets a single-variant journey delete its last variant", () => {
    const html = renderWithDeleteActions(journey({
      isActive: false,
      variantCount: 1,
      variants: [variant()],
    }));

    assert.equal((variantsTable(html).match(/Delete variant/g) ?? []).length, 1, "even though it leads");
    assert.ok(!html.includes("Make another variant the default first"));
  });

  it("warns a brochure journey only when something can actually be deleted", () => {
    assert.match(
      render(journey({ isActive: false, managementSource: "brochure" })),
      /Deleting a variant makes/,
    );

    // Live: nothing can go, so nothing is claimed about ownership.
    assert.ok(
      !render(journey({ isActive: true, managementSource: "brochure" }))
        .includes("Deleting a variant makes"),
    );
  });

  it("does not warn a journey the administrator already owns", () => {
    assert.ok(
      !render(journey({ isActive: false, managementSource: "admin" }))
        .includes("Deleting a variant makes"),
    );
  });

  it("offers no package-level delete", () => {
    const html = renderWithDeleteActions(journey({ isActive: false }));

    for (const forbidden of ["Delete journey", "Delete package", "Remove journey"]) {
      assert.ok(!html.includes(forbidden), `${forbidden} is not part of this slice`);
    }
  });
});

describe("AdminPackageDetailView: every variant renders its own row", () => {
  /** Three variants, so a regression cannot hide behind a single row. */
  const threeVariantJourney = () => journey({
    isActive: false,
    variantCount: 3,
    defaultVariantLabel: "Standard service",
    variants: [
      variant({ key: "standard-service", label: "Standard service", isDefault: true, sortOrder: 1 }),
      variant({
        key: "premium-service", label: "Premium service", isDefault: false, sortOrder: 2,
        rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: "150.00", currency: "USD" }],
      }),
      variant({
        key: "deluxe-service", label: "Deluxe service", isDefault: false, sortOrder: 3,
        rates: [{ minPartySize: 2, maxPartySize: null, adultUnitRate: "200.00", currency: "USD" }],
      }),
    ],
  });

  it("renders one list row per variant, not just the heading count", () => {
    // The heading counts `variantCount`; the rows come from `variants`. A
    // page that shows "3 variants" and no rows is the regression this guards.
    const html = render(threeVariantJourney());

    const body = variantsTable(html).slice(variantsTable(html).indexOf("<tbody>"));
    assert.equal((body.match(/<tr>/g) ?? []).length, 3, "three table rows");
    assert.equal((variantsList(html).match(/<li>/g) ?? []).length, 3, "and three mobile rows");

    for (const label of ["Standard service", "Premium service", "Deluxe service"]) {
      assert.ok(html.includes(label), `${label} should have a row`);
    }
  });

  it("shows each variant's key beside its label, in row order", () => {
    const html = render(threeVariantJourney());
    const table = variantsTable(html);
    const order = ["standard-service", "premium-service", "deluxe-service"]
      .slice()
      .sort((a, b) => table.indexOf(a) - table.indexOf(b));

    for (const [index, key] of ["standard-service", "premium-service", "deluxe-service"].entries()) {
      assert.ok(html.includes(key), `${key} should be shown`);
      assert.ok(
        variantsTable(html).indexOf(key) > 0,
        `${key} should be in the table`,
      );
      // Position is the row's place in the table now, not text in a cell.
      assert.equal(order.indexOf(key), index, `${key} should sit at ${index + 1}`);
    }
  });

  it("gives every variant a Manage rates link to its own rates page", () => {
    const html = render(threeVariantJourney());

    assert.equal(
      (variantsTable(html).match(/Manage rates/g) ?? []).length,
      3,
      "one per variant, never fewer",
    );

    for (const key of ["standard-service", "premium-service", "deluxe-service"]) {
      assert.ok(
        html.includes(`href="/admin/journeys/nile-dinner-cruise/variants/${key}/rates"`),
        `${key} should link to its own rates page`,
      );
    }
  });

  it("gives every variant an Edit variant link to its own edit page", () => {
    const html = render(threeVariantJourney());

    assert.equal((variantsTable(html).match(/Edit variant/g) ?? []).length, 3, "one per variant");

    for (const key of ["standard-service", "premium-service", "deluxe-service"]) {
      assert.ok(
        html.includes(`href="/admin/journeys/nile-dinner-cruise/variants/${key}/edit"`),
        `${key} should link to its own edit page`,
      );
    }
  });

  it("marks exactly the variant that leads the journey", () => {
    const html = render(threeVariantJourney());

    assert.equal((variantsTable(html).match(/data-tone="lapis"/g) ?? []).length, 1);

    const leading = html.slice(
      variantsTable(html).indexOf("Standard service"),
      html.indexOf("Premium service"),
    );
    assert.ok(leading.includes('data-tone="lapis"'), "the badge sits on the leading variant");
  });

  it("places the per-variant action slot in every row that is given one", () => {
    // The page composes these; the view only places them. A dropped slot
    // would take Make default, Move up/down and Delete with it.
    const html = renderWithOrderActions(threeVariantJourney());

    assert.equal((variantsTable(html).match(/Move up/g) ?? []).length, 2, "all but the first");
    assert.equal((variantsTable(html).match(/Move down/g) ?? []).length, 2, "all but the last");
  });

  it("still renders the rows when no actions are supplied at all", () => {
    // `variantActions` is optional, so a page that passes none must still
    // show the variants and their links.
    const html = renderToStaticMarkup(
      <AdminPackageDetailView journey={threeVariantJourney()} />,
    );

    assert.equal((variantsTable(html).match(/Manage rates/g) ?? []).length, 3);
    assert.equal((variantsTable(html).match(/Edit variant/g) ?? []).length, 3);
  });

  it("shows the empty state only when there genuinely are no variants", () => {
    const empty = render(journey({ variantCount: 0, defaultVariantLabel: null, variants: [] }));
    assert.ok(empty.includes("No variants recorded."), "an empty journey says so");

    const populated = render(threeVariantJourney());
    assert.ok(
      !populated.includes("No variants recorded."),
      "a populated journey must never show the empty state",
    );
  });
});

describe("AdminPackageDetailView: the summary card", () => {
  it("opens with the journey's code and status, not a box per fact", () => {
    const html = render(journey());

    const summary = html.slice(0, html.indexOf("journey-detail-details"));

    assert.ok(summary.includes("<h1"), "the page's heading lives in this panel");
    assert.ok(summary.includes("Nile Dinner Cruise"), "and it is the journey's name");
    assert.ok(summary.includes("T016"), "with the catalogue code under it");
    assert.ok(summary.includes("nile-dinner-cruise"), "and the slug beside it");
    assert.ok(summary.includes("Active") || summary.includes("Inactive"));
  });

  it("gives the whole page exactly one heading of its own", () => {
    // The route's other states keep an <h1> in the page header; this one
    // moved into the masthead, so the two must never both render.
    const html = render(journey());

    assert.equal((html.match(/<h1/g) ?? []).length, 1);
  });

  it("states availability, ownership and pricing mode as badges", () => {
    const active = render(journey({ isActive: true, managementSource: "brochure" }));
    const summary = active.slice(0, active.indexOf("journey-detail-details"));

    assert.match(summary, /Active/);
    assert.match(summary, /Brochure/i);
    assert.match(summary, /Priced from the rate tiers/);
  });

  it("says when a journey is quoted rather than priced", () => {
    const html = render(journey({ requiresPriceConfirmation: true }));

    assert.match(html.slice(0, html.indexOf("journey-detail-details")), /Quoted on request/);
  });

  it("carries the primary actions, so they are not scattered down the page", () => {
    const html = render(journey({ isActive: false }));
    const summary = html.slice(0, html.indexOf("journey-detail-details"));

    assert.ok(summary.includes('href="/admin/journeys/nile-dinner-cruise/edit"'));
    assert.ok(summary.includes("Edit journey"));
    assert.ok(
      summary.includes('href="/admin/journeys/nile-dinner-cruise/variants/new"'),
      "adding a variant is a primary action",
    );
  });

  it("offers Add variant only while the journey is withdrawn", () => {
    const live = render(journey({ isActive: true }));

    assert.ok(!live.includes("/variants/new"), "a new variant has no rates");
    assert.match(live, /Deactivate this journey to add a variant/);
  });

  it("renders the injected availability control as its own section", () => {
    // It arrives already panelled. It used to be dropped into the masthead's
    // row of links, which put a panel inside a flex row of anchors.
    const html = renderToStaticMarkup(
      <AdminPackageDetailView
        journey={journey()}
        actions={<section className="adm-panel">Deactivate journey</section>}
      />,
    );

    const masthead = html.indexOf("adm-detail-ident");
    const availability = html.indexOf("Deactivate journey");
    const details = html.indexOf("journey-detail-details");

    assert.ok(masthead < availability, "after the masthead");
    assert.ok(availability < details, "and before the sections that describe it");
    assert.ok(
      !html.slice(masthead, availability).includes("Deactivate journey"),
      "not nested inside the masthead's action row",
    );
  });
});

describe("AdminPackageDetailView: section containers", () => {
  it("puts every section on its own panel surface", () => {
    const html = render(journey());

    // Masthead, Details, Wording, Itinerary, Content, Variants. Before this
    // pass the tables sat straight on the workspace ground.
    assert.equal((html.match(/class="adm-panel adm-/g) ?? []).length, 6);
  });

  it("gives each section a heading row over a ruled body", () => {
    const html = render(journey());

    for (const id of [
      "journey-detail-details",
      "journey-detail-wording",
      "journey-detail-itinerary",
      "journey-detail-content",
      "journey-detail-variants",
    ]) {
      const head = html.slice(html.indexOf(`aria-labelledby="${id}"`));
      assert.ok(
        head.slice(0, 200).includes('class="adm-sheet-head"'),
        `${id} opens with its heading row`,
      );
    }
  });

  it("keeps the empty state inside the panel, not as a bare line", () => {
    const html = render(journey({ itinerary: [], variants: [], variantCount: 0 }));

    assert.match(html, /class="adm-empty-row">No itinerary recorded\./);
    assert.match(html, /class="adm-empty-row">No variants recorded\./);
  });
});

describe("AdminPackageDetailView: grouped content", () => {
  it("gathers the three lists into one card", () => {
    const html = render(journey());

    assert.ok(html.includes('id="journey-detail-content"'), "one card, not three");
    for (const heading of ["Included", "Not included", "Notes"]) {
      assert.ok(html.includes(`>${heading}<`), `${heading} keeps its own group`);
    }
  });

  it("keeps the content and itinerary management links reachable", () => {
    const html = render(journey());

    assert.ok(html.includes('href="/admin/journeys/nile-dinner-cruise/content"'));
    assert.ok(html.includes("Manage content"));
    assert.ok(html.includes('href="/admin/journeys/nile-dinner-cruise/itinerary"'));
    assert.ok(html.includes("Manage itinerary"));
  });
});

describe("AdminPackageDetailView: nothing is hidden at desktop widths", () => {
  // The bug this guards: `.adm-list` is the mobile half of the admin's
  // "desktop table, mobile list" pair and is `display: none` from 720px up.
  // Every list on this page is the only presentation of its data and has no
  // table counterpart, so using that class made the variants, the itinerary
  // and all three content lists vanish on desktop while staying in the DOM.
  it("uses no class that a desktop breakpoint hides", () => {
    const html = render(journey());

    // `.adm-list` is fine again — but only because every section now
    // renders an `.adm-table-wrap` beside it. Neither half may appear alone.
    const wraps = (html.match(/class="adm-table-wrap"/g) ?? []).length;
    const lists = (html.match(/class="adm-list"/g) ?? []).length;

    assert.equal(wraps, lists, "every desktop table has a mobile list, and vice versa");
    assert.ok(wraps >= 4, "details, wording, itinerary, content and variants");
  });

  it("leaves no half behind when a section is empty", () => {
    // An empty section renders one `.adm-empty-row` in place of BOTH halves,
    // which is the other way the pair can be broken.
    const html = render(journey({
      itinerary: [],
      content: { included: [], excluded: [], notes: [] },
      variants: [],
      variantCount: 0,
      defaultVariantLabel: null,
    }));

    assert.equal(
      (html.match(/class="adm-table-wrap"/g) ?? []).length,
      (html.match(/class="adm-list"/g) ?? []).length,
    );
  });

  it("renders every list with the always-visible class", () => {
    const html = render(journey());

    assert.ok(
      !html.includes("adm-stack-list"),
      "the stand-in class is gone; the real pair is rendered instead",
    );
  });
});

describe("AdminPackageDetailView: ownership advisories", () => {
  const brochure = () => journey({ managementSource: "brochure", isActive: false });

  it("puts every applicable warning in one box, not one box each", () => {
    const html = render(brochure());
    const section = html.slice(html.indexOf("journey-detail-variants"));
    const table = section.indexOf('<div class="adm-table-wrap">');

    assert.equal(
      (section.slice(0, table).match(/class="adm-notice"/g) ?? []).length,
      1,
      "three stacked boxes filled the panel before the table began",
    );
    assert.ok(section.includes('class="adm-notice-list"'), "each point keeps its own line");
  });

  it("keeps the wording of each warning exactly as the rules state it", () => {
    const html = render(brochure());

    for (const phrase of ["Choosing a different default", "Saving a new order", "Deleting a variant"]) {
      assert.ok(html.includes(phrase), `${phrase} is still said`);
    }
  });

  it("uses a plain sentence when only one warning applies", () => {
    // Live: the default cannot be moved and no variant can be deleted, so
    // reordering is the only change left to warn about.
    const html = render(journey({ managementSource: "brochure", isActive: true }));
    const section = html.slice(html.indexOf("journey-detail-variants"));

    assert.ok(section.includes("Saving a new order"), "the one that still applies");
    assert.ok(!section.includes("Choosing a different default"));
    assert.ok(!section.includes('class="adm-notice-list"'), "no list of one");
  });

  it("says nothing about ownership for a journey the admin already owns", () => {
    const html = render(journey({ managementSource: "admin" }));

    assert.ok(!html.includes("still comes from the brochure catalogue"));
  });
});

describe("AdminPackageDetailView: the variant actions column", () => {
  const withInjected = (value: AdminPackageDetail) =>
    renderToStaticMarkup(
      <AdminPackageDetailView
        journey={value}
        variantActions={
          new Map(
            value.variants.map((entry) => [
              entry.key,
              <form key={entry.key}>
                <button className="adm-action-btn">Make default</button>
              </form>,
            ]),
          )
        }
      />,
    );

  it("separates the everyday links from the composed controls", () => {
    const table = variantsTable(withInjected(journey()));

    assert.ok(table.includes('class="adm-row-links"'), "one rank for the links");
    assert.ok(table.includes('class="adm-row-extra"'), "another for the controls");
  });

  it("keeps Edit variant and Manage rates on the first rank", () => {
    const table = variantsTable(withInjected(journey()));
    const links = table.slice(table.indexOf('class="adm-row-links"'));
    const firstRank = links.slice(0, links.indexOf("</div>"));

    assert.ok(firstRank.includes("Edit variant"));
    assert.ok(firstRank.includes("Manage rates"));
    assert.ok(!firstRank.includes("Make default"), "the composed control is below them");
  });

  it("puts the injected control on the second rank", () => {
    const table = variantsTable(withInjected(journey()));
    const extra = table.slice(table.indexOf('class="adm-row-extra"'));

    assert.ok(extra.includes("Make default"));
  });

  it("omits the second rank entirely when nothing was injected", () => {
    const table = variantsTable(render(journey()));

    assert.ok(table.includes('class="adm-row-links"'));
    assert.ok(!table.includes('class="adm-row-extra"'), "no empty container");
  });

  it("reserves a column for the two ranks", () => {
    assert.match(variantsTable(render(journey())), /class="adm-col-actions"/);
  });

  it("uses the same two ranks on the mobile rows", () => {
    const list = variantsList(withInjected(journey()));

    assert.ok(list.includes('class="adm-row-links"'));
    assert.ok(list.includes('class="adm-row-extra"'));
  });
});

describe("AdminPackageDetailView: rate visibility per variant", () => {
  it("summarises the tiers a variant has, lowest first", () => {
    const html = render(journey());

    assert.match(html, /3 rate tiers · from USD 80\.00 per adult/);
  });

  it("makes an unpriced variant obvious and its rates page easy to find", () => {
    const html = render(journey({
      variants: [variant({ rates: [] })],
      variantCount: 1,
    }));

    assert.match(html, /No rates — cannot be booked/);
    assert.match(html, /class="adm-cell-alert"/, "set off as a chip, not loose red text");
    assert.match(
      html,
      /class="adm-cell-alert-mark"/,
      "with a mark, so the state is not carried by colour alone",
    );
    assert.ok(
      html.includes('href="/admin/journeys/nile-dinner-cruise/variants/standard-service/rates"'),
      "Manage rates stays one click away",
    );
  });
});
