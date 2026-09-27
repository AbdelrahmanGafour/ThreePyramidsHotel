import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// How the delete control is wired.
//
// The component reaches a Server Action, which imports `next/headers` and
// cannot be loaded here — the same pincer the other admin write controls hit.
// So the binding, the confirmation step and the gating are asserted against
// the source that decides them; which state each variant is in is tested
// directly in lib/packages.test.ts, what the panel renders in
// AdminPackageDetail.test.tsx, and the request in
// server/adminPackagesApi.test.ts.

const source = readFileSync(
  "features/admin/components/AdminPackageVariantDeleteAction.tsx",
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

/**
 * This action's own notices. Sibling blocks in the same page reuse token
 * names such as `gone`, so every slice below starts from here rather than
 * from the whole file.
 */
const deleteNotices = page.slice(
  page.indexOf("const VARIANT_DELETE_NOTICES = {"),
  page.indexOf("function VariantDeleteNotice("),
);

/** This action's own branch, never a sibling's. */
const deleteAction = action.slice(
  action.indexOf("export async function deletePackageVariantAction"),
  action.indexOf("/** Display hints the reorder action may hand back"),
);

describe("delete control", () => {
  it("binds the journey and the variant server-side, and posts no body", () => {
    assert.ok(
      source.includes("deletePackageVariantAction.bind(null, slug, variant.key)"),
      "neither should be submittable from the browser",
    );
    assert.ok(!/name=/.test(source), "the form carries no input");
    assert.ok(!/type="hidden"/.test(source));
  });

  it("asks the tested helper which of the three states this variant is in", () => {
    assert.ok(source.includes("packageVariantDeleteState(journey, variant)"));
    assert.ok(
      // Newline-agnostic: checkouts of this repository carry CRLF, so an
      // assertion hard-coding \n pins the bytes a checkout happened to
      // write rather than the code it is about.
      /if \(state === "hidden"\) \{\s*return null;\s*\}/.test(source),
      "a live journey gets no control at all",
    );
    assert.ok(source.includes('if (state === "blocked-default") {'));
  });

  it("shows the remedy instead of a button when the default blocks it", () => {
    const blocked = source.slice(
      source.indexOf('if (state === "blocked-default") {'),
      source.indexOf("const submit ="),
    );

    assert.ok(!blocked.includes("<form"), "no form is rendered");
    assert.ok(!blocked.includes("AdminActionButton"), "and no button");
    assert.ok(blocked.includes("{DEFAULT_BLOCKS_DELETE_NOTE}"));
  });

  it("puts the destructive button behind an explicit second step", () => {
    assert.ok(source.includes("<details"), "the delete is not reachable in one click");
    assert.ok(source.includes("<summary"), "and the first step says what it opens");
    assert.ok(
      source.indexOf("<summary") < source.indexOf("<form"),
      "the disclosure wraps the form, not the other way round",
    );
  });

  it("names the variant in the confirmation copy", () => {
    assert.ok(source.includes("{packageVariantDeleteConfirmation(variant)}"));
    assert.ok(
      source.includes("{`Delete ${variant.label}`}"),
      "and again on the button itself",
    );
  });

  it("adds no dialog framework", () => {
    for (const forbidden of [/"use client"/, /useState/, /createPortal/, /role="dialog"/,
      /aria-modal/, /showModal/]) {
      assert.ok(!forbidden.test(source), `${forbidden} is not part of this slice`);
    }
  });

  it("uses the shared destructive tone", () => {
    assert.ok(source.includes('tone="cancel"'), "the same tone withdrawing a journey uses");
    assert.equal((source.match(/<AdminActionButton/g) ?? []).length, 1, "exactly one button");
  });

  it("never guesses at bookings", () => {
    for (const forbidden of [/reservation/i, /booked/i, /hasReservations/]) {
      assert.ok(
        !forbidden.test(source.slice(source.indexOf("export function"))),
        `${forbidden} is the backend's to answer`,
      );
    }
  });

  it("touches nothing but the deletion", () => {
    for (const forbidden of [/makePackageVariantDefaultAction/, /reorderPackageVariantsAction/,
      /replacePackageRatesAction/, /updatePackageStatusAction/]) {
      assert.ok(!forbidden.test(source), `${forbidden} has no place in this control`);
    }
  });
});

describe("journey detail page: delete wiring", () => {
  it("composes the delete control beside the others, per variant", () => {
    assert.ok(page.includes("<AdminPackageVariantDeleteAction"));
    assert.ok(page.includes("journey={data}"));
    assert.ok(page.includes("variant={variant}"));
  });

  it("explains every outcome the action can report", () => {
    for (const notice of ["deleted", '"must-be-inactive"', '"is-default"',
      '"has-reservations"', "gone", "uncertain"]) {
      assert.ok(deleteNotices.includes(`${notice}:`), `${notice} should have its own notice`);
    }
  });

  it("words the booking refusal as permanent, with no false remedy", () => {
    const booked = deleteNotices.slice(
      deleteNotices.indexOf('"has-reservations": {'),
      deleteNotices.indexOf("gone: {"),
    );

    assert.match(booked, /cannot be deleted/);
    assert.match(booked, /no way to remove them/);
    assert.match(booked, /the variant will stay/);

    // Cancelling a booking does not release the variant, so nothing may hint
    // that it would.
    for (const forbidden of [/cancel/i, /once the/i, /after the/i, /try again/i]) {
      assert.ok(!forbidden.test(booked), `${forbidden} would promise a door that does not exist`);
    }
  });

  it("gives the default refusal the remedy that actually works", () => {
    const blocked = deleteNotices.slice(
      deleteNotices.indexOf('"is-default": {'),
      deleteNotices.indexOf('"has-reservations"'),
    );

    // Matched across the concatenation break: the notice is written as two
    // joined string literals, so the whole sentence is not contiguous here.
    // The contiguous form is asserted on DEFAULT_BLOCKS_DELETE_NOTE in
    // lib/packages.test.ts.
    assert.match(blocked, /another variant the default first/);
    assert.match(blocked, /nothing was deleted/);
  });

  it("treats an already-removed variant as stale, not as a failure", () => {
    assert.match(deleteNotices, /That variant was already gone/);
    assert.match(deleteNotices, /has been re-read/);
  });

  it("reports an unknown outcome as unknown, and never resubmits", () => {
    assert.match(deleteNotices, /could not be confirmed/);
    assert.match(deleteNotices, /whether it is still there/);

    const unavailableBranch = deleteAction.slice(deleteAction.indexOf('case "unavailable":'));

    assert.match(unavailableBranch, /uncertain/);
    assert.ok(
      !/deleteAdminPackageVariant/.test(unavailableBranch),
      "an uncertain deletion is never repeated on its own",
    );
  });
});

describe("delete action", () => {
  it("refreshes both views and returns to the journey on success", () => {
    const ok = deleteAction.slice(deleteAction.indexOf('case "ok":'));

    assert.match(ok.slice(0, 200), /revalidateJourney\(slug\);/);
    assert.match(ok.slice(0, 200), /redirect\(variantDeleteNoticeHref\(slug, "deleted"\)\);/);
  });

  it("re-reads the journey on every refusal, so the screen shows what is true", () => {
    for (const branch of ['case "package-inactive-required":', 'case "variant-is-default":',
      'case "variant-has-reservations":', 'case "variant-not-found":']) {
      const index = deleteAction.indexOf(branch);
      assert.ok(index > 0, `${branch} should be handled`);
      assert.match(
        deleteAction.slice(index, index + 400),
        /revalidateJourney\(slug\);/,
        `${branch} should refresh`,
      );
    }
  });

  it("sends an ended session to the login page", () => {
    assert.match(deleteAction, /case "unauthenticated":\s*\n\s*redirect\("\/admin\/login"\);/);
  });

  it("never withdraws the journey on the administrator's behalf", () => {
    assert.ok(!/updatePackageStatusAction/.test(deleteAction));
  });
});
