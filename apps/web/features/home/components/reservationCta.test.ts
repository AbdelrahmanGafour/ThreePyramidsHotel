import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The "Reserve your stay" CTA in the Reservation Desk, at both breakpoints.
//
// Its resting colour is ivory and brass is the hover/focus reward. That pair
// was the other way round, and an inversion like this is invisible to a type
// checker and easy to undo, so it is asserted here rather than left to a
// screenshot.
//
// Read, not rendered: `BookingStrip` is a motion client component, and the
// colours live in `globals.css` anyway, which no render would evaluate.

// Normalised, because the working copy is CRLF while the committed blob is LF
// (`core.autocrlf=true`, no `.gitattributes`) and one selector below spans two
// lines. Matching on either would make this pass or fail by checkout.
const css = readFileSync("app/globals.css", "utf8").replace(/\r\n/g, "\n");
const strip = readFileSync("features/home/components/BookingStrip.tsx", "utf8");

/** One CSS rule's declaration block, by exact selector text. */
const block = (selector: string): string => {
  const at = css.indexOf(selector);

  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

const resting = block(".reservation-action {");
const active = block(".reservation-action:hover,\n.reservation-action:focus-visible {");

describe("the Reserve your stay CTA colour", () => {
  it("rests in ivory", () => {
    assert.ok(resting.length > 0, "the .reservation-action rule was found");
    assert.match(resting, /color:\s*var\(--ivory\)/);
    assert.equal(/color:\s*var\(--brass\)/.test(resting), false, "brass is not the resting colour");
  });

  it("turns brass on hover and on keyboard focus alike", () => {
    assert.ok(active.length > 0, "the hover/focus rule was found");
    // :focus-visible shares the selector list, so a keyboard user gets exactly
    // the same affordance a pointer user does.
    assert.match(active, /color:\s*var\(--brass\)/);
    assert.equal(/color:\s*var\(--ivory\)/.test(active), false);
  });

  it("keeps the underline following the text colour", () => {
    // `currentColor` is what makes the rule above enough: the hairline turns
    // brass with the label instead of needing its own pair of declarations.
    assert.match(block(".reservation-action::after {"), /background:\s*currentColor/);
  });

  it("does not fight its own utility class at either breakpoint", () => {
    // Both call sites carry `text-ivory`, so the resting colour is the same
    // whichever of the two rules the cascade resolves to.
    const classLists = [...strip.matchAll(/className="(reservation-action[^"]*)"/g)].map(
      (match) => match[1],
    );

    assert.equal(classLists.length, 2, "the desktop and mobile Reservation Desk CTAs");

    for (const classList of classLists) {
      assert.ok(classList.includes("text-ivory"), `expected text-ivory in: ${classList}`);
      assert.equal(/\btext-brass\b/.test(classList), false, `stale brass utility in: ${classList}`);
      assert.ok(classList.includes("min-h-11"), "and the touch target is unchanged");
    }
  });

  it("leaves the other two reserve buttons alone", () => {
    // `FinalReservation` sits on a light section where ivory would vanish, and
    // the header's is a filled plate. Neither uses `.reservation-action`.
    for (const file of ["features/home/components/FinalReservation.tsx", "shared/components/layout/Header.tsx"]) {
      assert.equal(
        readFileSync(file, "utf8").includes("reservation-action"),
        false,
        `${file} must not have been swept into this change`,
      );
    }
  });
});
