import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// How the permanent-delete control is wired.
//
// The component reaches a Server Action, which imports `next/headers` and
// cannot be loaded here — the same pincer the other admin write controls hit.
// So the binding, the confirmation step and the gating are asserted against
// the source that decides them; the copy and the publication rule are tested
// directly in lib/packages.test.ts, and the request in
// server/adminPackagesApi.test.ts.

const source = readFileSync(
  "features/admin/components/AdminPackageDeleteAction.tsx",
  "utf8",
);

const detailPage = readFileSync(
  "app/(dashboard)/admin/journeys/[slug]/page.tsx",
  "utf8",
);

const listPage = readFileSync(
  "app/(dashboard)/admin/journeys/page.tsx",
  "utf8",
);

const table = readFileSync(
  "features/admin/components/AdminPackagesTable.tsx",
  "utf8",
);

const action = readFileSync(
  "features/admin/server/adminPackageActions.ts",
  "utf8",
);

/** This action's own branch, never a sibling's. */
const deleteAction = action.slice(
  action.indexOf("export async function deletePackageAction"),
  action.indexOf("/** Display hints the variant delete action may hand back"),
);

/** This page's own notices: sibling blocks reuse token names like `invalid`. */
const deleteNotices = detailPage.slice(
  detailPage.indexOf("const PACKAGE_DELETE_NOTICES = {"),
  detailPage.indexOf("function PackageDeleteNotice("),
);

describe("permanent-delete control", () => {
  it("binds the journey server-side and posts no body", () => {
    assert.ok(
      source.includes("deletePackageAction.bind(null, journey.slug)"),
      "the slug is bound, not submitted",
    );
    assert.ok(!/name=/.test(source), "the form carries no input");
    assert.ok(!/type="hidden"/.test(source));
  });

  it("offers no submit control while the journey is live", () => {
    const hidden = source.slice(
      source.indexOf('if (state === "hidden") {'),
      source.indexOf("const submit ="),
    );

    assert.ok(!hidden.includes("<form"), "no form is rendered");
    assert.ok(!hidden.includes("AdminActionButton"), "and no button");
    assert.ok(hidden.includes("{PACKAGE_DELETE_BLOCKED_NOTE}"), "just the remedy");
  });

  it("asks the tested helper whether to offer anything", () => {
    assert.ok(source.includes("packageDeleteState(journey)"));
  });

  it("puts the destructive button behind an explicit second step", () => {
    assert.ok(source.includes("<details"), "the delete is not reachable in one click");
    assert.ok(source.includes("<summary"), "and the first step says what it opens");
    assert.ok(
      source.indexOf("<summary") < source.indexOf("<form"),
      "the disclosure wraps the form, not the other way round",
    );
  });

  it("names the journey in the confirmation copy", () => {
    assert.ok(source.includes("{packageDeleteConfirmation(journey)}"));
    assert.ok(
      source.includes("{`Delete ${journey.title}`}"),
      "and again on the button itself",
    );
  });

  it("adds no dialog framework", () => {
    for (const forbidden of [/"use client"/, /useState/, /createPortal/, /role="dialog"/,
      /aria-modal/, /showModal/]) {
      assert.ok(!forbidden.test(source), `${forbidden} is not part of this slice`);
    }
  });

  it("uses the shared destructive tone, once", () => {
    assert.ok(source.includes('tone="cancel"'));
    assert.equal((source.match(/<AdminActionButton/g) ?? []).length, 1, "exactly one button");
  });

  it("distinguishes deleting from deactivating", () => {
    assert.match(source, /not the same as deactivating/);
    assert.match(source, /Deactivation keeps the record/);
  });

  it("advises on a brochure journey without deciding for the backend", () => {
    assert.ok(source.includes("packageDeleteBrochureAdvisory(journey.managementSource)"));
    assert.ok(
      source.includes("{brochureAdvisory ? ("),
      "shown only when the helper returns one",
    );

    // The advisory does not gate the control: the backend judges the journey's
    // CODE and SLUG, which this app cannot see.
    assert.ok(
      !source.includes("if (brochureAdvisory)") || !source.includes("return null"),
      "the advisory never suppresses the control",
    );
  });

  it("never reconstructs the brochure catalogue", () => {
    for (const forbidden of [/BROCHURE_PACKAGE_CATALOGUE/, /isReservedBrochure/,
      /RESERVED_CODES/, /RESERVED_SLUGS/]) {
      assert.ok(!forbidden.test(source), "that list belongs to the API, not to this app");
    }
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
    for (const forbidden of [/updatePackageStatusAction/, /deletePackageVariantAction/,
      /replacePackageContentAction/, /replacePackageItineraryAction/]) {
      assert.ok(!forbidden.test(source), `${forbidden} has no place in this control`);
    }
  });
});

describe("journey detail page: delete wiring", () => {
  it("places the delete panel last, below everything it would destroy", () => {
    assert.ok(detailPage.includes("<AdminPackageDeleteAction journey={data} />"));
    assert.ok(
      detailPage.indexOf("<AdminPackageDeleteAction")
        > detailPage.indexOf("<AdminPackageDetailView"),
    );
  });

  it("explains each outcome the action can report", () => {
    for (const notice of ['"must-be-inactive"', '"brochure-managed"', '"has-reservations"',
      "invalid", "uncertain"]) {
      assert.ok(deleteNotices.includes(`${notice}:`), `${notice} should have its own notice`);
    }
  });

  it("gives the publication refusal the remedy that works", () => {
    const blocked = deleteNotices.slice(
      deleteNotices.indexOf('"must-be-inactive": {'),
      deleteNotices.indexOf('"brochure-managed": {'),
    );

    assert.match(blocked, /Deactivate it/);
    assert.match(blocked, /nothing was deleted/);
  });

  it("explains the brochure refusal and recommends deactivation", () => {
    const brochure = deleteNotices.slice(
      deleteNotices.indexOf('"brochure-managed": {'),
      deleteNotices.indexOf('"has-reservations": {'),
    );

    // Matched either side of the concatenation break: the notice is written
    // as joined string literals, so the sentence is not contiguous here.
    assert.match(brochure, /the catalogue/);
    assert.match(brochure, /seed would simply recreate it/);
    assert.match(brochure, /Deactivating it is the durable way/);

    for (const forbidden of [/resync/i, /reseed control/i, /revert/i]) {
      assert.ok(!forbidden.test(brochure), "no such control exists");
    }
  });

  it("words the booking refusal as permanent, with no false remedy", () => {
    const booked = deleteNotices.slice(
      deleteNotices.indexOf('"has-reservations": {'),
      deleteNotices.indexOf("invalid: {"),
    );

    assert.match(booked, /cannot be deleted/);
    assert.match(booked, /no way to remove them/);
    assert.match(booked, /the journey will stay/);
    assert.match(booked, /remain deactivated instead/);

    for (const forbidden of [/cancel/i, /once the/i, /after the/i, /try again/i]) {
      assert.ok(!forbidden.test(booked), `${forbidden} would promise a door that does not exist`);
    }
  });

  it("reports an unknown outcome as unknown, and never resubmits", () => {
    assert.match(deleteNotices, /could not be confirmed/);
    assert.match(deleteNotices, /Check the catalogue to see whether/);
    assert.match(deleteNotices, /this journey still exists/);

    const unavailableBranch = deleteAction.slice(deleteAction.indexOf('case "unavailable":'));

    assert.match(unavailableBranch, /uncertain/);
    assert.ok(
      !/deleteAdminPackage\(/.test(unavailableBranch),
      "an uncertain deletion is never repeated on its own",
    );
  });
});

describe("journey catalogue: delete aftermath", () => {
  it("reports a completed deletion on the list", () => {
    assert.ok(listPage.includes("<CatalogueNotice notice={deleted} />"));
    assert.match(listPage, /have been deleted/);
  });

  it("reports an already-gone journey neutrally", () => {
    assert.match(listPage, /was already gone/);
    assert.ok(
      !/you deleted/i.test(listPage),
      "another administrator may have removed it",
    );
  });

  it("adds no delete control to the catalogue list itself", () => {
    for (const forbidden of [/deletePackageAction/, /Delete this journey/, /Delete journey/]) {
      assert.ok(!forbidden.test(table), "this slice adds delete to the detail page only");
    }
  });

  it("adds no bulk delete", () => {
    for (const forbidden of [/type="checkbox"/, /selectAll/i, /bulk/i]) {
      assert.ok(!forbidden.test(table), `${forbidden} is not part of this slice`);
    }
  });
});

describe("delete action", () => {
  it("refreshes the catalogue and lands there on success", () => {
    const ok = deleteAction.slice(deleteAction.indexOf('case "ok":'));

    assert.match(ok.slice(0, 400), /revalidatePath\(PACKAGES_PATH\);/);
    assert.match(ok.slice(0, 400), /\$\{PACKAGES_PATH\}\?deleted=1/);
    assert.ok(
      !ok.slice(0, 400).includes("packageDetailHref"),
      "there is no detail page to return to",
    );
  });

  it("sends an ended session to the login page", () => {
    assert.match(deleteAction, /case "unauthenticated":\s*\n\s*redirect\("\/admin\/login"\);/);
  });

  it("lands an already-deleted journey on the catalogue, not a dead detail page", () => {
    const gone = deleteAction.slice(deleteAction.indexOf('case "package-not-found":'));

    assert.match(gone.slice(0, 500), /revalidatePath\(PACKAGES_PATH\);/);
    assert.match(gone.slice(0, 500), /deleted=gone/);
  });

  it("re-reads the journey on every refusal, so the screen shows what is true", () => {
    for (const branch of ['case "must-be-inactive":', 'case "brochure-managed":',
      'case "has-reservations":']) {
      const index = deleteAction.indexOf(branch);
      assert.ok(index > 0, `${branch} should be handled`);
      assert.match(
        deleteAction.slice(index, index + 400),
        /revalidateJourney\(slug\);/,
        `${branch} should refresh`,
      );
    }
  });

  it("never withdraws the journey on the administrator's behalf", () => {
    assert.ok(!/updatePackageStatusAction/.test(deleteAction));
    assert.ok(!/isActive/.test(deleteAction));
  });
});
