import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminPackageReservationsTable } from "./AdminPackageReservationsTable";
import type { AdminPackageReservationListItem } from "../types";

// Rendered rather than inspected: what matters about this table is the text an
// administrator actually reads — above all that a reservation awaiting a quote
// never shows a figure. Static markup is enough, since the component has no
// interactivity of its own.

function reservation(
  overrides: Partial<AdminPackageReservationListItem> = {},
): AdminPackageReservationListItem {
  return {
    bookingReference: "TPP-23456789ABCD",
    package: { code: "T016", slug: "nile-dinner-cruise", title: "Nile Dinner Cruise" },
    variant: { key: "premium-service", label: "Premium service" },
    guestName: "Amira Hassan",
    guestEmail: "amira@example.test",
    guestPhone: "+201000000000",
    tourDate: "2026-10-01",
    adults: 2,
    children: 0,
    status: "pending",
    pricingStatus: "quoted",
    currency: "USD",
    totalAmountSnapshot: "300.00",
    createdAt: "2026-09-20T18:45:22.411Z",
    ...overrides,
  };
}

const render = (reservations: AdminPackageReservationListItem[]) =>
  renderToStaticMarkup(<AdminPackageReservationsTable data={{ reservations }} />);

describe("AdminPackageReservationsTable", () => {
  it("renders a quoted reservation with every field an administrator needs", () => {
    const html = render([reservation()]);

    assert.match(html, /TPP-23456789ABCD/);
    assert.match(html, /Nile Dinner Cruise/);
    assert.match(html, /T016/);
    assert.match(html, /Premium service/);
    assert.match(html, /Amira Hassan/);
    assert.match(html, /amira@example\.test/);
    assert.match(html, /\+201000000000/);
    assert.match(html, /1 Oct 2026/);
    assert.match(html, /2 adults/);
    assert.match(html, /USD 300\.00/);
    assert.match(html, /Pending/);
    assert.match(html, /Quoted/);
    assert.match(html, /20 Sept 2026, 18:45 UTC/);
  });

  it("shows a confirmation-required reservation as To be confirmed, never a figure", () => {
    const html = render([
      reservation({ pricingStatus: "requires_confirmation", totalAmountSnapshot: null }),
    ]);

    assert.match(html, /To be confirmed/);
    assert.match(html, /Awaiting quote/);
    // The three ways a null total could wrongly become a number.
    assert.ok(!/USD 0\.00/.test(html), "a missing total must never render as zero");
    assert.ok(!/USD\s*0\b/.test(html), "a missing total must never render as zero");
    assert.ok(!/USD null|NaN|undefined/.test(html), "a missing total must never leak a raw value");
  });

  it("renders every status and pricing status with its own label", () => {
    for (const [status, label] of [
      ["pending", "Pending"],
      ["confirmed", "Confirmed"],
      ["cancelled", "Cancelled"],
    ] as const) {
      assert.match(render([reservation({ status })]), new RegExp(label));
    }

    const quoted = render([reservation({ pricingStatus: "quoted" })]);
    assert.match(quoted, /Quoted/);
    assert.ok(!/Awaiting quote/.test(quoted));

    const awaiting = render([
      reservation({ pricingStatus: "requires_confirmation", totalAmountSnapshot: null }),
    ]);
    assert.match(awaiting, /Awaiting quote/);
  });

  it("renders the empty state rather than an empty table", () => {
    const html = render([]);

    assert.match(html, /No package reservations yet/);
    assert.match(html, /will appear here as soon as they are taken/);
    assert.ok(!/<table/.test(html), "there is no table to show");
  });

  it("counts the party in words, singular where it should be", () => {
    assert.match(render([reservation({ adults: 1, children: 0 })]), /1 adult(?!s)/);
    assert.match(render([reservation({ adults: 2, children: 1 })]), /2 adults, 1 child(?!ren)/);
    assert.match(render([reservation({ adults: 2, children: 3 })]), /2 adults, 3 children/);
    // No children means the phrase is simply absent, not "0 children".
    assert.ok(!/0 child/.test(render([reservation({ children: 0 })])));
  });

  it("links the booking reference to its detail page", () => {
    const html = render([reservation()]);

    assert.match(html, /TPP-23456789ABCD/);
    assert.match(
      html,
      /href="\/admin\/package-reservations\/TPP-23456789ABCD"/,
      "the reference is the way into the detail page",
    );
  });

  it("encodes a reference that would otherwise change the link's shape", () => {
    // The API only ever issues canonical references, but the href is built
    // from data rather than trusted, so this proves the encoding is real.
    const html = render([reservation({ bookingReference: "TPP-A/B?C#D" })]);

    assert.match(html, /href="\/admin\/package-reservations\/TPP-A%2FB%3FC%23D"/);
  });

  it("renders several reservations in the order given", () => {
    const html = render([
      reservation({ bookingReference: "TPP-AAAAAAAAAAAA", guestName: "First Guest" }),
      reservation({ bookingReference: "TPP-BBBBBBBBBBBB", guestName: "Second Guest" }),
    ]);

    assert.ok(html.indexOf("First Guest") < html.indexOf("Second Guest"), "API order is preserved");
  });

  it("exposes no internal identifiers", () => {
    const html = render([reservation()]);

    for (const leaked of ["packageId", "variantId", "package_id", "variant_id"]) {
      assert.ok(!html.includes(leaked), `${leaked} must not reach the page`);
    }
  });
});
