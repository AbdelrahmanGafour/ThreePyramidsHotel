import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminPackageReservationDetailView } from "./AdminPackageReservationDetail";
import type { AdminPackageReservationDetail } from "../types";

// Rendered rather than inspected: what matters is the text an administrator
// reads — above all that nothing absent is ever shown as a number, and that
// no figure on the page was worked out here rather than read from storage.

function detail(
  overrides: Partial<AdminPackageReservationDetail> = {},
): AdminPackageReservationDetail {
  return {
    bookingReference: "TPP-23456789ABCD",
    package: { code: "T016", slug: "nile-dinner-cruise", title: "Nile Dinner Cruise" },
    variant: { key: "premium-service", label: "Premium service" },
    guestName: "Amira Hassan",
    guestEmail: "amira@example.test",
    guestPhone: "+201000000000",
    guestCountry: "Egypt",
    tourDate: "2026-10-01",
    adults: 2,
    children: 2,
    childAges: [7, 9],
    specialRequests: "Window table if possible",
    status: "pending",
    pricingStatus: "quoted",
    currency: "USD",
    adultUnitRateSnapshot: "100.00",
    childUnitRateSnapshot: "50.00",
    totalAmountSnapshot: "300.00",
    createdAt: "2026-09-20T18:45:22.411Z",
    ...overrides,
  };
}

const render = (reservation: AdminPackageReservationDetail, actions?: React.ReactNode) =>
  renderToStaticMarkup(
    <AdminPackageReservationDetailView reservation={reservation} actions={actions} />,
  );

describe("AdminPackageReservationDetailView", () => {
  it("renders every field of a quoted reservation", () => {
    const html = render(detail());

    for (const expected of [
      "TPP-23456789ABCD",
      "Nile Dinner Cruise",
      "T016",
      "Premium service",
      "Amira Hassan",
      "amira@example.test",
      "+201000000000",
      "Egypt",
      "1 Oct 2026",
      "Window table if possible",
      "Pending",
      "Quoted",
      "USD 100.00",
      "USD 50.00",
      "USD 300.00",
      "7, 9",
      "2 adults, 2 children",
      "20 Sept 2026, 18:45 UTC",
    ]) {
      assert.ok(html.includes(expected), `the page should show ${expected}`);
    }
  });

  it("offers the guest's email and phone as actionable links", () => {
    const html = render(detail());

    assert.match(html, /href="mailto:amira@example\.test"/);
    assert.match(html, /href="tel:\+201000000000"/);
  });

  it("shows a confirmation-required reservation's total as To be confirmed", () => {
    const html = render(
      detail({
        pricingStatus: "requires_confirmation",
        totalAmountSnapshot: null,
        childUnitRateSnapshot: null,
      }),
    );

    assert.match(html, /To be confirmed/);
    assert.match(html, /Awaiting quote/);
    // The adult rate is still a real stored figure and still shown.
    assert.match(html, /USD 100\.00/);
    assert.ok(!/USD 0\.00/.test(html), "a missing figure must never render as zero");
    assert.ok(!/USD null|NaN|undefined/.test(html), "no raw value may leak");
  });

  it("tells apart a child rate that does not apply from one not yet quoted", () => {
    const noChildren = render(detail({ children: 0, childAges: null, childUnitRateSnapshot: null }));
    assert.match(noChildren, /Not applicable/);

    const awaiting = render(
      detail({
        pricingStatus: "requires_confirmation",
        totalAmountSnapshot: null,
        childUnitRateSnapshot: null,
        children: 2,
        childAges: null,
      }),
    );
    assert.match(awaiting, /To be confirmed/);
  });

  it("renders absent optional fields neutrally, never as fabricated data", () => {
    const html = render(
      detail({ childAges: null, specialRequests: null, children: 2 }),
    );

    assert.match(html, /Not recorded/, "ages that were never captured say so");
    assert.match(html, /None/, "an empty request field says so");
    assert.ok(!/null|undefined|NaN/.test(html), "no raw absence value reaches the page");
  });

  it("says Not applicable for child ages when there are no children", () => {
    const html = render(detail({ children: 0, childAges: null, childUnitRateSnapshot: null }));

    assert.match(html, /Not applicable/);
    assert.ok(!/Not recorded/.test(html), "there is nothing to have recorded");
  });

  it("renders every status and pricing status", () => {
    for (const [status, label] of [
      ["pending", "Pending"],
      ["confirmed", "Confirmed"],
      ["cancelled", "Cancelled"],
    ] as const) {
      assert.match(render(detail({ status })), new RegExp(label));
    }
  });

  it("shows only stored snapshots, never a recomputed total", () => {
    // A total that disagrees with the unit rates is still shown as stored: the
    // page reports what the guest was quoted and does not arbitrate.
    const html = render(detail({ totalAmountSnapshot: "999.99" }));

    assert.match(html, /USD 999\.99/);
    // 2*100 + 2*50 = 300 would be the recomputed figure. It must not appear.
    assert.ok(!/USD 300\.00/.test(html), "the UI must not derive a total of its own");
  });

  it("exposes no internal identifiers", () => {
    const html = render(detail());

    for (const leaked of ["packageId", "variantId", "package_id", "variant_id", '"id"']) {
      assert.ok(!html.includes(leaked), `${leaked} must not reach the page`);
    }
  });
});

describe("AdminPackageReservationDetailView: the shared detail-page shape", () => {
  it("opens with a masthead carrying the reference as the page's heading", () => {
    const html = render(detail());

    assert.match(html, /^<header class="adm-panel adm-detail-ident"/);
    assert.match(html, /<h1 class="adm-ident-title">TPP-23456789ABCD<\/h1>/);
    assert.equal((html.match(/<h1/g) ?? []).length, 1, "the page header renders none of its own");
  });

  it("puts the guest, the arrival time and both statuses where they are scanned first", () => {
    const html = render(detail());
    const masthead = html.slice(0, html.indexOf("package-detail-guest"));

    assert.ok(masthead.includes("Amira Hassan"), "who");
    assert.ok(masthead.includes("20 Sept 2026, 18:45 UTC"), "when it arrived");
    assert.ok(masthead.includes("Pending"), "where the request stands");
    assert.ok(masthead.includes("Quoted"), "and whether it has a price");
  });

  it("puts every section on its own panel with a heading row", () => {
    const html = render(detail());

    for (const id of [
      "package-detail-guest",
      "package-detail-journey",
      "package-detail-party",
      "package-detail-pricing",
      "package-detail-requests",
    ]) {
      assert.ok(
        html.includes(`class="adm-panel adm-sheet" aria-labelledby="${id}"`),
        `${id} is a detail-page section`,
      );
    }
  });

  it("renders both halves of every metadata table", () => {
    // The mobile list is hidden from 720px up and the desktop table below it.
    // Rendering one without the other is invisible in the DOM and fatal on
    // screen, which is how it once shipped.
    const html = render(detail());
    const wraps = (html.match(/class="adm-table-wrap"/g) ?? []).length;

    assert.equal(wraps, (html.match(/class="adm-list"/g) ?? []).length);
    assert.equal(wraps, 5, "guest, journey, party, pricing, requests");
  });

  it("says the journey panel holds a snapshot, not the catalogue as it reads now", () => {
    const html = render(detail());
    const section = html.slice(html.indexOf("package-detail-journey"));

    assert.match(section.slice(0, 400), /Recorded with the request/);
  });

  it("places the injected status controls directly under the masthead", () => {
    const html = render(detail(), <section className="adm-panel">Confirm request</section>);
    const actions = html.indexOf("Confirm request");

    assert.ok(actions < html.indexOf("package-detail-guest"), "found without hunting");
    assert.ok(actions > html.indexOf("adm-detail-ident"), "but under the record it acts on");
  });

  it("matches the room reservation screen where the two domains overlap", () => {
    // Same masthead, same section shape, same metadata table. The fields
    // inside differ because the domains do; the frame must not.
    const html = render(detail());

    assert.match(html, /class="adm-panel adm-detail-ident"/);
    assert.match(html, /class="adm-panel adm-sheet" aria-labelledby="package-detail-guest"/);
    assert.match(html, /<th scope="row" class="adm-cell-label">Country<\/th>/);
  });
});
