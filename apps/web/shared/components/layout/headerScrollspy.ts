// Which nav item the navbar highlights while the guest scrolls the homepage.
//
// Extracted from `Header.tsx` as a pure function so the rule can be tested
// without an IntersectionObserver, a DOM, or a rendered client component —
// the same arrangement `features/contact/lib/contactApi.ts` uses for the
// decisions its effects delegate to.
//
// The rule used to be "of the sections in this observer callback, take the one
// with the highest `intersectionRatio`". That was unreliable for two reasons,
// and this function exists to make both impossible rather than merely fixed:
//
//   1. `intersectionRatio` is normalised to each target's OWN area, not to the
//      detection band. Against a band ~10% of viewport height, a tall section
//      reports a tiny ratio while a short one reports a large one, so sorting
//      by ratio systematically favours the shorter section — a tall Gallery
//      would lose to a shorter Location sitting in the same band.
//   2. An observer callback carries only the entries whose state CHANGED, so
//      the comparison was made against a partial set and could not see a
//      section that was already in the band.
//
// Ratios are therefore not a parameter here at all, and the caller accumulates
// visibility across callbacks instead of deciding from one batch.

/**
 * The id of the section that should be active, or `null` if none is.
 *
 * `orderedIds` must be in document order; the FIRST visible one wins, which is
 * the conventional scrollspy rule and is stable in both scroll directions.
 *
 * `null` means "no opinion", not "clear the highlight". The caller leaves the
 * previous value in place, which is what keeps the last section highlighted at
 * the footer — where nothing observed is in the band — instead of blinking off.
 */
export function pickActiveSection(
  orderedIds: readonly string[],
  visibleIds: ReadonlySet<string>,
): string | null {
  return orderedIds.find((id) => visibleIds.has(id)) ?? null;
}
