import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PACKAGE_IMAGE_NOTICES,
  parsePackageImageNotice,
  planPackageImageAltText,
  planPackageImageDelete,
  planPackageImageReplace,
  planPackageImageUpload,
  type PackageImageOutcome,
} from "./packageImageOutcomes";
import type { AdminPackageImageWriteState } from "../server/adminPackageImagesApi";

// What a journey-image Server Action does about each answer the API gave.
//
// Tested here rather than through the action, because an action cannot be
// imported without Next's request context — the same split
// `imageOutcomes.test.ts` already uses. What matters most is which answers
// cause the journey to be re-read: those are exactly the ones where what an
// administrator is looking at may no longer be true.

const ALL_STATES: AdminPackageImageWriteState[] = [
  "ok",
  "unauthenticated",
  "invalid-reference",
  "not-found",
  "image-exists",
  "image-not-found",
  "invalid-image",
  "invalid-update",
  "unsupported-type",
  "too-large",
  "storage-unavailable",
  "outcome-uncertain",
  "operation-failed",
  "unavailable",
];

const PLANNERS = {
  upload: planPackageImageUpload,
  replace: planPackageImageReplace,
  delete: planPackageImageDelete,
  "alt-text": planPackageImageAltText,
} as const;

const tokenOf = (outcome: PackageImageOutcome) =>
  outcome.kind === "notice" ? outcome.token : null;

describe("journey image outcomes: every state is planned", () => {
  it("answers every state, for every operation", () => {
    for (const [name, plan] of Object.entries(PLANNERS)) {
      for (const state of ALL_STATES) {
        const outcome = plan(state);

        assert.ok(
          outcome.kind === "login" || outcome.kind === "stale" || outcome.kind === "notice",
          `${name}/${state} must be planned`,
        );
      }
    }
  });

  it("names a notice that exists in the closed set", () => {
    for (const [name, plan] of Object.entries(PLANNERS)) {
      for (const state of ALL_STATES) {
        const token = tokenOf(plan(state));

        if (token !== null) {
          assert.ok(Object.hasOwn(PACKAGE_IMAGE_NOTICES, token), `${name}/${state}: ${token}`);
        }
      }
    }
  });

  it("sends an ended session to sign in, with no notice and no re-read", () => {
    for (const plan of Object.values(PLANNERS)) {
      assert.deepEqual(plan("unauthenticated"), { kind: "login" });
    }
  });

  it("lets the page render its own not-found when the journey is gone", () => {
    for (const plan of Object.values(PLANNERS)) {
      for (const state of ["invalid-reference", "not-found"] as const) {
        assert.deepEqual(plan(state), { kind: "stale", revalidate: "detail" });
      }
    }
  });
});

describe("journey image outcomes: what each operation says on success", () => {
  it("distinguishes the four successes", () => {
    assert.equal(tokenOf(planPackageImageUpload("ok")), "image-uploaded");
    assert.equal(tokenOf(planPackageImageReplace("ok")), "image-replaced");
    assert.equal(tokenOf(planPackageImageDelete("ok")), "image-deleted");
    assert.equal(tokenOf(planPackageImageAltText("ok")), "image-alt-text-updated");
  });

  it("re-reads the journey after every success", () => {
    for (const plan of Object.values(PLANNERS)) {
      const outcome = plan("ok");

      assert.equal(outcome.kind, "notice");
      assert.equal(outcome.kind === "notice" && outcome.revalidate, "detail");
    }
  });

  it("says the description survived a replacement", () => {
    assert.match(PACKAGE_IMAGE_NOTICES["image-replaced"].message, /description was kept/i);
  });
});

describe("journey image outcomes: stale pages are reconciled", () => {
  it("re-reads the journey when it already had an image", () => {
    // The page was rendered before somebody else uploaded one. Showing the
    // conflict without re-reading would leave the administrator looking at
    // an upload form for a journey that has a picture.
    const outcome = planPackageImageUpload("image-exists");

    assert.deepEqual(outcome, { kind: "notice", token: "image-exists", revalidate: "detail" });
    assert.match(PACKAGE_IMAGE_NOTICES["image-exists"].message, /already has an image/i);
    assert.match(PACKAGE_IMAGE_NOTICES["image-exists"].message, /replace it instead/i);
  });

  it("re-reads the journey when the image it was changing is gone", () => {
    for (const plan of [planPackageImageReplace, planPackageImageDelete, planPackageImageAltText]) {
      assert.deepEqual(plan("image-not-found"), {
        kind: "notice",
        token: "image-missing",
        revalidate: "detail",
      });
    }
  });
});

describe("journey image outcomes: an unknown result is never claimed either way", () => {
  it("says only that the outcome could not be confirmed", () => {
    const message = PACKAGE_IMAGE_NOTICES["image-outcome-uncertain"].message;

    assert.match(message, /could not confirm/i);
    assert.match(message, /may or may not/i);

    // None of these may appear: nobody knows which happened, and claiming
    // one would be worse than saying so.
    for (const forbidden of [/\bfailed\b/i, /\bsucceeded\b/i, /\bwas uploaded\b/i, /\bwas deleted\b/i, /rolled back/i]) {
      assert.ok(!forbidden.test(message), `${forbidden} must not appear`);
    }
  });

  it("re-reads the journey so the page shows what is actually stored", () => {
    for (const plan of Object.values(PLANNERS)) {
      assert.deepEqual(plan("outcome-uncertain"), {
        kind: "notice",
        token: "image-outcome-uncertain",
        revalidate: "detail",
      });
    }
  });

  it("treats an unreachable API the same way", () => {
    for (const plan of Object.values(PLANNERS)) {
      const outcome = plan("unavailable");

      assert.equal(tokenOf(outcome), "image-unavailable");
      assert.equal(outcome.kind === "notice" && outcome.revalidate, "detail");
    }

    const message = PACKAGE_IMAGE_NOTICES["image-unavailable"].message;
    assert.match(message, /may or may not/i);
  });

  it("re-reads after an operation that left an object behind", () => {
    for (const plan of Object.values(PLANNERS)) {
      assert.deepEqual(plan("operation-failed"), {
        kind: "notice",
        token: "image-operation-failed",
        revalidate: "detail",
      });
    }
  });
});

describe("journey image outcomes: a refused file changes nothing", () => {
  it("does not re-read the journey for a file the API would not take", () => {
    // Nothing was written, so there is nothing new to show — and re-reading
    // would discard the notice's own context for no gain.
    for (const state of ["invalid-image", "unsupported-type", "too-large", "storage-unavailable"] as const) {
      const outcome = planPackageImageUpload(state);

      assert.equal(outcome.kind, "notice");
      assert.equal(outcome.kind === "notice" && outcome.revalidate, "none");
    }
  });

  it("names the three accepted formats and the ceiling", () => {
    assert.match(PACKAGE_IMAGE_NOTICES["image-unsupported-type"].message, /JPEG, PNG, or WebP/);
    assert.match(PACKAGE_IMAGE_NOTICES["image-too-large"].message, /8 MiB/);
  });

  it("explains a refused description by its length", () => {
    assert.equal(tokenOf(planPackageImageAltText("invalid-update")), "image-description-refused");
    assert.match(PACKAGE_IMAGE_NOTICES["image-description-refused"].message, /240 characters/);
  });
});

describe("journey image notices: reading the token from a URL", () => {
  it("accepts every token in the closed set", () => {
    for (const token of Object.keys(PACKAGE_IMAGE_NOTICES)) {
      assert.equal(parsePackageImageNotice(token), token);
    }
  });

  it("refuses anything else, including inherited property names", () => {
    for (const value of [
      undefined,
      "",
      "unknown",
      "toString",
      "constructor",
      "__proto__",
      ["image-uploaded"],
      ["image-uploaded", "image-deleted"],
    ]) {
      assert.equal(parsePackageImageNotice(value as string | string[] | undefined), null);
    }
  });

  it("never carries text that came from a URL", () => {
    // The token only picks an entry; nothing from the query string is ever
    // rendered.
    for (const entry of Object.values(PACKAGE_IMAGE_NOTICES)) {
      assert.ok(entry.message.length > 0);
      assert.ok(entry.tone === "done" || entry.tone === "warn");
    }
  });

  it("exposes no internal media vocabulary to an administrator", () => {
    for (const [token, entry] of Object.entries(PACKAGE_IMAGE_NOTICES)) {
      for (const leaked of ["storage_key", "storageKey", "bucket", "checksum", "media_asset", "R2", "reference"]) {
        assert.ok(!entry.message.includes(leaked), `${token} must not mention ${leaked}`);
      }
    }
  });
});
