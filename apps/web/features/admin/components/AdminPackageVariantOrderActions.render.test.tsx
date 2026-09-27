import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// How the reorder controls are wired.
//
// The component reaches a Server Action, which imports `next/headers` and
// cannot be loaded here — the same pincer the other admin write controls hit.
// So the binding and the gating are asserted against the source that decides
// them; which moves exist and what list each produces are tested directly in
// lib/packages.test.ts, where they are pure, and the request body in
// server/adminPackagesApi.test.ts.

const source = readFileSync(
  "features/admin/components/AdminPackageVariantOrderActions.tsx",
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

/** This action's own branch, never a sibling's. */
const reorderAction = action.slice(
  action.indexOf("export async function reorderPackageVariantsAction"),
  action.indexOf("/** Display hints the default-variant action may hand back"),
);

describe("reorder controls", () => {
  it("binds the journey and the COMPLETE new order server-side", () => {
    assert.ok(
      source.includes("reorderPackageVariantsAction.bind(null, slug, moves.up)"),
      "Move up carries the whole arrangement it would produce",
    );
    assert.ok(
      source.includes("reorderPackageVariantsAction.bind(null, slug, moves.down)"),
      "and so does Move down",
    );
  });

  it("submits no field at all, so no key or direction travels from the browser", () => {
    assert.ok(!/name=/.test(source), "the forms carry no input");
    assert.ok(!/type="hidden"/.test(source));
    assert.ok(
      !/"up"|"down"/.test(source.slice(source.indexOf("return ("))),
      "no direction is posted; the list is already decided",
    );
  });

  it("asks the tested helper which moves exist", () => {
    assert.ok(source.includes("packageVariantMoves(orderedKeys, index)"));
    assert.ok(
      // Newline-agnostic, for the reason given in the default-variant suite.
      /if \(!moves\.up && !moves\.down\) \{\s*return null;\s*\}/.test(source),
      "a variant with nowhere to go renders nothing",
    );
  });

  it("renders each button only when its move exists", () => {
    assert.ok(source.includes("{moves.up ? ("), "no Move up for the first variant");
    assert.ok(source.includes("{moves.down ? ("), "no Move down for the last");
    assert.equal((source.match(/<form/g) ?? []).length, 2, "at most two forms, never more");
  });

  it("uses the shared labels rather than restating them", () => {
    assert.ok(source.includes("{MOVE_UP_LABEL}"));
    assert.ok(source.includes("{MOVE_DOWN_LABEL}"));
  });

  it("introduces no drag-and-drop in this slice", () => {
    for (const forbidden of [/draggable/i, /onDragStart/, /onDrop/, /dnd/i, /"use client"/]) {
      assert.ok(!forbidden.test(source), `${forbidden} is not part of this slice`);
    }
  });

  it("offers no delete, and touches nothing but the order", () => {
    for (const forbidden of [/[Dd]elete/, /[Rr]emove/, /makePackageVariantDefaultAction/,
      /replacePackageRatesAction/, /editPackageVariantAction/, /updatePackageStatusAction/]) {
      assert.ok(!forbidden.test(source), `${forbidden} has no place in this control`);
    }
  });

  it("is gated by nothing about publication", () => {
    // Reordering is offered whether or not the journey is on sale.
    assert.ok(!/isActive/.test(source));
  });
});

describe("journey detail page: reorder wiring", () => {
  it("builds every button from the order the API returned", () => {
    assert.ok(
      page.includes("const orderedKeys = data.variants.map((variant) => variant.key);"),
      "the list a button submits is the list the page showed",
    );
    assert.ok(page.includes("orderedKeys={orderedKeys}"));
    assert.ok(page.includes("index={index}"));
  });

  it("composes the reorder controls beside the default one, per variant", () => {
    assert.ok(page.includes("<AdminPackageVariantOrderActions"));
    assert.ok(page.includes("<AdminPackageDefaultVariantAction"));
    assert.ok(page.includes("<Fragment key={variant.key}>"));
  });

  it("explains a stale set without claiming anything was rearranged", () => {
    assert.match(page, /variants changed since the page was opened/);
    assert.match(page, /Nothing was rearranged/);
    assert.match(page, /no variant was added or removed on your behalf/);
    assert.match(page, /review the/);
  });

  it("explains an exhausted ordering as a refusal, not a failure", () => {
    assert.match(page, /no ordering range left/);
  });

  it("reports an unknown outcome as unknown, and never resubmits", () => {
    assert.match(page, /could not be confirmed/);

    const unavailableBranch = reorderAction.slice(reorderAction.indexOf('case "unavailable":'));

    assert.match(unavailableBranch, /uncertain/);
    assert.ok(
      !/reorderAdminPackageVariants/.test(unavailableBranch),
      "an uncertain reorder is never repeated on its own",
    );
  });
});

describe("reorder action", () => {
  it("refreshes both views and returns to the journey on success", () => {
    const ok = reorderAction.slice(reorderAction.indexOf('case "ok":'));

    assert.match(ok.slice(0, 300), /revalidateJourney\(slug\);/);
    assert.match(ok.slice(0, 300), /redirect\(variantOrderNoticeHref\(slug, "updated"\)\);/);
  });

  it("sends an ended session to the login page", () => {
    assert.match(
      reorderAction,
      /case "unauthenticated":\s*\n\s*redirect\("\/admin\/login"\);/,
    );
  });

  it("treats every stale shape the same way, and re-reads before showing it", () => {
    // A set mismatch and a key that names nothing are the same fact to an
    // administrator: the page they acted on is out of date.
    for (const branch of ['case "set-mismatch":', 'case "variant-not-found":', 'case "invalid":']) {
      assert.ok(reorderAction.includes(branch), `${branch} should be handled`);
    }

    const staleBranch = reorderAction.slice(reorderAction.indexOf('case "set-mismatch":'));
    assert.match(staleBranch.slice(0, 400), /revalidateJourney\(slug\);/);
    assert.match(staleBranch.slice(0, 400), /"stale"/);
  });

  it("never appends or infers a missing variant", () => {
    for (const forbidden of [/\.push\(/, /concat\(/, /\.\.\.current/, /missing/i]) {
      assert.ok(!forbidden.test(reorderAction), `${forbidden} would invent an order`);
    }
  });
});
