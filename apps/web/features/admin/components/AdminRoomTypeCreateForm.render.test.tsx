import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Inspected rather than rendered.
//
// The form reaches a Server Action, which imports `next/headers` and cannot
// be loaded in this process — the same pincer every admin write screen hits.
// So what this file asserts is the field inventory and the page structure,
// and the shared pieces they are built from are rendered and tested in
// AdminFormPage.test.tsx.

const source = readFileSync("features/admin/components/AdminRoomTypeCreateForm.tsx", "utf8");
const page = readFileSync("app/(dashboard)/admin/room-types/new/page.tsx", "utf8");

describe("admin room type create: the shared create-page shape", () => {
  it("is a FormPage opening with a masthead", () => {
    assert.match(source, /<FormPage>/);
    assert.match(source, /<FormMasthead\s*\n?\s*title="New room type"/);
    assert.match(source, /lede="A room type is what a guest books\./);
  });

  it("leaves the page with no heading of its own", () => {
    // The masthead carries the <h1>; two would be one too many.
    assert.ok(!page.includes("adm-page-title"), "the heading moved into the masthead");
    assert.ok(!page.includes("adm-page-lede"), "and so did the lede");
    assert.match(page, /Back to room types/, "the way back stays in the page header");
  });

  it("groups the fields into named sections instead of one long list", () => {
    for (const title of [
      "What creating a room type does",
      "Basic information",
      "Capacity",
      "Pricing",
      "Room configuration",
      "Listing",
    ]) {
      assert.ok(source.includes(`title="${title}"`), `${title} is a section`);
    }
  });

  it("keeps every field inside one form, so grouping changes no payload", () => {
    assert.equal((source.match(/<FormStack\b/g) ?? []).length, 1);
    assert.ok(!source.includes("<form "), "no second form, and no nested one");
  });

  it("ends with one action bar carrying the submit and the way out", () => {
    assert.match(source, /<FormActions cancelHref=\{ROOM_TYPES_PATH\} cancelLabel="Cancel">/);
    assert.match(source, /Create room type/);
    assert.ok(
      source.indexOf("<FormActions") > source.indexOf('title="Listing"'),
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
});

describe("admin room type create: the form itself", () => {
  it("has an input for every field the create contract accepts", () => {
    for (const name of [
      "slug",
      "name",
      "capacity",
      "baseNightlyRate",
      "shortDescription",
      "description",
      "bedType",
      "bedCount",
      "sizeSqm",
      "view",
      "sortOrder",
    ]) {
      assert.ok(source.includes(`name="${name}"`), `the form should have a ${name} control`);
    }
  });

  it("offers no control for anything the server owns", () => {
    for (const name of ["isActive", "roomCount", "currency", "id"]) {
      assert.ok(!source.includes(`name="${name}"`), `${name} is the server's own, not a form field`);
    }
  });

  it("carries no hidden field at all", () => {
    assert.ok(!source.includes('type="hidden"'), "a hidden field is a value nobody can see");
  });

  it("posts to the Server Action rather than to the API", () => {
    assert.match(source, /action=\{createAdminRoomTypeAction\}/);
    assert.ok(!source.includes("fetch("), "the browser never calls the API directly");
  });

  it("keeps every validation attribute the API's contract is mirrored by", () => {
    // Changing any of these would let the browser accept what the API refuses,
    // or refuse what it accepts.
    assert.match(source, /pattern="\\d\{1,10\}\(\\\.\\d\{1,2\}\)\?"/, "the rate's own pattern");
    assert.match(source, /pattern="\\d\{1,4\}\(\\\.\\d\{1,2\}\)\?"/, "the room size's pattern");
    assert.match(source, /max=\{2147483647\}/, "the integer column's exact ceiling");
    assert.equal((source.match(/\brequired\b/g) ?? []).length, 4, "slug, name, capacity, rate");
    assert.match(source, /maxLength=\{120\}/);
    assert.match(source, /maxLength=\{300\}/);
    assert.match(source, /maxLength=\{2000\}/);
  });

  it("keeps every hint wired to its own control", () => {
    for (const id of [
      "room-type-new-slug",
      "room-type-new-name",
      "room-type-new-capacity",
      "room-type-new-baseNightlyRate",
      "room-type-new-shortDescription",
      "room-type-new-description",
      "room-type-new-bedType",
      "room-type-new-bedCount",
      "room-type-new-sizeSqm",
      "room-type-new-view",
      "room-type-new-sortOrder",
    ]) {
      assert.ok(
        source.includes(`aria-describedby="${id}-hint"`),
        `${id} still points at its hint`,
      );
    }
  });

  it("still says the reference is permanent, where the field is", () => {
    const basics = source.slice(source.indexOf('title="Basic information"'), source.indexOf('title="Capacity"'));

    assert.match(basics, /cannot be changed after the room type is created/);
  });

  it("still says the room type is created as a draft with no rooms", () => {
    assert.match(source, /created as a draft/);
    assert.match(source, /No physical rooms are created with it/);
  });

  it("says plainly that Sleeps is the only occupancy figure there is", () => {
    // The model holds one capacity. No adult, child or total figure exists,
    // and the section must not imply otherwise by leaving room for them.
    assert.match(source, /the only occupancy figure a room type has/);
    for (const invented of ['name="adultCapacity"', 'name="childCapacity"', 'name="maxOccupancy"']) {
      assert.ok(!source.includes(invented), `${invented} is not a field this model has`);
    }
  });
});
