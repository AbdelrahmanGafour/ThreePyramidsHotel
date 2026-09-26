import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// What the itinerary editor puts on the page.
//
// The component reaches a Server Action, which imports `next/headers` and
// cannot be loaded here — the same pincer the other admin write screens hit.
// So the field inventory and the wiring are asserted against the source that
// decides the markup; the parsing that consumes the submission, every bound
// and the null handling are tested directly in lib/packages.test.ts, and the
// request body in server/adminPackagesApi.test.ts.

const source = readFileSync(
  "features/admin/components/AdminPackageItineraryForm.tsx",
  "utf8",
);

const page = readFileSync(
  "app/(dashboard)/admin/journeys/[slug]/itinerary/page.tsx",
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
const itineraryAction = action.slice(
  action.indexOf("export async function replacePackageItineraryAction"),
  action.indexOf("/** Display hints the content action may hand back"),
);

/** This page's own notices: sibling pages reuse token names like `invalid`. */
const itineraryNotices = page.slice(
  page.indexOf("const SAVE_NOTICES = {"),
  page.indexOf("function SaveNotice("),
);

describe("admin itinerary form", () => {
  it("has exactly the three inputs a section carries", () => {
    for (const name of ["dayNumber", "heading", "body"]) {
      assert.ok(source.includes(`name="${name}"`), `a section should have a ${name} box`);
    }

    // One row component, not many: every row shares these names, which is
    // what makes them arrive as parallel arrays.
    assert.equal(source.match(/name="dayNumber"/g)?.length, 1);
  });

  it("has no control for a position, an id or anything about the package", () => {
    for (const name of ["sortOrder", "position", "id", "isActive", "seedManaged",
      "managementSource", "slug", "included", "excluded", "notes"]) {
      assert.ok(!source.includes(`name="${name}"`), `${name} must not be a control`);
    }
    assert.ok(!/type="hidden"/.test(source), "nothing is smuggled in a hidden field");
  });

  it("preloads each section in the order the journey reported", () => {
    assert.ok(source.includes("section={journey.itinerary[index]}"));
    assert.ok(source.includes('defaultValue={section?.dayNumber ?? ""}'));
    assert.ok(source.includes('defaultValue={section?.heading ?? ""}'));
    assert.ok(source.includes('defaultValue={section?.body ?? ""}'));
  });

  it("renders a null day or heading as an empty box, not the word null", () => {
    // `?? ""` on each nullable field is what keeps "null" off the screen.
    for (const field of ["dayNumber", "heading"]) {
      assert.ok(source.includes(`defaultValue={section?.${field} ?? ""}`));
    }
  });

  it("offers spare rows through the tested helper", () => {
    assert.ok(
      source.includes("packageItineraryRowCount(journey.itinerary.length)"),
      "including the cap, so the form cannot offer rows the API would refuse",
    );
  });

  it("says that clearing all three boxes removes the section", () => {
    assert.match(source, /Clear all three boxes to remove this section/);
    assert.match(source, /Leaving every box empty clears the itinerary, which is allowed/);
  });

  it("says each optional field may be left empty, and what that means", () => {
    assert.match(source, /Leave it empty for a section about the whole journey/);
    assert.match(source, /Leave it empty for an unheaded passage/);
    assert.match(source, /Required for any section you are using/);
  });

  it("warns that text is stored exactly as typed", () => {
    // \s+ across the phrase: JSX wraps prose, so a line break and its
    // indentation sit inside the sentence in the source.
    assert.match(source, /stored exactly\s+as typed/);
    assert.match(source, /reported rather than removed for you/);
  });

  it("submits the whole itinerary in one form", () => {
    assert.equal((source.match(/<form/g) ?? []).length, 1, "one form for every section");
    assert.ok(
      source.includes("replacePackageItineraryAction.bind(null, journey.slug)"),
      "the slug is bound, not posted",
    );
    assert.ok(!/name="slug"/.test(source));
  });

  it("caps each box at the API's own limits", () => {
    assert.ok(source.includes("maxLength={MAX_ITINERARY_HEADING_LENGTH}"));
    assert.ok(source.includes("maxLength={MAX_ITINERARY_BODY_LENGTH}"));
    assert.ok(source.includes("max={MAX_ITINERARY_DAY_NUMBER}"));
  });

  it("warns about ownership only when the journey is still the brochure's", () => {
    assert.ok(source.includes("packageItineraryOwnershipWarning(journey.managementSource)"));
    assert.ok(
      source.includes("{ownershipWarning ? (") && source.includes("{ownershipWarning}"),
      "and the panel is rendered only when it returns one",
    );
  });

  it("is gated by nothing about publication", () => {
    // The itinerary is prose; editing it on a live journey is safe.
    assert.ok(!/isActive/.test(source));
  });

  it("introduces no drag-and-drop and no client state", () => {
    for (const forbidden of [/draggable/i, /onDragStart/, /onDrop/, /"use client"/, /useState/]) {
      assert.ok(!forbidden.test(source), `${forbidden} is not part of this slice`);
    }
  });

  it("edits no content lists", () => {
    for (const forbidden of [/replacePackageContentAction/, /PACKAGE_CONTENT_LISTS/]) {
      assert.ok(!forbidden.test(source), "that is its own screen");
    }
  });
});

describe("admin itinerary page", () => {
  it("renders the form from the journey it read", () => {
    assert.ok(page.includes("<AdminPackageItineraryForm journey={journey} />"));
  });

  it("offers no form when the journey could not be read", () => {
    const unavailable = page.slice(
      page.indexOf('if (result.state === "unavailable")'),
      page.indexOf("const journey = result.data;"),
    );

    assert.ok(
      !unavailable.includes("<AdminPackageItineraryForm"),
      "saving would replace sections nobody has seen",
    );
    assert.match(unavailable, /This journey is unavailable/);
  });

  it("sends an unknown journey to the route-local not-found", () => {
    assert.match(page, /result\.state === "invalid" \|\| result\.state === "not-found"/);
    assert.match(page, /notFound\(\);/);
  });

  it("explains each refusal and says nothing was changed", () => {
    for (const notice of ["invalid", '"too-many"', "uncertain"]) {
      assert.ok(itineraryNotices.includes(`${notice}:`), `${notice} should have its own notice`);
    }
    assert.match(itineraryNotices, /nothing was changed/);
    assert.match(itineraryNotices, /Nothing was saved/);
  });

  it("names what a valid section needs, in the invalid notice", () => {
    const invalid = itineraryNotices.slice(
      itineraryNotices.indexOf("invalid: {"),
      itineraryNotices.indexOf('"too-many": {'),
    );

    assert.match(invalid, /needs a body/);
    assert.match(invalid, /whole number above zero/);
    assert.match(invalid, /Clear all three boxes of a section to remove it/);
  });

  it("reports an unknown outcome as unknown, and never resubmits", () => {
    assert.match(itineraryNotices, /could not be confirmed/);

    const unavailableBranch = itineraryAction.slice(
      itineraryAction.indexOf('case "unavailable":'),
    );

    assert.match(unavailableBranch, /uncertain/);
    assert.ok(
      !/replaceAdminPackageItinerary/.test(unavailableBranch),
      "an uncertain save is never repeated on its own",
    );
  });

  it("is reachable from the journey detail page", () => {
    assert.ok(detail.includes("packageItineraryHref(journey.slug)"));
    assert.match(detail, /Manage itinerary/);
  });
});

describe("itinerary action", () => {
  it("refreshes both views and returns to the journey on success", () => {
    const ok = itineraryAction.slice(itineraryAction.indexOf('case "ok":'));

    assert.match(ok.slice(0, 400), /revalidateJourney\(slug\);/);
    assert.match(ok.slice(0, 400), /packageDetailHref\(result\.data\.slug\)/);
    assert.match(ok.slice(0, 400), /itinerary=updated/);
  });

  it("sends an ended session to the login page", () => {
    assert.match(itineraryAction, /case "unauthenticated":\s*\n\s*redirect\("\/admin\/login"\);/);
  });

  it("keeps the two submission refusals apart", () => {
    assert.match(itineraryAction, /TooManyItinerarySectionsError/);
    assert.match(itineraryAction, /InvalidPackageSubmissionError/);
    assert.match(itineraryAction, /"too-many"/);
  });

  it("never changes publication", () => {
    assert.ok(!/isActive/.test(itineraryAction));
    assert.ok(!/updatePackageStatusAction/.test(itineraryAction));
  });
});
