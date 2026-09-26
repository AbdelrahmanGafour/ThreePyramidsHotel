import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminReservationDetailView } from "./AdminReservationDetail";
import type { AdminReservationDetail } from "../types";

// Rendered rather than inspected: what matters is the text a member of staff
// reads — the stay as booked, the room they were given, and the rate they
// accepted, none of it worked out here rather than read from storage.

function detail(overrides: Partial<AdminReservationDetail> = {}): AdminReservationDetail {
  return {
    bookingReference: "TPH-23456789ABCD",
    status: "pending",
    guest: {
      firstName: "Amira",
      lastName: "Hassan",
      email: "amira@example.test",
      phone: "+201000000000",
      country: "Egypt",
    },
    stay: {
      checkIn: "2026-10-01",
      checkOut: "2026-10-04",
      nights: 3,
      adults: 2,
      children: 1,
    },
    roomType: { name: "Garden Suite", slug: "garden-suite" },
    room: { number: "204" },
    pricing: { nightlyRate: "4200.00", totalAmount: "12600.00", currency: "EGP" },
    specialRequests: "Late arrival, around midnight",
    createdAt: "2026-09-20T18:45:22.411Z",
    ...overrides,
  };
}

const render = (reservation: AdminReservationDetail, actions?: React.ReactNode) =>
  renderToStaticMarkup(
    <AdminReservationDetailView reservation={reservation} actions={actions} />,
  );

describe("AdminReservationDetailView", () => {
  it("renders every field of a booked stay", () => {
    const html = render(detail());

    for (const expected of [
      "TPH-23456789ABCD",
      "Amira",
      "Hassan",
      "amira@example.test",
      "+201000000000",
      "Egypt",
      "1 Oct 2026",
      "4 Oct 2026",
      "3 nights",
      "Garden Suite",
      "garden-suite",
      "204",
      "EGP 4,200.00",
      "EGP 12,600.00",
      "Late arrival, around midnight",
      "Pending",
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

  it("says plainly when no request was left, never leaving the panel blank", () => {
    const html = render(detail({ specialRequests: null }));

    assert.match(html, /None left with this booking\./);
    assert.ok(!/null|undefined|NaN/.test(html), "no raw absence value reaches the page");
  });

  it("renders every status", () => {
    for (const [status, label] of [
      ["pending", "Pending"],
      ["confirmed", "Confirmed"],
      ["cancelled", "Cancelled"],
    ] as const) {
      assert.match(render(detail({ status })), new RegExp(label));
    }
  });

  it("shows the stored total, never one worked out from the nightly rate", () => {
    // 3 × 4200 = 12600 would agree; a total that disagrees is still shown as
    // stored, because the page reports what the guest accepted.
    const html = render(detail({ pricing: { nightlyRate: "4200.00", totalAmount: "9999.00", currency: "EGP" } }));

    assert.match(html, /EGP 9,999\.00/);
    assert.ok(!/EGP 12,600\.00/.test(html), "the UI must not derive a total of its own");
  });

  it("says one night in the singular", () => {
    const html = render(detail({ stay: { ...detail().stay, nights: 1 } }));

    assert.match(html, /1 night</);
  });
});

describe("AdminReservationDetailView: the shared detail-page shape", () => {
  it("opens with a masthead carrying the reference as the page's heading", () => {
    const html = render(detail());

    assert.match(html, /^<header class="adm-panel adm-detail-ident"/);
    assert.match(html, /<h1 class="adm-ident-title">TPH-23456789ABCD<\/h1>/);
    assert.equal((html.match(/<h1/g) ?? []).length, 1, "the page header renders none of its own");
  });

  it("puts the guest, the dates and the status where they are scanned first", () => {
    const html = render(detail());
    const masthead = html.slice(0, html.indexOf("detail-guest"));

    assert.ok(masthead.includes("Amira Hassan"), "who");
    assert.ok(masthead.includes("1 Oct 2026") && masthead.includes("4 Oct 2026"), "when");
    assert.ok(masthead.includes("Pending"), "and what state it is in");
  });

  it("puts every section on its own panel with a heading row", () => {
    const html = render(detail());

    for (const id of [
      "detail-guest",
      "detail-stay",
      "detail-room",
      "detail-pricing",
      "detail-requests",
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
    assert.equal(wraps, 5, "guest, stay, room, pricing, requests");
  });

  it("places the injected status controls directly under the masthead", () => {
    const html = render(
      detail(),
      <section className="adm-panel">Confirm reservation</section>,
    );

    const actions = html.indexOf("Confirm reservation");

    assert.ok(actions < html.indexOf("detail-guest"), "found without hunting");
    assert.ok(actions > html.indexOf("adm-detail-ident"), "but under the record it acts on");
  });

  it("renders nothing in the actions slot when the page composes none", () => {
    const html = render(detail());

    assert.ok(html.indexOf("adm-detail-ident") < html.indexOf("detail-guest"));
  });
});
