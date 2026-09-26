import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminFormField } from "./AdminFormField";
import { PACKAGE_WEEKDAYS } from "../lib/packages";

// What the create form actually puts on the page.
//
// The form component itself reaches a Server Action, which imports
// `next/headers` and cannot be loaded here — the same pincer the other admin
// write screens hit. So the field inventory is asserted against the shared
// field component and the weekday source the form renders from, which is what
// decides the markup, and the parsing that consumes the submission is tested
// directly in lib/packages.test.ts.

const render = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe("admin journey create form fields", () => {
  it("offers every weekday the API accepts, and only those", () => {
    assert.deepEqual([...PACKAGE_WEEKDAYS], [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
  });

  it("renders a labelled control with its hint, wired for assistive technology", () => {
    const html = render(
      <AdminFormField id="journey-new-code" label="Code" hint="The hotel's own reference.">
        <input id="journey-new-code" name="code" type="text" aria-describedby="journey-new-code-hint" />
      </AdminFormField>,
    );

    assert.match(html, /for="journey-new-code"/);
    assert.match(html, /id="journey-new-code-hint"/);
    assert.match(html, /aria-describedby="journey-new-code-hint"/);
    assert.match(html, /name="code"/);
  });
});

describe("admin journey create form source", () => {
  // Read as text rather than rendered, because the component cannot be
  // imported in this process. Crude, but it is the only way to assert the
  // field inventory — and the inventory is exactly what must not drift from
  // the API's create contract.
  const source = readFileSync(
    "features/admin/components/AdminPackageCreateForm.tsx",
    "utf8",
  );

  it("has an input for every field the create contract accepts", () => {
    for (const name of [
      "code",
      "slug",
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

  it("offers no control for publication or ownership", () => {
    for (const name of ["isActive", "seedManaged", "managementSource", "seed_managed"]) {
      assert.ok(!source.includes(`name="${name}"`), `${name} is the server's own, not a form field`);
    }
  });

  it("carries no hidden field at all", () => {
    assert.ok(!source.includes('type="hidden"'), "a hidden field is a value nobody can see");
  });

  it("posts to the Server Action rather than to the API", () => {
    assert.match(source, /action=\{createPackageAction\}/);
    assert.ok(!source.includes("fetch("), "the browser never calls the API directly");
  });

  it("explains that the journey starts as a draft and is activated later", () => {
    assert.match(source, /created as a draft/);
    assert.match(source, /activate it\s*\n?\s*explicitly/);
    // The identity warning an administrator cannot undo later.
    assert.match(source, /cannot be changed/);
  });

  it("tells the administrator that brochure codes are not available", () => {
    assert.match(source, /T001–T025, P01–P17/);
  });

  it("does not promise anything this slice cannot do", () => {
    for (const forbidden of [/\bdelete\b/i, /\brefund/i, /\bpayment/i]) {
      assert.ok(!forbidden.test(source), "the form must not imply a workflow that does not exist");
    }
  });
});

describe("admin journey create: the shared create-page shape", () => {
  const source = readFileSync("features/admin/components/AdminPackageCreateForm.tsx", "utf8");
  const page = readFileSync("app/(dashboard)/admin/journeys/new/page.tsx", "utf8");

  it("is a FormPage opening with a masthead", () => {
    assert.match(source, /<FormPage>/);
    assert.match(source, /<FormMasthead[\s\S]*?title="New journey"/);
    assert.match(source, /lede="Add a journey of the hotel/);
  });

  it("leaves the page with no heading of its own", () => {
    // The masthead carries the <h1>; two would be one too many.
    assert.ok(!page.includes("adm-page-title"), "the heading moved into the masthead");
    assert.ok(!page.includes("adm-page-lede"), "and so did the lede");
    assert.match(page, /Back to journeys/, "the way back stays in the page header");
  });

  it("groups the fields into named sections instead of one long list", () => {
    for (const title of [
      "What creating a journey does",
      "Basic information",
      "Schedule",
      "Wording",
      "Pricing behaviour",
    ]) {
      assert.ok(source.includes(`title="${title}"`), `${title} is a section`);
    }
  });

  it("keeps every field inside one form, so grouping changes no payload", () => {
    assert.equal((source.match(/<FormStack\b/g) ?? []).length, 1);
    assert.ok(!source.includes("<form "), "no second form, and no nested one");
  });

  it("ends with one action bar carrying the submit and the way out", () => {
    assert.match(source, /<FormActions cancelHref=\{PACKAGES_PATH\} cancelLabel="Cancel">/);
    assert.match(source, /Create journey/);
    assert.ok(
      source.indexOf("<FormActions") > source.indexOf('title="Pricing behaviour"'),
      "after the last group of fields",
    );
  });

  it("does not use the detail pages' table pair, which would duplicate inputs", () => {
    // `.adm-table-wrap` and `.adm-list` render the same content twice and hide
    // one with CSS. For a form that would mean two controls sharing each id.
    assert.ok(!source.includes("adm-table-wrap"));
    assert.ok(!source.includes('className="adm-list"'));
    assert.ok(!source.includes("DetailFacts"));
  });

  it("keeps the weekday checkboxes as one fieldset with one legend", () => {
    assert.match(source, /<fieldset className="adm-field">/);
    assert.match(source, /<legend className="field-label">Operating days<\/legend>/);
    assert.equal((source.match(/<fieldset/g) ?? []).length, 1);
  });

  it("puts the confirmation option in a pricing section that sets no price", () => {
    const pricing = source.slice(source.indexOf('title="Pricing behaviour"'));

    assert.match(pricing, /No amount is set here/);
    assert.match(pricing, /variants and their rate tiers/);
    assert.match(pricing, /name="requiresPriceConfirmation"/);
  });

  it("exposes no price field of its own, anywhere on the page", () => {
    // A journey has no price: the architecture is journey → variant → rate
    // tiers, and a field here would be a fourth place a price could come from.
    for (const invented of [
      'name="price"',
      'name="baseRate"',
      'name="basePrice"',
      'name="adultUnitRate"',
      'name="rate"',
      'name="amount"',
      'name="currency"',
    ]) {
      assert.ok(!source.includes(invented), `${invented} is not a journey field`);
    }
  });

  it("keeps every validation attribute and every hint wired to its control", () => {
    assert.equal((source.match(/\brequired\b/g) ?? []).length, 3, "code, address, title");
    assert.match(source, /defaultValue=\{0\}/, "position still defaults to 0");
    assert.match(source, /maxLength=\{200\}/);
    assert.match(source, /maxLength=\{5000\}/);

    for (const id of [
      "journey-new-code",
      "journey-new-slug",
      "journey-new-title",
      "journey-new-summary",
      "journey-new-description",
      "journey-new-duration",
      "journey-new-schedule",
      "journey-new-sort-order",
      "journey-new-confirmation",
    ]) {
      assert.ok(source.includes(`aria-describedby="${id}-hint"`), `${id} still points at its hint`);
    }
  });
});
