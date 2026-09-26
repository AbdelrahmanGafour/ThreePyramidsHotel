import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// What the edit form puts on the page.
//
// The component reaches a Server Action, which imports `next/headers` and
// cannot be loaded here — the same pincer the other admin write screens hit.
// So the field inventory and the pre-fill wiring are asserted against the
// component's source, which is what decides the markup; the parsing that
// consumes the submission and the warning that gates it are tested directly
// in lib/packages.test.ts.

const source = readFileSync(
  "features/admin/components/AdminPackageEditForm.tsx",
  "utf8",
);

describe("admin journey edit form", () => {
  it("has an input for every field the edit contract accepts", () => {
    for (const name of [
      "title",
      "summary",
      "description",
      "durationLabel",
      "scheduleLabel",
      "operatingDays",
      "requiresPriceConfirmation",
      "sortOrder",
    ]) {
      assert.ok(source.includes(`name="${name}"`), `the form should have a ${name} control`);
    }
  });

  it("pre-fills every field from the journey it was given", () => {
    for (const binding of [
      "defaultValue={journey.title}",
      'defaultValue={journey.summary ?? ""}',
      'defaultValue={journey.description ?? ""}',
      'defaultValue={journey.durationLabel ?? ""}',
      'defaultValue={journey.scheduleLabel ?? ""}',
      "defaultChecked={selectedDays.has(day)}",
      "defaultChecked={journey.requiresPriceConfirmation}",
      "defaultValue={journey.sortOrder}",
    ]) {
      assert.ok(source.includes(binding), `the form should pre-fill with ${binding}`);
    }
  });

  it("renders a null optional value as an empty box, not the word null", () => {
    // `?? ""` on each nullable field is what keeps "null" off the screen.
    for (const field of ["summary", "description", "durationLabel", "scheduleLabel"]) {
      assert.ok(
        source.includes(`defaultValue={journey.${field} ?? ""}`),
        `${field} should fall back to an empty box`,
      );
    }
  });

  it("offers no control for identity, publication or ownership", () => {
    for (const name of ["code", "slug", "isActive", "seedManaged", "managementSource"]) {
      assert.ok(!source.includes(`name="${name}"`), `${name} must not be an editable field`);
    }
  });

  it("shows the code and address as read-only context", () => {
    assert.ok(source.includes("{journey.code}"), "the code is shown");
    assert.ok(source.includes("{journey.slug}"), "the address is shown");
    assert.match(source, /cannot be changed/);
    // Shown inside a definition list, never inside an input.
    assert.match(source, /<dd>\{journey\.code\}<\/dd>/);
  });

  it("carries no hidden field at all", () => {
    assert.ok(!source.includes('type="hidden"'), "a hidden field is a value nobody can see");
  });

  it("binds the slug on the server rather than posting it", () => {
    assert.match(source, /editPackageAction\.bind\(null, journey\.slug\)/);
    assert.ok(!source.includes("fetch("), "the browser never calls the API directly");
  });

  it("shows the ownership warning only when the helper returns one", () => {
    // The decision is the pure helper's; the component only renders it, so a
    // brochure-owned journey cannot be saved without the warning appearing.
    assert.match(source, /packageOwnershipWarning\(journey\.managementSource\)/);
    assert.match(source, /ownershipWarning \?/);
  });

  it("points publication elsewhere rather than offering it here", () => {
    assert.match(source, /changed from its own page/);
  });

  it("does not promise anything this slice cannot do", () => {
    for (const forbidden of [/\bdelete\b/i, /\bresync/i, /\brefund/i, /\bpayment/i]) {
      assert.ok(!forbidden.test(source), "the form must not imply a workflow that does not exist");
    }
  });
});
