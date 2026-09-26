import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  packageChildAgesLabel,
  packageChildRateLabel,
  packagePartyLabel,
  packageReservationDetailHref,
  packageStatusActions,
  packageTerminalNote,
  packageTotalLabel,
} from "./packageReservations";

// The decisions the package reservation screens make, tested where they are
// pure. Which status controls appear is the important one: the components that
// render them reach a Server Action, which cannot be loaded in this process,
// so the rule lives here where it can be proved.

describe("packageStatusActions", () => {
  it("offers Confirm and Cancel for a pending request", () => {
    const actions = packageStatusActions("pending");

    assert.deepEqual(
      actions.map((action) => action.target),
      ["confirmed", "cancelled"],
    );
    assert.deepEqual(
      actions.map((action) => action.label),
      ["Confirm request", "Cancel request"],
    );
    assert.deepEqual(
      actions.map((action) => action.tone),
      ["confirm", "cancel"],
    );
  });

  it("offers nothing for a confirmed request", () => {
    // Stricter than room reservations, which allow confirmed -> cancelled.
    assert.deepEqual(packageStatusActions("confirmed"), []);
  });

  it("offers nothing for a cancelled request", () => {
    assert.deepEqual(packageStatusActions("cancelled"), []);
  });

  it("only ever targets a status the API accepts", () => {
    for (const status of ["pending", "confirmed", "cancelled"] as const) {
      for (const action of packageStatusActions(status)) {
        assert.ok(
          action.target === "confirmed" || action.target === "cancelled",
          "pending is never a target a request may ask for",
        );
      }
    }
  });
});

describe("packageTerminalNote", () => {
  it("explains each decided state in its own words", () => {
    const confirmed = packageTerminalNote("confirmed");
    const cancelled = packageTerminalNote("cancelled");

    assert.ok(confirmed && confirmed.length > 0);
    assert.ok(cancelled && cancelled.length > 0);
    assert.notEqual(confirmed, cancelled, "a settled journey and a closed one differ");
    assert.match(cancelled, /cannot be reopened/);
  });

  it("says nothing while a request is still pending", () => {
    assert.equal(packageTerminalNote("pending"), null);
  });

  it("never mentions a refund, payment or charge", () => {
    for (const status of ["confirmed", "cancelled"] as const) {
      const note = packageTerminalNote(status)!;
      for (const forbidden of [/refund/i, /payment/i, /charge/i, /invoice/i, /deposit/i]) {
        assert.ok(!forbidden.test(note), `${note} must not imply a workflow that does not exist`);
      }
    }
  });
});

describe("package reservation labels", () => {
  it("names a missing total instead of showing a figure", () => {
    assert.equal(packageTotalLabel(null), "To be confirmed");
    assert.equal(packageTotalLabel("300.00"), "USD 300.00");
    assert.equal(packageTotalLabel("1234567.5"), "USD 1,234,567.50");
  });

  it("tells apart a child rate that does not apply from one not yet quoted", () => {
    assert.equal(packageChildRateLabel(null, 0), "Not applicable");
    assert.equal(packageChildRateLabel(null, 2), "To be confirmed");
    assert.equal(packageChildRateLabel("50.00", 2), "USD 50.00");
  });

  it("distinguishes ages that do not apply from ages never recorded", () => {
    assert.equal(packageChildAgesLabel(null, 0), "Not applicable");
    assert.equal(packageChildAgesLabel(null, 2), "Not recorded");
    assert.equal(packageChildAgesLabel([], 2), "Not recorded");
    assert.equal(packageChildAgesLabel([7, 9], 2), "7, 9");
  });

  it("counts the party in words", () => {
    assert.equal(packagePartyLabel(1, 0), "1 adult");
    assert.equal(packagePartyLabel(2, 0), "2 adults");
    assert.equal(packagePartyLabel(2, 1), "2 adults, 1 child");
    assert.equal(packagePartyLabel(2, 3), "2 adults, 3 children");
  });

  it("encodes the detail href into one path segment", () => {
    assert.equal(
      packageReservationDetailHref("TPP-23456789ABCD"),
      "/admin/package-reservations/TPP-23456789ABCD",
    );
    assert.equal(
      packageReservationDetailHref("TPP-A/B?C#D"),
      "/admin/package-reservations/TPP-A%2FB%3FC%23D",
    );
  });
});
