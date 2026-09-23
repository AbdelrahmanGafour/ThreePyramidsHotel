import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toEditingOrder } from "./roomTypeImages.js";
import type { AdminRoomTypeImage } from "../types";

// Pure: the real ordering helper the images panel calls to decide both what
// order to render images in and where the Move Up / Move Down boundaries
// fall. Nothing here touches the network or the API client's own
// classification, which is proven elsewhere.

let counter = 0;

/** Builds one image with sensible defaults, overridable per test. */
function image(overrides: Partial<AdminRoomTypeImage> & { reference: string }): AdminRoomTypeImage {
  counter += 1;

  return {
    url: `https://media.example.test/media/${overrides.reference}.webp`,
    contentType: "image/webp",
    byteSize: 12345,
    width: 1600,
    height: 900,
    altText: null,
    sortOrder: 0,
    isCover: false,
    createdAt: `2026-01-0${counter}T00:00:00.000Z`,
    updatedAt: `2026-01-0${counter}T00:00:00.000Z`,
    ...overrides,
  };
}

describe("toEditingOrder", () => {
  it("keeps an already-ascending sortOrder in the same order", () => {
    const a = image({ reference: "a", sortOrder: 0 });
    const b = image({ reference: "b", sortOrder: 1 });
    const c = image({ reference: "c", sortOrder: 2 });

    assert.deepEqual(
      toEditingOrder([a, b, c]).map((image) => image.reference),
      ["a", "b", "c"],
    );
  });

  it("re-sorts a cover-first API response into sortOrder order", () => {
    // The API's own convention: the cover leads regardless of its position in
    // the sequence. Here it sits at sortOrder 2 but is returned first.
    const cover = image({ reference: "cover", sortOrder: 2, isCover: true });
    const first = image({ reference: "first", sortOrder: 0 });
    const second = image({ reference: "second", sortOrder: 1 });

    const editingOrder = toEditingOrder([cover, first, second]);

    assert.deepEqual(
      editingOrder.map((image) => image.reference),
      ["first", "second", "cover"],
    );
  });

  it("preserves cover identity through the reorder", () => {
    const cover = image({ reference: "cover", sortOrder: 2, isCover: true });
    const first = image({ reference: "first", sortOrder: 0 });

    const editingOrder = toEditingOrder([cover, first]);
    const coverInEditingOrder = editingOrder.find((image) => image.reference === "cover");

    assert.equal(coverInEditingOrder?.isCover, true);
  });

  it("preserves the API's own input order as the tie-breaker for equal sortOrder values", () => {
    const first = image({ reference: "first", sortOrder: 5 });
    const second = image({ reference: "second", sortOrder: 5 });
    const third = image({ reference: "third", sortOrder: 5 });

    assert.deepEqual(
      toEditingOrder([first, second, third]).map((image) => image.reference),
      ["first", "second", "third"],
    );
  });

  it("does not mutate the source array", () => {
    const a = image({ reference: "a", sortOrder: 1 });
    const b = image({ reference: "b", sortOrder: 0 });
    const source = [a, b];

    toEditingOrder(source);

    assert.deepEqual(source, [a, b]);
    assert.equal(source[0], a);
    assert.equal(source[1], b);
  });

  it("makes the first editing-order row the Move Up boundary", () => {
    const cover = image({ reference: "cover", sortOrder: 2, isCover: true });
    const lowest = image({ reference: "lowest", sortOrder: 0 });
    const middle = image({ reference: "middle", sortOrder: 1 });

    const editingOrder = toEditingOrder([cover, middle, lowest]);

    // The lowest sortOrder, not the cover and not the API's own first entry,
    // is the one row with no Move Up available.
    assert.equal(editingOrder[0]?.reference, "lowest");
  });

  it("makes the last editing-order row the Move Down boundary", () => {
    const cover = image({ reference: "cover", sortOrder: 0, isCover: true });
    const highest = image({ reference: "highest", sortOrder: 2 });
    const middle = image({ reference: "middle", sortOrder: 1 });

    const editingOrder = toEditingOrder([cover, middle, highest]);

    assert.equal(editingOrder[editingOrder.length - 1]?.reference, "highest");
  });

  it("never treats the cover as the Move Up boundary when it is not first by sortOrder", () => {
    // The API returns the cover first; its sortOrder places it second. A
    // panel that read the boundary off the raw API array would wrongly
    // disable Move Up on the cover instead of on the true lowest sortOrder.
    const cover = image({ reference: "cover", sortOrder: 1, isCover: true });
    const trueFirst = image({ reference: "true-first", sortOrder: 0 });

    const editingOrder = toEditingOrder([cover, trueFirst]);

    assert.equal(editingOrder[0]?.reference, "true-first");
    assert.notEqual(editingOrder[0]?.reference, "cover");
  });
});
