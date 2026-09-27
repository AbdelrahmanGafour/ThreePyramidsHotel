import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// What the new-variant screen puts on the page, and what it refuses to.
//
// The component reaches a Server Action, which imports `next/headers` and
// cannot be loaded here — the same pincer the other admin write screens hit.
// So the field inventory and the gating are asserted against the source that
// decides the markup; the parsing that consumes the submission, the
// publication rule and the ownership rule are tested directly in
// lib/packages.test.ts, and the request body in server/adminPackagesApi.test.ts.

const source = readFileSync(
  "features/admin/components/AdminPackageVariantCreateForm.tsx",
  "utf8",
);

const page = readFileSync(
  "app/(dashboard)/admin/journeys/[slug]/variants/new/page.tsx",
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

describe("admin variant create form", () => {
  it("has an input for each of the five supported fields", () => {
    for (const name of ["key", "label", "childMinAge", "childMaxAge", "childDiscountPercent"]) {
      assert.ok(source.includes(`name="${name}"`), `the form should have a ${name} control`);
    }
  });

  it("has no control for anything the server owns", () => {
    for (const name of ["isDefault", "sortOrder", "rates", "minPartySize", "adultUnitRate",
      "isActive", "seedManaged", "managementSource", "code", "slug"]) {
      assert.ok(!source.includes(`name="${name}"`), `${name} must not be a control`);
    }
  });

  it("prices nothing: no rate tier reaches this form", () => {
    // Prose explaining that rates are set elsewhere is welcome; wiring that
    // could set one is not.
    for (const forbidden of [/replacePackageRatesAction/, /PackageRateTierInput/,
      /packageRatesHref/, /parsePackageRatesForm/]) {
      assert.ok(!forbidden.test(source), `${forbidden} has no place on this screen`);
    }
    assert.ok(!/name="(minPartySize|maxPartySize|adultUnitRate)"/.test(source));
  });

  it("binds the journey server-side, so the browser submits no identity", () => {
    assert.ok(
      source.includes("createPackageVariantAction.bind(null, journey.slug)"),
      "the slug is bound, not posted",
    );
    assert.ok(!/name="slug"/.test(source));
    assert.ok(!/type="hidden"/.test(source), "nothing is smuggled in a hidden field");
  });

  it("takes the key exactly as typed", () => {
    const keyBox = source.slice(source.indexOf('name="key"'));
    const declared = keyBox.slice(0, keyBox.indexOf("/>"));

    assert.match(declared, /autoCapitalize="none"/, "the browser must not case-correct it");
    assert.match(declared, /autoCorrect="off"/);
    assert.match(declared, /spellCheck=\{false\}/);
    assert.match(source, /cannot be changed afterwards/, "and the form says so");
  });

  it("keeps the discount a text box, so nothing rounds it", () => {
    const box = source.slice(source.indexOf('name="childDiscountPercent"'));
    const declared = box.slice(0, box.indexOf("/>"));

    assert.match(declared, /type="text"/, "a number input would invite rounding");
    assert.match(declared, /inputMode="decimal"/);
  });

  it("makes the child rule all-or-nothing through one checkbox", () => {
    assert.ok(source.includes('name="childPricingEnabled"'));
    assert.match(source, /all three are required/);
    assert.match(source, /Leave this unticked for no child rate at all/);
  });

  it("starts with the child rule off, because a new variant has none", () => {
    const box = source.slice(source.indexOf('name="childPricingEnabled"'));
    const declared = box.slice(0, box.indexOf("/>"));

    assert.ok(!declared.includes("defaultChecked"), "nothing is ticked for a variant that is new");
  });

  it("states what the server will decide, without offering a control for it", () => {
    assert.ok(
      source.includes("packageVariantDefaultNote(journey.variants.length)"),
      "the wording is the tested helper's",
    );
    for (const forbidden of [/name="isDefault"/, /Make this the default/i, /Reorder/i,
      /Move up/i, /Delete variant/i]) {
      assert.ok(!forbidden.test(source), `${forbidden} has no place on this screen`);
    }
  });

  it("warns about ownership only when the journey is still the brochure's", () => {
    assert.ok(
      source.includes("packageVariantCreateOwnershipWarning(journey.managementSource)"),
      "the decision is the tested helper's",
    );
    assert.ok(
      source.includes("{ownershipWarning ? (") && source.includes("{ownershipWarning}"),
      "and the panel is rendered only when it returns one",
    );
  });
});

describe("admin variant create page", () => {
  it("renders the form for a withdrawn journey", () => {
    assert.ok(page.includes("<AdminPackageVariantCreateForm journey={journey} />"));
    assert.ok(
      page.includes("if (!packageAllowsVariantCreate(journey)) {"),
      "the rule is the tested helper's, not this page's",
    );
  });

  it("offers no usable form for a live journey, and explains why", () => {
    // Newline-agnostic: checkouts of this repository carry CRLF, so slicing
    // on a literal \n run pins the bytes a checkout happened to write
    // rather than the branch this test is about.
    const blocked = page.slice(
      page.indexOf("if (!packageAllowsVariantCreate(journey)) {"),
      page.search(/return \(\s*<>\s*<PageHeader slug=\{journey\.slug\} title=\{journey\.title\} \/>\s*<SaveNotice/),
    );

    assert.ok(!blocked.includes("<AdminPackageVariantCreateForm"), "no form is rendered");
    assert.ok(!blocked.includes("<form"), "and no form of any kind");
    assert.match(blocked, /Deactivate this journey first/);
    assert.match(blocked, /VARIANT_CREATE_BLOCKED_MESSAGE/);
  });

  it("never withdraws the journey on the administrator's behalf", () => {
    // The blocked panel links to the journey, where withdrawing is their own
    // deliberate act; nothing here performs it.
    assert.ok(!/updatePackageStatusAction/.test(page));
    assert.match(page, /Go to the journey to deactivate it/);
  });

  it("offers no form when the journey could not be read", () => {
    const unavailable = page.slice(
      page.indexOf('if (result.state === "unavailable")'),
      page.indexOf("const journey = result.data;"),
    );

    assert.ok(
      !unavailable.includes("<AdminPackageVariantCreateForm"),
      "whether a variant may be added depends on state this page could not read",
    );
    assert.match(unavailable, /This journey is unavailable/);
  });

  it("sends an unknown journey to the route-local not-found", () => {
    assert.match(page, /result\.state === "invalid" \|\| result\.state === "not-found"/);
    assert.match(page, /notFound\(\);/);
  });

  it("explains each refusal and says nothing was created", () => {
    for (const notice of ["invalid", '"key-in-use"', '"must-be-inactive"', '"default-unsafe"',
      '"order-exhausted"', "uncertain"]) {
      assert.ok(page.includes(`${notice}:`), `${notice} should have its own notice`);
    }

    // Every refusal names what did not happen, so nobody goes looking for a
    // variant that was never added.
    assert.equal(
      (page.match(/Nothing was created/g) ?? []).length
        + (page.match(/nothing was created/g) ?? []).length,
      5,
      "each of the five refusals says so",
    );
  });

  it("reports an unknown outcome as unknown, and never resubmits", () => {
    assert.match(page, /could not be confirmed/);
    assert.match(page, /could add the variant twice/);

    // Scoped to this action: the file holds several, each with its own branch.
    const createAction = action.slice(
      action.indexOf("export async function createPackageVariantAction"),
    );
    const unavailableBranch = createAction.slice(createAction.indexOf('case "unavailable":'));

    assert.match(unavailableBranch, /uncertain/);
    assert.ok(
      !/createAdminPackageVariant/.test(unavailableBranch),
      "an uncertain create is never repeated on its own",
    );
  });

  it("returns to the journey on success, having re-read both views", () => {
    const createAction = action.slice(
      action.indexOf("export async function createPackageVariantAction"),
      action.indexOf("/** Display hints the rates action may hand back"),
    );
    const ok = createAction.slice(createAction.indexOf('case "ok":'));

    assert.match(ok.slice(0, 200), /revalidateJourney\(slug\);/);
    assert.match(ok.slice(0, 200), /redirect\(packageDetailHref\(result\.data\.slug\)\);/);
    assert.match(createAction, /case "unauthenticated":\s*\n\s*redirect\("\/admin\/login"\);/);
  });
});

describe("admin journey detail: add-variant entry point", () => {
  it("offers Add variant while the journey is withdrawn", () => {
    assert.ok(detail.includes("packageAllowsVariantCreate(journey)"));
    assert.ok(detail.includes("packageVariantNewHref(journey.slug)"));
    assert.match(detail, /Add variant/);
  });

  it("says why instead of linking when the journey is live", () => {
    assert.match(detail, /Deactivate this journey to add a variant/);
  });

  it("adds no delete, reorder or default control", () => {
    for (const forbidden of [/Delete variant/i, /Remove variant/i, /Reorder/i, /Move up/i,
      /Move down/i, /Make default/i, /Set as default/i]) {
      assert.ok(!forbidden.test(detail), `${forbidden} is not part of this slice`);
    }
  });
});
