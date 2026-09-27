import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { roomTypeStatusAction, roomTypeStatusNote } from "../lib/roomTypes";
import { roomTypeStatus } from "../lib/status";

// Publishing and unpublishing one room type, from the detail page.
//
// Two halves, for the reason every admin write screen splits this way. The
// decision — which control to offer, what it says, what it targets — is pure
// and is exercised directly. The panel itself binds a Server Action, which
// imports `next/headers` and loads only under the react-server condition,
// while the submit button inside it is a Client Component that cannot; so the
// wiring is inspected rather than rendered, exactly as
// AdminRoomTypeDetail.render.test.tsx does for the panels beside it.

const panel = readFileSync("features/admin/components/AdminRoomTypeStatusPanel.tsx", "utf8");
const page = readFileSync("app/(dashboard)/admin/room-types/[slug]/page.tsx", "utf8");
const form = readFileSync("features/admin/components/AdminRoomTypeForm.tsx", "utf8");
const action = readFileSync("features/admin/server/adminRoomTypeActions.ts", "utf8");

/** Comments explain what these files deliberately do NOT do, so scans skip them. */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the status a room type is shown in", () => {
  it("calls a published room type Published", () => {
    assert.equal(roomTypeStatus.active.label, "Published");
  });

  it("calls an unpublished one Unpublished, whether or not it ever went live", () => {
    // One boolean, one word for the false side. A draft-versus-archived split
    // in the labels would describe a state the database cannot hold.
    assert.equal(roomTypeStatus.inactive.label, "Unpublished");
    assert.deepEqual(Object.keys(roomTypeStatus).sort(), ["active", "inactive"]);
  });

  it("distinguishes the two by shape as well as colour", () => {
    assert.notEqual(roomTypeStatus.active.shape, roomTypeStatus.inactive.shape);
  });
});

describe("which control is offered", () => {
  it("offers Publish for an unpublished room type, targeting true", () => {
    const action = roomTypeStatusAction(false);

    assert.equal(action.target, true);
    assert.equal(action.label, "Publish room type");
    assert.equal(action.pendingLabel, "Publishing…");
    assert.equal(action.tone, "confirm");
  });

  it("offers Unpublish for a published one, targeting false", () => {
    const action = roomTypeStatusAction(true);

    assert.equal(action.target, false);
    assert.equal(action.label, "Unpublish room type");
    assert.equal(action.pendingLabel, "Unpublishing…");
    assert.equal(action.tone, "cancel");
  });

  it("always targets the opposite of where the room type stands", () => {
    // Never a no-op button: offering both would ask an administrator to work
    // out which one does nothing.
    for (const isActive of [true, false]) {
      assert.equal(roomTypeStatusAction(isActive).target, !isActive);
    }
  });

  it("says what publishing needs, and promises nothing about being refused", () => {
    const unpublished = roomTypeStatusNote(false);

    assert.match(unpublished, /hidden from the website/);
    assert.match(unpublished, /at least one of its physical rooms to be in service/);
  });

  it("says unpublishing leaves existing reservations alone, and never warns it is impossible", () => {
    const published = roomTypeStatusNote(true);

    assert.match(published, /reservations already taken for it are unaffected/i);
    for (const forbidden of [/cannot be unpublished/i, /must be cancelled/i, /blocked/i]) {
      assert.doesNotMatch(published, forbidden, "unpublishing is always allowed");
    }
  });
});

describe("the panel's wiring", () => {
  it("binds the slug and the direction on the server", () => {
    assert.match(
      panel,
      /updateAdminRoomTypeStatusAction\.bind\(null, slug, action\.target\)/,
      "neither should be submittable from the browser",
    );
  });

  it("posts a form with no fields at all", () => {
    assert.ok(!/name=/.test(panel), "nothing for a crafted submission to substitute");
    assert.ok(!/type="hidden"/.test(panel));
    assert.ok(!/<input/.test(panel));
  });

  it("renders exactly one button, from the tested helper", () => {
    assert.equal((panel.match(/<AdminActionButton/g) ?? []).length, 1);
    assert.match(panel, /roomTypeStatusAction\(isActive\)/);
    assert.match(panel, /\{action\.label\}/);
    assert.match(panel, /pendingLabel=\{action\.pendingLabel\}/);
    assert.match(panel, /tone=\{action\.tone\}/);
  });

  it("disables itself while its own submission is in flight", () => {
    // The shared island does this; the panel opts into it by using it rather
    // than a bare <button>.
    const button = readFileSync("features/admin/components/AdminActionButton.tsx", "utf8");

    assert.match(panel, /import \{ AdminActionButton \}/);
    assert.ok(!/<button/.test(panel), "no unmanaged submit");
    assert.match(button, /disabled=\{pending\}/);
    assert.match(button, /aria-busy=\{pending\}/);
  });

  it("uses the shared detail section, with the wording from the tested helper", () => {
    assert.match(panel, /<DetailSection/);
    assert.match(panel, /id="room-type-status"/);
    assert.match(panel, /note=\{roomTypeStatusNote\(isActive\)\}/);
  });

  it("stays a server component and calls no API from the browser", () => {
    const code = codeOnly(panel);

    for (const forbidden of ['"use client"', "fetch(", "useState", "useEffect", "/api/", "XMLHttpRequest"]) {
      assert.ok(!code.includes(forbidden), `${forbidden} must not appear in this panel`);
    }
  });

  it("changes nothing but the status", () => {
    for (const forbidden of [
      /updateRoomTypeAction/,
      /updateAdminRoomTypeCapacityAction/,
      /setAdminPhysicalRoomActiveAction/,
      /reservation/i,
    ]) {
      assert.ok(!forbidden.test(panel), `${forbidden} has no place in this control`);
    }
  });
});

describe("where the panel sits", () => {
  it("is rendered on the room type detail page, from the read data", () => {
    assert.match(page, /<AdminRoomTypeStatusPanel slug=\{data\.slug\} isActive=\{data\.isActive\} \/>/);
  });

  it("comes before the rooms panel, which is where a refusal is fixed", () => {
    const statusAt = page.indexOf("<AdminRoomTypeStatusPanel");
    const roomsAt = page.indexOf("<AdminPhysicalRoomsPanel");

    assert.ok(statusAt > 0 && statusAt < roomsAt);
  });

  it("leaves every other panel on the page", () => {
    for (const existing of [
      "<AdminRoomTypeForm roomType={data} />",
      "<AdminRoomTypeCapacityPanel slug={data.slug} capacity={data.capacity} />",
      "<AdminPhysicalRoomsPanel",
      "<AdminRoomTypeImagesPanel",
    ]) {
      assert.ok(page.includes(existing), `${existing} must remain`);
    }
  });

  it("replaced the copy that said reactivation was impossible here", () => {
    assert.ok(!form.includes("not something this page can do yet"));
    assert.ok(!form.includes("bringing a room type back"));
    assert.match(form, /id="room-type-unpublished"/);
  });
});

describe("the action", () => {
  /** This action's own body, never a sibling's. */
  const statusAction = action.slice(action.indexOf("export async function updateAdminRoomTypeStatusAction"));

  it("refuses a non-boolean direction without asking the API", () => {
    // There is no direction to apply, and guessing one would publish or
    // withdraw a room type nobody asked to change.
    assert.match(statusAction, /typeof isActive !== "boolean"/);
    assert.ok(
      statusAction.indexOf('typeof isActive !== "boolean"') <
        statusAction.indexOf("updateAdminRoomTypeStatus(slug, isActive, cookie)"),
      "checked before the request",
    );
    assert.match(statusAction, /action=status-refused/);
  });

  it("forwards the caller's own cookie and nothing else", () => {
    assert.match(statusAction, /\(await headers\(\)\)\.get\("cookie"\)/);
    assert.match(statusAction, /updateAdminRoomTypeStatus\(slug, isActive, cookie\)/);
  });

  it("hands the outcome to the shared planner, with the direction", () => {
    // No second copy of the classification: the plan decides the notice and
    // what to re-read, and is tested directly in lib/inventoryOutcomes.test.ts.
    assert.match(statusAction, /completeOutcome\(planRoomTypeStatus\(result\.state, isActive\), slug\)/);
  });

  it("never retries and renders nothing from the response", () => {
    assert.equal((statusAction.match(/updateAdminRoomTypeStatus\(/g) ?? []).length, 1);
    assert.ok(!/result\.data/.test(statusAction), "the page re-reads instead");
  });
});
