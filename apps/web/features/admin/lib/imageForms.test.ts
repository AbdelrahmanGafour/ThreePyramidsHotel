import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAltTextForm, parseImageUploadForm, parseOrderDirection } from "./imageForms.js";

// Pure: these are the real parsers the shipping Server Actions call, imported
// directly. They take a standard FormData (or, for direction, a bound string)
// and return a payload or a refusal — no request context, no network.
//
// What they are NOT is a second copy of the API's validation contract.
// Nothing here asserts a byte-size ceiling, an accepted MIME type, or an
// alt-text length limit, because none of that is this layer's to decide.

/** Builds a FormData from plain entries, as a submitted form produces. */
function form(entries: Record<string, string | File>): FormData {
  const data = new FormData();

  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }

  return data;
}

describe("parseImageUploadForm", () => {
  it("accepts a submitted file", async () => {
    const file = new File(["fake-bytes"], "photo.webp", { type: "image/webp" });
    const parsed = await parseImageUploadForm(form({ image: file }));

    assert.ok(parsed.ok);
    assert.ok(Buffer.isBuffer(parsed.value.body));
    assert.equal(parsed.value.contentType, "image/webp");
  });

  it("converts the file's exact bytes", async () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const file = new File([bytes], "photo.webp", { type: "image/webp" });
    const parsed = await parseImageUploadForm(form({ image: file }));

    assert.ok(parsed.ok);
    assert.deepEqual(new Uint8Array(parsed.value.body), bytes);
  });

  it("forwards file.type exactly as reported, for values the platform passes through untouched", async () => {
    for (const type of ["image/webp", "application/octet-stream", ""]) {
      const file = new File(["x"], "photo", { type });
      const parsed = await parseImageUploadForm(form({ image: file }));

      assert.ok(parsed.ok);
      assert.equal(parsed.value.contentType, type, "the API owns what counts as an accepted declaration");
    }
  });

  it("adds no normalisation of its own on top of whatever the File object already reports", async () => {
    // The File API itself lower-cases a syntactically valid MIME type before
    // this parser ever sees it (`new File([...], name, { type: "IMAGE/WEBP" })`
    // reports `.type === "image/webp"`), so this asserts against `file.type`
    // itself rather than the constructor argument: the point is that this
    // parser performs no further trimming or re-casing of its own.
    const file = new File(["x"], "photo", { type: "IMAGE/WEBP" });
    const parsed = await parseImageUploadForm(form({ image: file }));

    assert.ok(parsed.ok);
    assert.equal(parsed.value.contentType, file.type);
  });

  it("reads no part of the file's name as media identity", async () => {
    // Two files with different names and metadata produce output that says
    // nothing about either name: only `body` and `contentType` exist.
    const file = new File(["same-bytes"], "anything-at-all.png", {
      type: "image/webp",
      lastModified: 123456,
    });
    const parsed = await parseImageUploadForm(form({ image: file }));

    assert.ok(parsed.ok);
    assert.deepEqual(Object.keys(parsed.value).sort(), ["body", "contentType"]);
  });

  describe("refuses locally, without issuing a request", () => {
    it("an absent image field", async () => {
      assert.deepEqual(await parseImageUploadForm(form({})), { ok: false });
    });

    it("a string submitted in place of a file", async () => {
      assert.deepEqual(await parseImageUploadForm(form({ image: "not-a-file" })), { ok: false });
    });

    it("an empty string standing in for a file", async () => {
      assert.deepEqual(await parseImageUploadForm(form({ image: "" })), { ok: false });
    });
  });

  it("reads nothing but the image field", async () => {
    const file = new File(["x"], "photo.webp", { type: "image/webp" });
    const parsed = await parseImageUploadForm(form({ image: file, altText: "a caption", isCover: "true" }));

    assert.ok(parsed.ok);
    assert.deepEqual(Object.keys(parsed.value).sort(), ["body", "contentType"]);
  });
});

describe("parseAltTextForm", () => {
  it("passes the value through byte for byte", () => {
    for (const altText of ["A garden view.", "  padded  ", "", "   ", "Ünïcödé caption"]) {
      assert.deepEqual(
        parseAltTextForm(form({ altText })),
        { ok: true, value: altText },
        "the API owns trimming and null-normalisation",
      );
    }
  });

  it("refuses an absent altText field", () => {
    assert.deepEqual(parseAltTextForm(form({})), { ok: false });
  });

  it("refuses a file submitted in place of text", () => {
    const data = new FormData();
    data.set("altText", new File(["x"], "caption.txt"));

    assert.deepEqual(parseAltTextForm(data), { ok: false });
  });

  it("reads nothing but altText", () => {
    const parsed = parseAltTextForm(form({ altText: "A view.", isCover: "true", sortOrder: "2" }));

    assert.deepEqual(parsed, { ok: true, value: "A view." });
  });
});

describe("parseOrderDirection", () => {
  it("accepts the two exact directions", () => {
    assert.equal(parseOrderDirection("up"), "up");
    assert.equal(parseOrderDirection("down"), "down");
  });

  it("refuses anything not exactly one of the two values", () => {
    for (const value of ["UP", "Down", " up", "up ", "left", "", "0", "-1"]) {
      assert.equal(parseOrderDirection(value), null, `must refuse ${JSON.stringify(value)}`);
    }
  });
});
