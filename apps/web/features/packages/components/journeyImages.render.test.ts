import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The three places a journey's picture appears on the public website.
//
// These are server components rendering `next/image`, which needs Next's own
// runtime and image configuration to render at all — so what is asserted
// here is the wiring, and the behaviour it delegates to is proved directly
// in `lib/packageImage.test.ts`. The point of every assertion below is the
// same: each frame asks the one resolver and renders its answer, so the
// precedence cannot drift apart between the catalogue and the detail page.

const read = (name: string) => readFileSync(`features/packages/components/${name}.tsx`, "utf8");

/** Comments explain what these files deliberately do NOT do, so scans skip them. */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const card = read("JourneyRow");
const detail = read("PackageDetailOpening");
const related = read("RelatedJourneyRow");
const resolver = readFileSync("features/packages/lib/packageImage.ts", "utf8");

/** Every public component that renders a journey image. */
const FRAMES = [
  ["catalogue card", card],
  ["journey detail", detail],
  ["related journey", related],
] as const;

describe("every journey image frame uses the shared resolver", () => {
  it("asks resolvePackageImage, in all three places", () => {
    for (const [name, source] of FRAMES) {
      assert.match(
        source,
        /import \{ resolvePackageImage \} from "@\/features\/packages\/lib\/packageImage";/,
        `${name} should import the resolver`,
      );
      assert.match(source, /resolvePackageImage\(pkg\)/, `${name} should call it`);
    }
  });

  it("renders the source it is handed, rather than choosing one", () => {
    for (const [name, source] of FRAMES) {
      assert.match(source, /<Image src=\{media\.src\}/, `${name} should render the resolved src`);
    }
  });

  it("keeps the crop the resolver decided", () => {
    for (const [name, source] of FRAMES) {
      assert.match(
        source,
        /style=\{\{ objectPosition: media\.position \}\}/,
        `${name} should use the resolved crop`,
      );
    }
  });

  it("reaches the legacy map through the resolver and never directly", () => {
    // This is what makes the precedence a single decision: a component that
    // still called `getPackageMedia` would show a checked-in file for a
    // journey whose picture an administrator has already uploaded.
    for (const [name, source] of FRAMES) {
      assert.ok(!source.includes("getPackageMedia"), `${name} must not read the map itself`);
      assert.ok(!source.includes("packageMedia"), `${name} must not import the map`);
    }
  });

  it("writes the precedence down exactly once", () => {
    // Not "??" chains in three components: one module decides, and it is the
    // only one that knows the placeholder exists.
    assert.equal((resolver.match(/export function resolvePackageImage/g) ?? []).length, 1);

    for (const [name, source] of FRAMES) {
      assert.ok(!source.includes("placeholders/"), `${name} must not name a fallback file`);
      assert.ok(!source.includes("isFallback"), `${name} must not branch on the fallback`);
      assert.ok(!/pkg\.image/.test(source), `${name} must not read the API image itself`);
    }
  });
});

describe("what each frame does with the description", () => {
  it("reads the uploaded description on the journey's own page", () => {
    // The one journey image that carries meaning rather than decorating a
    // link, so this is where a screen reader is told what the picture is.
    assert.match(detail, /<Image src=\{media\.src\} alt=\{media\.alt\}/);
  });

  it("keeps the two decorative frames silent, as they already were", () => {
    // Both sit inside `aria-hidden` wrappers beside a link that already names
    // the journey. Giving them the uploaded description would announce the
    // same journey twice; the established convention here is an empty alt,
    // and this slice changes the picture, not the accessibility.
    for (const [name, source] of [["catalogue card", card], ["related journey", related]] as const) {
      assert.match(source, /<Image src=\{media\.src\} alt=""/, `${name} should stay decorative`);
      assert.match(source, /aria-hidden="true"/, `${name} should still hide its frame`);
    }
  });

  it("never invents a description from the journey's own copy", () => {
    for (const [name, source] of FRAMES) {
      const code = codeOnly(source);
      assert.ok(!/alt=\{[^}]*pkg\./.test(code), `${name} must not build an alt from package fields`);
      assert.ok(!/alt=\{[^}]*title/.test(code), `${name} must not use the title as a description`);
    }
  });
});

describe("what the public frames never do", () => {
  it("builds no media URL of its own", () => {
    for (const [name, source] of FRAMES) {
      const code = codeOnly(source);
      for (const forbidden of [
        "MEDIA_PUBLIC_BASE_URL",
        "mediaPublicBaseUrl",
        "process.env",
        "new URL",
        "/media/",
        "r2.cloudflarestorage",
        "cloudflare",
        "amazonaws",
      ]) {
        assert.ok(!code.includes(forbidden), `${forbidden} must not appear in ${name}`);
      }
    }
  });

  it("adds no request and no storage client", () => {
    // `next/image` loading the API's URL is the only traffic. No component
    // here fetches, and none talks to object storage.
    for (const [name, source] of FRAMES) {
      const code = codeOnly(source);
      for (const forbidden of ["fetch(", "XMLHttpRequest", "axios", "S3Client", "useEffect", '"use client"']) {
        assert.ok(!code.includes(forbidden), `${forbidden} must not appear in ${name}`);
      }
    }
  });

  it("shows no internal media field", () => {
    for (const [name, source] of FRAMES) {
      const code = codeOnly(source);
      for (const leaked of ["reference", "storageKey", "checksum", "contentType", "byteSize", "mediaAssetId", "bucket"]) {
        assert.ok(!code.includes(leaked), `${leaked} must not reach ${name}`);
      }
    }
  });

  it("passes no intrinsic size to a fill frame, which cannot take one", () => {
    // Each frame is a fixed-aspect box that already reserves its space, so
    // there is no layout shift to prevent and `next/image` refuses `width`
    // alongside `fill`. The API's dimensions are carried by the resolver for
    // a caller that can use them; these three cannot.
    for (const [name, source] of FRAMES) {
      assert.match(source, /<Image[^>]*\sfill\s/, `${name} should still be a fill frame`);
      assert.ok(!/<Image[^>]*\swidth=/.test(source), `${name} must not combine width with fill`);
      assert.ok(!/<Image[^>]*\sheight=/.test(source), `${name} must not combine height with fill`);
    }
  });
});

describe("everything else about these frames is unchanged", () => {
  it("keeps the catalogue card's layout, links and copy", () => {
    assert.match(card, /className="image-frame group relative block aspect-\[4\/3\] sm:aspect-\[5\/4\]"/);
    assert.match(card, /sizes="\(max-width: 640px\) 92vw, 260px"/);
    assert.match(card, /className="object-cover transition-transform duration-700 group-hover:scale-\[1\.02\]"/);
    assert.match(card, /href=\{`\/packages\/\$\{pkg\.slug\}`\}/);
    assert.match(card, /View journey/);
    assert.match(card, /Request reservation/);
    assert.match(card, /packagePriceSummary\(pkg\)/);
  });

  it("keeps the journey detail's hero frame and priority loading", () => {
    assert.match(detail, /className="image-frame relative aspect-\[4\/3\] lg:aspect-\[16\/10\] lg:max-h-\[540px\]"/);
    assert.match(detail, /fill priority sizes="\(max-width: 1024px\) 92vw, 58vw"/);
    assert.match(detail, /className="object-cover"/);
    assert.match(detail, /Request this journey/);
    assert.match(detail, /No online payment\. Requests start pending confirmation\./);
  });

  it("keeps the related-journey thumbnail exactly as it was", () => {
    assert.match(related, /className="image-frame relative aspect-\[4\/5\] w-16 shrink-0 sm:w-20"/);
    assert.match(related, /sizes="80px"/);
    assert.match(related, /Explore/);
  });
});
