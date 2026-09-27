import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// How the promote-a-variant control is wired.
//
// The component reaches a Server Action, which imports `next/headers` and
// cannot be loaded here — the same pincer the other admin write controls hit.
// So the binding and the gating are asserted against the source that decides
// them; which variants get a control is tested directly in
// lib/packages.test.ts, where it is placed is tested in
// AdminPackageDetail.test.tsx, and the request body in
// server/adminPackagesApi.test.ts.

const source = readFileSync(
  "features/admin/components/AdminPackageDefaultVariantAction.tsx",
  "utf8",
);

const page = readFileSync(
  "app/(dashboard)/admin/journeys/[slug]/page.tsx",
  "utf8",
);

const action = readFileSync(
  "features/admin/server/adminPackageActions.ts",
  "utf8",
);

/** This action's own branch of the actions module, never a sibling's. */
const defaultVariantAction = action.slice(
  action.indexOf("export async function makePackageVariantDefaultAction"),
  action.indexOf("/** Display hints the variant create action may hand back"),
);

describe("make-default control", () => {
  it("binds the journey and the variant server-side", () => {
    assert.ok(
      source.includes("makePackageVariantDefaultAction.bind(null, slug, variant.key)"),
      "neither should be submittable from the browser",
    );
  });

  it("submits no field at all", () => {
    assert.ok(!/name=/.test(source), "the form carries no input");
    assert.ok(!/type="hidden"/.test(source), "and nothing is smuggled in a hidden field");
  });

  it("renders nothing when the tested helper offers nothing", () => {
    assert.ok(source.includes("packageDefaultVariantAction(journey, variant)"));
    assert.ok(
      // Newline-agnostic: checkouts of this repository carry CRLF, so an
      // assertion hard-coding \n pins the bytes a checkout happened to
      // write rather than the code it is about.
      /if \(!action\) \{\s*return null;\s*\}/.test(source),
      "no control, no markup",
    );
  });

  it("offers no second control of any kind", () => {
    assert.equal((source.match(/<form/g) ?? []).length, 1, "exactly one form");
    assert.equal(
      (source.match(/<AdminActionButton/g) ?? []).length,
      1,
      "exactly one button",
    );
    for (const forbidden of [/Clear default/i, /Unset/i, /Delete/i, /Reorder/i, /Move /]) {
      assert.ok(!forbidden.test(source), `${forbidden} is not part of this slice`);
    }
  });

  it("touches nothing but the default", () => {
    for (const forbidden of [/updatePackageStatusAction/, /replacePackageRatesAction/,
      /editPackageVariantAction/, /createPackageVariantAction/]) {
      assert.ok(!forbidden.test(source), `${forbidden} has no place in this control`);
    }
  });
});

describe("journey detail page: default-variant wiring", () => {
  it("composes one action node per variant, keyed by key", () => {
    assert.ok(page.includes("const variantActions = new Map("));
    assert.ok(page.includes("variantActions={variantActions}"));
    assert.ok(
      page.includes("<AdminPackageDefaultVariantAction"),
      "the page composes it, so the view stays free of the Server Action pincer",
    );
  });

  it("explains each outcome the action can report", () => {
    for (const notice of ["updated", '"must-be-inactive"', "gone", "uncertain"]) {
      assert.ok(page.includes(`${notice}:`), `${notice} should have its own notice`);
    }
  });

  it("reports an unknown outcome as unknown, and never resubmits", () => {
    assert.match(page, /could not be confirmed/);
    // Matched up to the concatenation break: the notice is written as two
    // joined string literals, so the whole sentence is not contiguous here.
    assert.match(page, /Check which variant is marked as the/);

    const unavailableBranch = defaultVariantAction.slice(
      defaultVariantAction.indexOf('case "unavailable":'),
    );

    assert.match(unavailableBranch, /uncertain/);
    assert.ok(
      !/setAdminPackageDefaultVariant/.test(unavailableBranch),
      "an uncertain change is never repeated on its own",
    );
  });

  it("says the default was not changed when the journey went live", () => {
    assert.match(page, /the default was not changed/);
    assert.ok(
      !/updatePackageStatusAction/.test(
        page.slice(page.indexOf("DEFAULT_VARIANT_NOTICES"), page.indexOf("function DefaultVariantNotice")),
      ),
      "nothing here withdraws the journey",
    );
  });
});

describe("make-default action", () => {
  it("refreshes both views and returns to the journey on success", () => {
    const ok = defaultVariantAction.slice(defaultVariantAction.indexOf('case "ok":'));

    assert.match(ok.slice(0, 300), /revalidateJourney\(slug\);/);
    assert.match(ok.slice(0, 300), /redirect\(defaultVariantNoticeHref\(slug, "updated"\)\);/);
  });

  it("treats the API's idempotent answer as success, so a stale page is harmless", () => {
    assert.match(defaultVariantAction, /Includes the idempotent case/);
  });

  it("sends an ended session to the login page", () => {
    assert.match(
      defaultVariantAction,
      // Newline-agnostic, and necessarily so: this branch carries a comment
      // between the label and the redirect, and `.` never matches \r, so a
      // `.*\n` run cannot cross a CRLF line end at all.
      /case "unauthenticated":(\s|\/\/[^\r\n]*)*redirect\("\/admin\/login"\);/,
    );
  });

  it("treats both kinds of missing thing as the page's decision", () => {
    assert.match(defaultVariantAction, /case "package-not-found":/);
    assert.match(defaultVariantAction, /case "variant-not-found":/);
    assert.match(defaultVariantAction, /"gone"/);
  });
});
