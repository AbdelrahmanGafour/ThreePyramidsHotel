import type { PublicPackageImage } from "@/features/packages/api/contracts";
import { getPackageMedia } from "@/features/packages/data/packageMedia";

// Which picture a journey shows, decided once.
//
// Three sources, in a fixed order of authority:
//
//   1. the image an administrator uploaded, which the API publishes
//   2. the website's own slug-to-file map, for journeys nobody has uploaded
//      a picture for yet
//   3. the neutral placeholder, for journeys that map has never heard of
//
// The uploaded image wins outright. That is the whole point of the
// precedence: once somebody has chosen a photograph for a journey through
// the Admin, a file checked into this repository two releases ago must not
// go on being shown instead — and must not leak into the uploaded image's
// presentation either, which is why an API image takes none of the legacy
// entry's crop.
//
// The legacy map is a fallback and nothing else now. It is still here, still
// intact, and still serves the journeys that have no uploaded media; it is
// not consulted at all for the ones that do.
//
// Nothing in this module fetches, and nothing composes a URL. The API sends
// a finished absolute URL and it is passed through untouched: no media base
// is read here, no bucket or object key is known here, and `next/image`
// loads it exactly as it loads any other configured remote image.

/**
 * The neutral crop.
 *
 * An uploaded image has no curated framing — nobody chose a focal point for
 * it, and the legacy entry's was chosen for a different photograph, so
 * borrowing it would crop the new picture by the old one's composition.
 * Centre is the honest default, and it is the same one the placeholder
 * already uses.
 */
const NEUTRAL_POSITION = "50% 50%";

/** Where the picture on screen came from. */
export type PackageImageSource = "api" | "legacy" | "placeholder";

/**
 * Everything the three journey image frames need, and nothing else.
 *
 * `alt` is always a string, because `next/image` requires one; see
 * `resolvePackageImage` for how a null description becomes the empty string
 * that means "decorative".
 *
 * `width` and `height` are the uploaded object's real dimensions, or `null`
 * for the local files, whose dimensions this app has never tracked. They are
 * carried so a caller that can use them has them; the current frames are
 * fixed-aspect `fill` containers, which already reserve their space and
 * cannot accept intrinsic dimensions.
 */
export type ResolvedPackageImage = {
  src: string;
  alt: string;
  position: string;
  width: number | null;
  height: number | null;
  source: PackageImageSource;
};

/**
 * The precedence, in one place.
 *
 * Takes the least it can — a slug and the API's image — so a card, a detail
 * and a related-journey thumbnail all reach the same answer, and so no
 * component has to repeat `api ?? legacy ?? placeholder` and get it subtly
 * different.
 */
export function resolvePackageImage(pkg: {
  slug: string;
  image: PublicPackageImage | null;
}): ResolvedPackageImage {
  if (pkg.image) {
    return {
      // Used exactly as the API composed it.
      src: pkg.image.url,
      // A null description is the schema's deliberate "decorative" case, and
      // the empty string is what it means. It is the same fallback the local
      // placeholder and the public room images already use; nothing is
      // invented, and nothing is written back.
      alt: pkg.image.altText ?? "",
      position: NEUTRAL_POSITION,
      width: pkg.image.width,
      height: pkg.image.height,
      source: "api",
    };
  }

  // No uploaded image: the website's own behaviour, unchanged. `isFallback`
  // is how the legacy module already distinguishes a mapped slug from one it
  // does not know, so both cases keep exactly the file, description and crop
  // they had before this slice.
  const media = getPackageMedia(pkg.slug);

  return {
    src: media.image,
    alt: media.imageAlt,
    position: media.position,
    width: null,
    height: null,
    source: media.isFallback ? "placeholder" : "legacy",
  };
}
