import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Inspected rather than rendered.
//
// Every panel on this screen either binds a Server Action — which imports
// `next/headers` and loads only under the react-server condition — or holds
// the shared submit button, a Client Component that cannot load under it.
// Nothing here can be rendered in either test group, so what this file can
// still prove is the structure: that the room type page uses the shared
// detail-page pieces, and that the management information it showed before
// the visual refactor is all still on it.

const page = readFileSync("app/(dashboard)/admin/room-types/[slug]/page.tsx", "utf8");
const form = readFileSync("features/admin/components/AdminRoomTypeForm.tsx", "utf8");
const capacity = readFileSync("features/admin/components/AdminRoomTypeCapacityPanel.tsx", "utf8");
const rooms = readFileSync("features/admin/components/AdminPhysicalRoomsPanel.tsx", "utf8");
const images = readFileSync("features/admin/components/AdminRoomTypeImagesPanel.tsx", "utf8");

const panels = { form, capacity, rooms, images };

describe("admin room type detail: the shared detail-page shape", () => {
  it("stacks the page in a DetailPage, not in the form grid", () => {
    assert.match(page, /<DetailPage>/);
    assert.ok(!page.includes('className="adm-detail-grid"'), "that grid belongs to the form screens");
  });

  it("opens with the shared masthead", () => {
    assert.match(page, /<DetailMasthead\b/);
    assert.match(page, /title=\{data\.name\}/);
    assert.match(page, /\{data\.slug\}/);
  });

  it("carries the status, the capacity and the rate as masthead badges", () => {
    const masthead = page.slice(page.indexOf("<DetailMasthead"), page.indexOf("<AdminRoomTypeForm"));

    assert.match(masthead, /roomTypeStatus\[data\.isActive \? "active" : "inactive"\]/);
    assert.match(masthead, /Sleeps \{data\.capacity\}/);
    assert.match(masthead, /formatEgp\(data\.baseNightlyRate\)/);
  });

  it("leaves the page header with no heading of its own", () => {
    // The masthead carries the <h1>; two would be one too many.
    assert.match(page, /\{title \? <h1 className="adm-page-title">\{title\}<\/h1> : null\}/);
    assert.match(page, /<PageHeader \/>/, "the loaded state passes no title");
    assert.match(page, /<PageHeader title="Room type" \/>/, "the unavailable state still has one");
  });

  it("builds every panel from the shared section, not from a bare panel", () => {
    for (const [name, source] of Object.entries(panels)) {
      assert.match(source, /<DetailSection\b/, `${name} uses the shared section`);
      assert.ok(
        !source.includes('<section className="adm-panel"'),
        `${name} no longer hand-rolls a panel`,
      );
      assert.ok(!source.includes("PanelHeader"), `${name} no longer uses the list-page heading`);
    }
  });

  it("keeps every panel's heading and explanation", () => {
    for (const [title, source] of [
      ["Fixed details", form],
      ["Edit room type", form],
      ["Capacity", capacity],
      ["Physical rooms", rooms],
      ["Images", images],
    ] as const) {
      assert.ok(source.includes(`title="${title}"`), `${title} is still a section`);
    }
  });

  it("states an empty or unreadable section in the panel body", () => {
    for (const [name, source] of [
      ["rooms", rooms],
      ["images", images],
    ] as const) {
      assert.match(source, /<DetailEmpty>/, `${name} says so rather than going blank`);
    }
  });
});

describe("admin room type detail: the information still shown", () => {
  it("presents the fixed details as a metadata table", () => {
    assert.match(form, /<DetailFacts\b/);
    assert.ok(!form.includes('className="adm-facts"'), "the old fact list is gone");
  });

  it("keeps every fixed detail, including the stored rate", () => {
    const fixed = form.slice(form.indexOf('id="room-type-fixed"'), form.indexOf('id="room-type-edit"'));

    for (const label of [
      "Reference",
      "Status",
      "Physical rooms assigned",
      "Stored base nightly rate",
      "Created",
      "Last changed",
    ]) {
      assert.ok(fixed.includes(`label: "${label}"`), `${label} is still shown`);
    }
  });

  it("still keeps capacity out of the fixed details, where it has its own panel", () => {
    const fixed = form.slice(form.indexOf('id="room-type-fixed"'), form.indexOf('id="room-type-edit"'));

    assert.ok(!fixed.includes('label: "Capacity"'), "one authoritative place for it");
    assert.ok(!fixed.includes('label: "Sleeps"'));
    assert.match(capacity, /id="room-type-capacity"/);
  });

  it("keeps every editable field of the room type form", () => {
    for (const field of [
      "name",
      "baseNightlyRate",
      "shortDescription",
      "description",
      "bedType",
      "bedCount",
      "sizeSqm",
      "view",
      "sortOrder",
    ]) {
      assert.ok(form.includes(`name="${field}"`), `${field} is still editable`);
    }
  });

  it("keeps the unpublished state as its own section, said in full", () => {
    assert.match(form, /id="room-type-unpublished"/);
    assert.match(form, /hidden from the website, from availability searches and from new bookings/);
    assert.match(form, /roomType\.isActive \? null :/, "shown only when it applies");
  });

  it("no longer claims that publishing cannot be done here", () => {
    // It can now, from the Availability panel. The old copy said otherwise.
    assert.ok(!form.includes("not something this page can do yet"));
    assert.match(form, /Availability further down publishes it/);
  });

  it("keeps the inventory and gallery operations", () => {
    assert.match(rooms, /addAdminPhysicalRoomAction/);
    assert.match(rooms, /Add room/);
    assert.match(images, /uploadAdminRoomTypeImageAction/);
    assert.match(images, /Upload image/);
  });

  it("keeps the two reads independent, so one failure is not the other's", () => {
    // A failed inventory read is not an empty room type, and a failed image
    // read is not an empty gallery. Both are still passed as null.
    assert.match(page, /roomsResult\.state === "ok" \? roomsResult\.data : null/);
    assert.match(page, /imagesResult\.state === "ok" \? imagesResult\.data : null/);
  });

  it("keeps one row per room and per image, with their own forms", () => {
    // Not converted to the desktop-table/mobile-list pair: that renders both
    // markups at every width, which would mean two copies of every form and
    // two elements sharing each id.
    assert.match(rooms, /<ul className="adm-rooms">/);
    assert.match(images, /<ul className="adm-images">/);
    assert.ok(!rooms.includes('className="adm-list"'), "no duplicated form ids");
    assert.ok(!images.includes('className="adm-list"'));
  });
});
