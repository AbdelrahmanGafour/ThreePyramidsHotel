import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPackageMedia } from "./packageMedia";

describe("package presentation media", () => {
  it("returns local media for a known presentation slug", () => {
    const media = getPackageMedia("dawn-plateau-and-the-museum");
    assert.equal(media.isFallback, false);
    assert.match(media.image, /^\/images\//);
  });

  it("returns a safe neutral fallback for an unknown backend slug", () => {
    const media = getPackageMedia("brand-new-backend-package");
    assert.equal(media.isFallback, true);
    assert.equal(media.imageAlt, "");
    assert.match(media.image, /^\/images\//);
  });
});
