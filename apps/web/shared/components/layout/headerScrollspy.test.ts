import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { pickActiveSection } from "./headerScrollspy";

// The navbar's active-section rule.
//
// The homepage's in-page nav items, in document order. Gallery precedes
// Location, and Gallery is by far the taller section — which is exactly the
// pair the old ratio-based rule got wrong.
const ORDER = ["experiences", "gallery", "location"] as const;

const visible = (...ids: string[]) => new Set(ids);

describe("pickActiveSection", () => {
  it("selects the one visible section", () => {
    assert.equal(pickActiveSection(ORDER, visible("gallery")), "gallery");
    assert.equal(pickActiveSection(ORDER, visible("experiences")), "experiences");
  });

  it("selects Location when only Location is visible", () => {
    assert.equal(pickActiveSection(ORDER, visible("location")), "location");
  });

  it("gives Gallery to the taller section when Gallery and Location are both visible", () => {
    // Document order decides, so the section the guest is scrolling out of the
    // top of the band stays active until it actually leaves it.
    assert.equal(pickActiveSection(ORDER, visible("gallery", "location")), "gallery");
    // Insertion order of the set must not matter.
    assert.equal(pickActiveSection(ORDER, visible("location", "gallery")), "gallery");
  });

  it("returns null when nothing is visible, so the caller keeps its previous value", () => {
    // This is the footer case: past `#location` nothing observed is in the
    // band, and the highlight must not blink off.
    assert.equal(pickActiveSection(ORDER, visible()), null);
  });

  it("returns null before any reading has arrived, so the hero has no active item", () => {
    assert.equal(pickActiveSection(ORDER, new Set()), null);
  });

  it("is decided by document order, not by size or ratio", () => {
    // The function takes no ratio and no dimension, so it cannot depend on
    // either — reversing the order reverses the answer for the same input.
    const ids = visible("gallery", "location");

    assert.equal(pickActiveSection(ORDER, ids), "gallery");
    assert.equal(pickActiveSection(["location", "gallery"], ids), "location");
    assert.equal(pickActiveSection.length, 2, "ordered ids and a visibility set, nothing else");
  });

  it("ignores visible ids it was not given an order for", () => {
    // `#reserve` and `#our-story` are real sections with no nav item; they are
    // never observed, but the rule must not be destabilised if one appears.
    assert.equal(pickActiveSection(ORDER, visible("reserve", "location")), "location");
    assert.equal(pickActiveSection(ORDER, visible("reserve")), null);
  });
});

describe("the Header wires that rule up without polling", () => {
  const source = readFileSync("shared/components/layout/Header.tsx", "utf8");
  // Comments here name the ratio rule this replaced, so scans must skip them.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("no longer sorts by intersectionRatio", () => {
    assert.equal(code.includes("intersectionRatio"), false, "ratios must not reach the decision");
  });

  it("accumulates visibility across callbacks and asks the pure rule", () => {
    assert.match(code, /visibleIds\.add\(entry\.target\.id\)/);
    assert.match(code, /visibleIds\.delete\(entry\.target\.id\)/);
    assert.match(code, /pickActiveSection\(orderedIds, visibleIds\)/);
  });

  it("only sets the anchor when the rule has an opinion", () => {
    // `if (next)` is what retains the previous value at the footer.
    assert.match(code, /if \(next\) setActiveAnchor\(next\)/);
  });

  it("observes with threshold 0 and the unchanged rootMargin", () => {
    assert.match(code, /rootMargin: "-38% 0px -52% 0px", threshold: 0/);
  });

  it("adds no scroll polling for scrollspy", () => {
    // One scroll listener exists for the header's dark-surface threshold and is
    // a separate concern; scrollspy must not add a second, nor any timer.
    assert.equal((code.match(/addEventListener\("scroll"/g) ?? []).length, 1);
    assert.equal(/setInterval|requestAnimationFrame/.test(code), false, "no polling");
  });

  it("keeps the gating, the observed list and the cleanup intact", () => {
    assert.match(code, /if \(!isHome\) return;/);
    assert.match(code, /navItems\.filter\(\(item\) => !PAGE_LINKS\[item\]\)/);
    assert.match(code, /observer\.disconnect\(\)/);
    assert.match(code, /setActiveAnchor\(""\)/, "the teardown reset is unchanged");
  });

  it("keeps the active visual treatment and aria-current", () => {
    assert.equal((code.match(/aria-current=\{/g) ?? []).length, 3, "both desktop groups and mobile");
    assert.ok(code.includes('isActive(item) ? "text-brass!"'), "desktop active colour");
    assert.ok(code.includes('selected ? "text-brass!"'), "mobile active colour");
  });
});
