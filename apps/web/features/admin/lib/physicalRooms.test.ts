import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PHYSICAL_ROOM_RENAME_HINT, roomNumberDomKey } from "./physicalRooms.js";

// Two kinds of check.
//
// The helper and the hint are pure values and are tested directly.
//
// The rest are static source assertions against the panel. Importing that
// component pulls in Server Actions, which need Next's request context, and
// rendering it would need a framework this repository deliberately does not
// have — so the properties that matter (what is bound, what is submitted, that
// nothing is hidden) are read out of the source instead. They are grep-strength
// rather than render-strength, and H5 proves the wiring in a browser.

const PANEL = readFileSync(
  new URL("../components/AdminPhysicalRoomsPanel.tsx", import.meta.url),
  "utf8",
);

describe("roomNumberDomKey", () => {
  it("removes ASCII whitespace from a room number that legitimately has it", () => {
    // `Suite 4` is a valid room number; `room-rename-Suite 4` is not a valid
    // id, and a label would not reliably associate with its input.
    const key = roomNumberDomKey("Suite 4");

    assert.equal(key, "Suite%204");
    assert.doesNotMatch(key, /\s/, "an id may contain no ASCII whitespace");
  });

  it("produces no whitespace for any room number the API accepts", () => {
    for (const roomNumber of [
      "D-101",
      "Suite 4",
      "annexe 2b",
      "  padded  ",
      "a b",
      "Ph-Suite",
      "1 2 3",
    ]) {
      assert.doesNotMatch(roomNumberDomKey(roomNumber), /\s/, JSON.stringify(roomNumber));
    }
  });

  it("preserves case, so two rooms differing only by case get different ids", () => {
    assert.equal(roomNumberDomKey("D-101"), "D-101");
    assert.equal(roomNumberDomKey("d-101"), "d-101");
    assert.notEqual(roomNumberDomKey("D-101"), roomNumberDomKey("d-101"));
  });

  it("is injective, so distinct room numbers never collide on one id", () => {
    const numbers = ["D-101", "d-101", "Suite 4", "Suite  4", "Suite-4", "Suite%204", "PH 1", "PH1"];
    const keys = numbers.map(roomNumberDomKey);

    assert.equal(new Set(keys).size, numbers.length, "every id must be unique");
  });

  it("changes nothing else about the value", () => {
    // Not trimmed, not re-cased — it only escapes.
    assert.equal(decodeURIComponent(roomNumberDomKey("  D-101  ")), "  D-101  ");
    assert.equal(decodeURIComponent(roomNumberDomKey("Suite 4")), "Suite 4");
  });
});

describe("the rename hint", () => {
  it("says the number shown for existing reservations does change", () => {
    // A reservation's room number is read live from the room it is allocated
    // to, so this is the half that is easy to get wrong.
    assert.match(PHYSICAL_ROOM_RENAME_HINT, /shown for reservations/i);
  });

  it("says what renaming does not do", () => {
    assert.match(PHYSICAL_ROOM_RENAME_HINT, /does not move those reservations/i);
    assert.match(PHYSICAL_ROOM_RENAME_HINT, /dates/i);
    assert.match(PHYSICAL_ROOM_RENAME_HINT, /guests/i);
    assert.match(PHYSICAL_ROOM_RENAME_HINT, /booked price/i);
  });

  it("never makes the blanket claim that bookings are unaffected", () => {
    for (const forbidden of [
      /bookings? (are|is) unaffected/i,
      /reservations? (are|is) unaffected/i,
      /nothing else changes/i,
      /no effect on (the )?bookings?/i,
    ]) {
      assert.doesNotMatch(PHYSICAL_ROOM_RENAME_HINT, forbidden, String(forbidden));
    }
  });

  it("mentions no internal identifier or database concept", () => {
    assert.doesNotMatch(PHYSICAL_ROOM_RENAME_HINT, /\bid\b|join|foreign key|column|row\b/i);
  });
});

describe("the rooms panel keeps room identity exact (static source checks)", () => {
  it("escapes the room number for the element id only", () => {
    assert.match(PANEL, /const fieldId = `room-rename-\$\{roomNumberDomKey\(room\.roomNumber\)\}`/);
  });

  it("defaults the rename input to the exact original room number", () => {
    assert.match(PANEL, /defaultValue=\{room\.roomNumber\}/);
    assert.doesNotMatch(PANEL, /defaultValue=\{roomNumberDomKey/);
    assert.doesNotMatch(PANEL, /defaultValue=\{room\.roomNumber\.(trim|toLowerCase|toUpperCase)/);
  });

  it("binds the exact original room number to both room actions", () => {
    assert.match(PANEL, /renameAdminPhysicalRoomAction\.bind\(null, roomTypeSlug, room\.roomNumber\)/);
    assert.match(PANEL, /setAdminPhysicalRoomActiveAction\.bind\(\s*null,\s*roomTypeSlug,\s*room\.roomNumber,/);
    assert.doesNotMatch(PANEL, /\.bind\([^)]*roomNumberDomKey/, "an escaped key must never identify a room");
  });

  it("displays the exact original room number", () => {
    assert.match(PANEL, /<span className="adm-strong">\{room\.roomNumber\}<\/span>/);
  });

  it("never re-cases or trims a room number anywhere", () => {
    assert.doesNotMatch(PANEL, /roomNumber\.(trim|toLowerCase|toUpperCase)\(\)/);
  });

  it("introduces no hidden identifier", () => {
    assert.doesNotMatch(PANEL, /type="hidden"/);
    // The only submitted field name in the whole panel.
    assert.deepEqual([...PANEL.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]), [
      "roomNumber",
      "roomNumber",
    ]);
  });

  it("uses the shared hint rather than an inline claim", () => {
    assert.match(PANEL, /hint=\{PHYSICAL_ROOM_RENAME_HINT\}/);
    assert.doesNotMatch(PANEL, /bookings themselves are unaffected/i);
  });
});
