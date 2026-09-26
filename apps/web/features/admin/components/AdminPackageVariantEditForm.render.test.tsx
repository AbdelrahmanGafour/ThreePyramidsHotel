import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// What the variant edit form puts on the page.
//
// The component reaches a Server Action, which imports `next/headers` and
// cannot be loaded here — the same pincer the other admin write screens hit.
// So the field inventory and the pre-fill wiring are asserted against the
// component's source; the parsing that consumes the submission and the
// warning that gates it are tested directly in lib/packages.test.ts.

const source = readFileSync(
  "features/admin/components/AdminPackageVariantEditForm.tsx",
  "utf8",
);

const detailSource = readFileSync(
  "features/admin/components/AdminPackageDetail.tsx",
  "utf8",
);

describe("admin variant edit form", () => {
  it("has an input for every field the edit contract accepts", () => {
    for (const name of ["label", "childMinAge", "childMaxAge", "childDiscountPercent"]) {
      assert.ok(source.includes(`name="${name}"`), `the form should have a ${name} control`);
    }
  });

  it("has one checkbox that turns the whole child rule on or off", () => {
    assert.ok(source.includes('name="childPricingEnabled"'));
    assert.ok(source.includes("defaultChecked={childPricing}"), "it reflects the stored rule");
    assert.match(source, /a rule cannot be half set/);
  });

  it("pre-fills the label and the existing child rule", () => {
    for (const binding of [
      "defaultValue={variant.label}",
      'defaultValue={variant.childMinAge ?? ""}',
      'defaultValue={variant.childMaxAge ?? ""}',
      'defaultValue={variant.childDiscountPercent ?? ""}',
    ]) {
      assert.ok(source.includes(binding), `the form should pre-fill with ${binding}`);
    }
  });

  it("renders a variant with no child rule as empty boxes, not the word null", () => {
    // `?? ""` on each nullable field is what keeps "null" off the screen, and
    // the toggle starts unticked because `childPricing` is false.
    for (const field of ["childMinAge", "childMaxAge", "childDiscountPercent"]) {
      assert.ok(source.includes(`defaultValue={variant.${field} ?? ""}`));
    }
    assert.ok(source.includes("const childPricing = hasChildPricing(variant)"));
  });

  it("keeps the discount a text input, so nothing rounds it", () => {
    assert.match(source, /name="childDiscountPercent"[\s\S]{0,200}type="text"/);
    assert.match(source, /would invite the browser[\s\S]{0,60}round it/);
  });

  it("offers no control for the key, default flag, order or rates", () => {
    for (const name of ["key", "slug", "isDefault", "sortOrder", "rates", "adultUnitRate"]) {
      assert.ok(!source.includes(`name="${name}"`), `${name} must not be an editable field`);
    }
  });

  it("shows the identity and the rate count as read-only context", () => {
    assert.match(source, /<dd>\{variant\.key\}<\/dd>/);
    assert.ok(source.includes("{variant.isDefault ?"), "the default flag is shown, not edited");
    assert.ok(source.includes("{variant.sortOrder}"));
    assert.match(source, /managed elsewhere/);
  });

  it("carries no hidden field at all", () => {
    assert.ok(!source.includes('type="hidden"'), "a hidden field is a value nobody can see");
  });

  it("binds both identity segments on the server rather than posting them", () => {
    assert.match(source, /editPackageVariantAction\.bind\(null, journey\.slug, variant\.key\)/);
    assert.ok(!source.includes("fetch("), "the browser never calls the API directly");
  });

  it("shows the ownership warning only when the helper returns one", () => {
    assert.match(source, /packageVariantOwnershipWarning\(journey\.managementSource\)/);
    assert.match(source, /ownershipWarning \?/);
  });

  it("does not promise anything this slice cannot do", () => {
    for (const forbidden of [/\bdelete\b/i, /\bresync/i, /\breorder/i, /\brefund/i]) {
      assert.ok(!forbidden.test(source), "the form must not imply a workflow that does not exist");
    }
  });
});

describe("journey detail variant entry point", () => {
  it("links each variant to its own edit page", () => {
    assert.match(detailSource, /packageVariantEditHref\(slug, variant\.key\)/);
    assert.match(detailSource, /Edit variant/);
  });

  it("adds no rate-tier control while rates are read-only", () => {
    for (const forbidden of ["Edit rate", "Add rate", "Delete rate", 'name="adultUnitRate"']) {
      assert.ok(!detailSource.includes(forbidden), `${forbidden} is not part of this slice`);
    }
  });
});
