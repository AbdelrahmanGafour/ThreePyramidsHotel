import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// What the content editor puts on the page.
//
// The component reaches a Server Action, which imports `next/headers` and
// cannot be loaded here — the same pincer the other admin write screens hit.
// So the field inventory and the wiring are asserted against the source that
// decides the markup; the parsing that consumes the submission and every
// bound is tested directly in lib/packages.test.ts, and the request body in
// server/adminPackagesApi.test.ts.

const source = readFileSync(
  "features/admin/components/AdminPackageContentForm.tsx",
  "utf8",
);

const page = readFileSync(
  "app/(dashboard)/admin/journeys/[slug]/content/page.tsx",
  "utf8",
);

const detail = readFileSync(
  "features/admin/components/AdminPackageDetail.tsx",
  "utf8",
);

const action = readFileSync(
  "features/admin/server/adminPackageActions.ts",
  "utf8",
);

/** This action's own branch, never a sibling's. */
const contentAction = action.slice(
  action.indexOf("export async function replacePackageContentAction"),
  action.indexOf("/** Display hints the variant delete action may hand back"),
);

describe("admin content form", () => {
  it("renders one input per list, named for that list", () => {
    // Every row of a list shares its name, which is what makes them arrive
    // as an ordered array.
    assert.ok(source.includes('name={list}'), "the row is named after its list");
    assert.ok(
      source.includes("{PACKAGE_CONTENT_LISTS.map((list) => ("),
      "and all three lists are rendered",
    );
  });

  it("has no control for anything beyond the three lists", () => {
    for (const name of ["sortOrder", "kind", "isActive", "seedManaged", "managementSource",
      "slug", "itinerary"]) {
      assert.ok(!source.includes(`name="${name}"`), `${name} must not be a control`);
    }
    assert.ok(!/type="hidden"/.test(source), "nothing is smuggled in a hidden field");
  });

  it("preloads each list in the order the journey reported", () => {
    assert.ok(source.includes("entries={journey.content[list]}"));
    assert.ok(source.includes('defaultValue={value ?? ""}'), "and a spare row starts empty");
  });

  it("offers spare rows through the tested helper", () => {
    assert.ok(
      source.includes("packageContentRowCount(entries.length)"),
      "including the cap, so the form cannot offer rows the API would refuse",
    );
  });

  it("says that clearing a box removes the line, and that clearing all is allowed", () => {
    assert.match(source, /Clear a box to remove that line/);
    assert.match(source, /Leaving every box empty clears that list, which is allowed/);
  });

  it("warns that text is stored exactly as typed", () => {
    // \s+ across the phrase: JSX wraps prose, so a line break and its
    // indentation sit inside the sentence in the source.
    assert.match(source, /stored exactly as\s+typed/);
    assert.match(source, /reported rather than removed for you/);
  });

  it("submits all three lists in one form", () => {
    assert.equal((source.match(/<form/g) ?? []).length, 1, "one form, not three");
    assert.ok(
      source.includes("replacePackageContentAction.bind(null, journey.slug)"),
      "the slug is bound, not posted",
    );
    assert.ok(!/name="slug"/.test(source));
  });

  it("caps each box at the API's own limit", () => {
    assert.ok(source.includes("maxLength={MAX_CONTENT_ENTRY_LENGTH}"));
  });

  it("warns about ownership only when the journey is still the brochure's", () => {
    assert.ok(source.includes("packageContentOwnershipWarning(journey.managementSource)"));
    assert.ok(
      source.includes("{ownershipWarning ? (") && source.includes("{ownershipWarning}"),
      "and the panel is rendered only when it returns one",
    );
  });

  it("is gated by nothing about publication", () => {
    // These lists are prose; editing them on a live journey is safe.
    assert.ok(!/isActive/.test(source));
  });

  it("introduces no drag-and-drop and no client state", () => {
    for (const forbidden of [/draggable/i, /onDragStart/, /"use client"/, /useState/]) {
      assert.ok(!forbidden.test(source), `${forbidden} is not part of this slice`);
    }
  });

  it("edits no itinerary", () => {
    assert.ok(!/itinerary/i.test(source), "that is its own later slice");
  });
});

describe("admin content page", () => {
  it("renders the form from the journey it read", () => {
    assert.ok(page.includes("<AdminPackageContentForm journey={journey} />"));
  });

  it("offers no form when the journey could not be read", () => {
    const unavailable = page.slice(
      page.indexOf('if (result.state === "unavailable")'),
      page.indexOf("const journey = result.data;"),
    );

    assert.ok(
      !unavailable.includes("<AdminPackageContentForm"),
      "saving would replace content nobody has seen",
    );
    assert.match(unavailable, /This journey is unavailable/);
  });

  it("sends an unknown journey to the route-local not-found", () => {
    assert.match(page, /result\.state === "invalid" \|\| result\.state === "not-found"/);
    assert.match(page, /notFound\(\);/);
  });

  it("explains each refusal and says nothing was changed", () => {
    for (const notice of ["invalid", '"too-many"', "uncertain"]) {
      assert.ok(page.includes(`${notice}:`), `${notice} should have its own notice`);
    }
    assert.match(page, /nothing was changed/);
    assert.match(page, /Nothing was saved/);
  });

  it("reports an unknown outcome as unknown, and never resubmits", () => {
    assert.match(page, /could not be confirmed/);

    const unavailableBranch = contentAction.slice(contentAction.indexOf('case "unavailable":'));

    assert.match(unavailableBranch, /uncertain/);
    assert.ok(
      !/replaceAdminPackageContent/.test(unavailableBranch),
      "an uncertain save is never repeated on its own",
    );
  });

  it("is reachable from the journey detail page", () => {
    assert.ok(detail.includes("packageContentHref(journey.slug)"));
    assert.match(detail, /Manage content/);
  });
});

describe("content action", () => {
  it("refreshes both views and returns to the journey on success", () => {
    const ok = contentAction.slice(contentAction.indexOf('case "ok":'));

    assert.match(ok.slice(0, 400), /revalidateJourney\(slug\);/);
    assert.match(ok.slice(0, 400), /packageDetailHref\(result\.data\.slug\)/);
    assert.match(ok.slice(0, 400), /content=updated/);
  });

  it("sends an ended session to the login page", () => {
    assert.match(contentAction, /case "unauthenticated":\s*\n\s*redirect\("\/admin\/login"\);/);
  });

  it("keeps the two submission refusals apart", () => {
    assert.match(contentAction, /TooManyContentEntriesError/);
    assert.match(contentAction, /InvalidPackageSubmissionError/);
    assert.match(contentAction, /"too-many"/);
  });

  it("never changes publication", () => {
    assert.ok(!/isActive/.test(contentAction));
    assert.ok(!/updatePackageStatusAction/.test(contentAction));
  });
});
