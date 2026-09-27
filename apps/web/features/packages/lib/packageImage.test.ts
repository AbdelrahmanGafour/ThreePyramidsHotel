import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { PublicPackageImage } from "@/features/packages/api/contracts";
import { getPackageMedia } from "@/features/packages/data/packageMedia";
import { resolvePackageImage } from "./packageImage";

// Which picture a journey shows, and in what order of authority.
//
// The uploaded image wins; the website's own slug map serves only the
// journeys that have none; the placeholder serves the slugs that map has
// never heard of. Everything below is about proving that order holds and
// that the legacy entry cannot leak into an uploaded image's presentation.

/** A slug the legacy map has a curated file, description and crop for. */
const MAPPED = "dawn-plateau-and-the-museum";

/** A slug it has never heard of — a journey created in the Admin. */
const UNMAPPED = "brand-new-backend-journey";

const uploaded: PublicPackageImage = {
  url: "https://media.example.com/media/3f1c/9a2b4c6d8e0f1234.webp",
  altText: "Dawn light along the causeway",
  width: 2048,
  height: 1365,
};

describe("journey image precedence", () => {
  it("prefers the uploaded image over a legacy slug mapping", () => {
    const legacy = getPackageMedia(MAPPED);
    const resolved = resolvePackageImage({ slug: MAPPED, image: uploaded });

    assert.equal(resolved.source, "api");
    assert.equal(resolved.src, uploaded.url);
    assert.notEqual(resolved.src, legacy.image);
    assert.ok(!resolved.src.startsWith("/images/"), "no checked-in file is shown");
  });

  it("prefers the uploaded image over the placeholder", () => {
    const resolved = resolvePackageImage({ slug: UNMAPPED, image: uploaded });

    assert.equal(resolved.source, "api");
    assert.equal(resolved.src, uploaded.url);
    assert.ok(!resolved.src.includes("placeholders"), "the placeholder is not shown");
  });

  it("uses the API URL exactly as it arrived", () => {
    // Composed by the API from its own media configuration. Nothing here
    // rewrites it, appends to it, or rebuilds it from a base.
    for (const url of [
      "https://media.example.com/media/3f1c/9a2b4c6d8e0f1234.webp",
      "https://cdn.example.org/media/aa/bb.webp?v=2",
      "http://localhost:8787/media/aa/bb.webp",
    ]) {
      assert.equal(resolvePackageImage({ slug: MAPPED, image: { ...uploaded, url } }).src, url);
    }
  });

  it("carries the API's own width and height through unchanged", () => {
    const resolved = resolvePackageImage({ slug: MAPPED, image: uploaded });

    assert.deepEqual(
      { width: resolved.width, height: resolved.height },
      { width: uploaded.width, height: uploaded.height },
      "the real aspect ratio survives, for any caller that can reserve space by it",
    );
  });

  it("reports no dimensions for the local files, which have never had any", () => {
    // Null rather than a guess: the legacy map records a path, a description
    // and a crop, and has never known how big the file is.
    for (const slug of [MAPPED, UNMAPPED]) {
      const resolved = resolvePackageImage({ slug, image: null });

      assert.equal(resolved.width, null);
      assert.equal(resolved.height, null);
    }
  });

  it("gives an uploaded image the neutral crop, never the legacy one", () => {
    // The mapped slug's crop was chosen for a different photograph. Applying
    // it to a new one would let the legacy map override half the uploaded
    // image's presentation.
    const legacy = getPackageMedia(MAPPED);
    const resolved = resolvePackageImage({ slug: MAPPED, image: uploaded });

    assert.equal(legacy.position, "29% 50%", "the legacy entry does have its own crop");
    assert.equal(resolved.position, "50% 50%");
  });
});

describe("journey image alt text", () => {
  it("uses the administrator's description when there is one", () => {
    assert.equal(
      resolvePackageImage({ slug: MAPPED, image: uploaded }).alt,
      "Dawn light along the causeway",
    );
  });

  it("falls back to the site's decorative empty string when there is none", () => {
    // The same convention the placeholder and the public room images use: a
    // null description means decorative, and the empty string is what that
    // means to a screen reader. Nothing is invented from the title.
    const resolved = resolvePackageImage({ slug: MAPPED, image: { ...uploaded, altText: null } });

    assert.equal(resolved.alt, "");
    assert.equal(typeof resolved.alt, "string", "next/image needs a string");
  });

  it("never borrows the legacy description for an uploaded image", () => {
    const legacy = getPackageMedia(MAPPED);
    const resolved = resolvePackageImage({ slug: MAPPED, image: { ...uploaded, altText: null } });

    assert.equal(legacy.imageAlt, "Warm dawn light over the Giza plateau");
    assert.notEqual(resolved.alt, legacy.imageAlt, "it describes a photograph nobody is showing");
  });

  it("keeps alt a string in every case", () => {
    for (const image of [uploaded, { ...uploaded, altText: null }, null]) {
      for (const slug of [MAPPED, UNMAPPED]) {
        assert.equal(typeof resolvePackageImage({ slug, image }).alt, "string");
      }
    }
  });
});

describe("journey image fallback, for journeys with no upload", () => {
  it("uses the legacy map for a slug it knows, exactly as before", () => {
    const legacy = getPackageMedia(MAPPED);
    const resolved = resolvePackageImage({ slug: MAPPED, image: null });

    assert.equal(resolved.source, "legacy");
    assert.equal(resolved.src, legacy.image);
    assert.equal(resolved.alt, legacy.imageAlt);
    assert.equal(resolved.position, legacy.position);
  });

  it("uses the placeholder for a slug it does not know, exactly as before", () => {
    const placeholder = getPackageMedia(UNMAPPED);
    const resolved = resolvePackageImage({ slug: UNMAPPED, image: null });

    assert.equal(resolved.source, "placeholder");
    assert.equal(resolved.src, placeholder.image);
    assert.equal(resolved.src, "/images/placeholders/material-detail.webp");
    assert.equal(resolved.alt, "");
    assert.equal(resolved.position, "50% 50%");
  });

  it("agrees with the legacy module for every slug it maps", () => {
    // The whole map, so a later entry cannot quietly diverge.
    for (const slug of [MAPPED, "into-the-desert-stillness", "rooftop-evenings-after-dark"]) {
      const legacy = getPackageMedia(slug);
      const resolved = resolvePackageImage({ slug, image: null });

      assert.equal(legacy.isFallback, false, `${slug} should be mapped`);
      assert.deepEqual(
        { src: resolved.src, alt: resolved.alt, position: resolved.position },
        { src: legacy.image, alt: legacy.imageAlt, position: legacy.position },
      );
    }
  });
});

describe("what the resolver is not", () => {
  const source = readFileSync("features/packages/lib/packageImage.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("composes no URL and reads no media configuration", () => {
    for (const forbidden of [
      "MEDIA_PUBLIC_BASE_URL",
      "mediaPublicBaseUrl",
      "composePublicMediaUrl",
      "process.env",
      "new URL",
      "`${",
      "/media/",
    ]) {
      assert.ok(!code.includes(forbidden), `${forbidden} would mean building an address here`);
    }
  });

  it("requests nothing", () => {
    for (const forbidden of ["fetch(", "XMLHttpRequest", "axios", "await ", "async "]) {
      assert.ok(!code.includes(forbidden), `${forbidden} has no place in a pure resolver`);
    }
  });

  it("knows nothing about a bucket or an object", () => {
    for (const leaked of [
      "reference",
      "storageKey",
      "storage_key",
      "bucket",
      "checksum",
      "contentType",
      "content_type",
      "byteSize",
      "mediaAssetId",
      "media_asset",
      "r2",
      "cloudflare",
      "amazonaws",
      "S3",
    ]) {
      assert.ok(!code.includes(leaked), `${leaked} must never reach the public website`);
    }
  });
});
