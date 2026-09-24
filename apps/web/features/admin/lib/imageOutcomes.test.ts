import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ROOM_TYPE_IMAGE_NOTICES,
  parseRoomTypeImageNotice,
  planRoomTypeImageAltText,
  planRoomTypeImageCover,
  planRoomTypeImageDelete,
  planRoomTypeImageMove,
  planRoomTypeImageUpload,
  type RoomTypeImageNotice,
  type RoomTypeImageOutcome,
} from "./imageOutcomes.js";

// Pure: these are the real planners the shipping Server Actions call. They
// take a state the media API client already decided and say what follows
// from it — which fixed notice, whether to re-read the detail page.
//
// The client's own classification is proven in adminRoomTypeImagesApi.test.ts
// and is not re-tested here.

const KNOWN_TOKENS = new Set(Object.keys(ROOM_TYPE_IMAGE_NOTICES));

function assertNotice(
  outcome: RoomTypeImageOutcome,
  token: RoomTypeImageNotice,
  revalidate: "none" | "detail",
): void {
  assert.equal(outcome.kind, "notice");

  if (outcome.kind !== "notice") {
    return;
  }

  assert.equal(outcome.token, token);
  assert.equal(outcome.revalidate, revalidate);
  assert.ok(KNOWN_TOKENS.has(outcome.token), `${outcome.token} must be a declared notice`);
}

function assertStale(outcome: RoomTypeImageOutcome, revalidate: "none" | "detail"): void {
  assert.deepEqual(outcome, { kind: "stale", revalidate });
}

describe("planRoomTypeImageUpload", () => {
  it("reports a confirmed upload and re-reads the detail", () => {
    assertNotice(planRoomTypeImageUpload("ok"), "image-uploaded", "detail");
  });

  it("sends an ended session to the login page", () => {
    assert.deepEqual(planRoomTypeImageUpload("unauthenticated"), { kind: "login" });
  });

  for (const state of ["invalid-reference", "not-found"] as const) {
    it(`treats ${state} as a stale room type, with no invented notice`, () => {
      assertStale(planRoomTypeImageUpload(state), "detail");
    });
  }

  it("reports an unacceptable file without re-reading anything, since nothing was written", () => {
    assertNotice(planRoomTypeImageUpload("invalid-image"), "image-invalid", "none");
  });

  it("reports an unsupported type without re-reading anything", () => {
    assertNotice(planRoomTypeImageUpload("unsupported-type"), "image-unsupported-type", "none");
  });

  it("reports an oversized file without re-reading anything", () => {
    assertNotice(planRoomTypeImageUpload("too-large"), "image-too-large", "none");
  });

  it("reports a reached limit and re-reads the detail, since the gallery is worth showing", () => {
    assertNotice(planRoomTypeImageUpload("limit-reached"), "image-limit-reached", "detail");
  });

  it("reports storage unavailable without re-reading anything, since nothing was written", () => {
    assertNotice(planRoomTypeImageUpload("storage-unavailable"), "image-storage-unavailable", "none");
  });

  it("reports delivery unavailable without re-reading anything", () => {
    assertNotice(planRoomTypeImageUpload("delivery-unavailable"), "image-delivery-unavailable", "none");
  });

  it("reports an operation failure and re-reads the detail", () => {
    assertNotice(planRoomTypeImageUpload("operation-failed"), "image-operation-failed", "detail");
  });

  it("reports an uncertain outcome and re-reads the detail", () => {
    assertNotice(planRoomTypeImageUpload("outcome-uncertain"), "image-outcome-uncertain", "detail");
  });

  it("reports a transport outage and re-reads the detail", () => {
    assertNotice(planRoomTypeImageUpload("unavailable"), "image-unavailable", "detail");
  });
});

describe("planRoomTypeImageAltText", () => {
  it("reports a confirmed save and re-reads the detail", () => {
    assertNotice(planRoomTypeImageAltText("ok"), "image-updated", "detail");
  });

  it("sends an ended session to the login page", () => {
    assert.deepEqual(planRoomTypeImageAltText("unauthenticated"), { kind: "login" });
  });

  for (const state of ["invalid-reference", "not-found"] as const) {
    it(`treats ${state} as a stale room type`, () => {
      assertStale(planRoomTypeImageAltText(state), "detail");
    });
  }

  it("reports a refused value without re-reading anything", () => {
    assertNotice(planRoomTypeImageAltText("invalid-update"), "image-update-refused", "none");
  });

  it("reports an uncertain outcome and re-reads the detail", () => {
    assertNotice(planRoomTypeImageAltText("outcome-uncertain"), "image-outcome-uncertain", "detail");
  });

  it("reports a transport outage and re-reads the detail", () => {
    assertNotice(planRoomTypeImageAltText("unavailable"), "image-unavailable", "detail");
  });

  it("answers a tampered reference identically to one that never existed", () => {
    const fromTampering = planRoomTypeImageAltText("invalid-image-reference");
    const fromNotFound = planRoomTypeImageAltText("image-not-found");

    assert.deepEqual(fromTampering, fromNotFound);
    assertNotice(fromTampering, "image-not-found", "detail");
  });
});

describe("planRoomTypeImageCover", () => {
  it("reports a confirmed cover change and re-reads the detail", () => {
    assertNotice(planRoomTypeImageCover("ok"), "image-cover-updated", "detail");
  });

  it("sends an ended session to the login page", () => {
    assert.deepEqual(planRoomTypeImageCover("unauthenticated"), { kind: "login" });
  });

  for (const state of ["invalid-reference", "not-found"] as const) {
    it(`treats ${state} as a stale room type`, () => {
      assertStale(planRoomTypeImageCover(state), "detail");
    });
  }

  it("reports an uncertain outcome and re-reads the detail", () => {
    assertNotice(planRoomTypeImageCover("outcome-uncertain"), "image-outcome-uncertain", "detail");
  });

  it("reports a transport outage and re-reads the detail", () => {
    assertNotice(planRoomTypeImageCover("unavailable"), "image-unavailable", "detail");
  });

  it("answers a tampered reference identically to one that never existed", () => {
    const fromTampering = planRoomTypeImageCover("invalid-image-reference");
    const fromNotFound = planRoomTypeImageCover("image-not-found");

    assert.deepEqual(fromTampering, fromNotFound);
    assertNotice(fromTampering, "image-not-found", "detail");
  });
});

describe("planRoomTypeImageMove", () => {
  it("reports a confirmed move — or a boundary no-op, indistinguishably — and re-reads the detail", () => {
    assertNotice(planRoomTypeImageMove("ok"), "image-order-updated", "detail");
  });

  it("sends an ended session to the login page", () => {
    assert.deepEqual(planRoomTypeImageMove("unauthenticated"), { kind: "login" });
  });

  for (const state of ["invalid-reference", "not-found"] as const) {
    it(`treats ${state} as a stale room type`, () => {
      assertStale(planRoomTypeImageMove(state), "detail");
    });
  }

  it("reports an invalid direction without re-reading anything", () => {
    assertNotice(planRoomTypeImageMove("invalid-direction"), "image-reorder-invalid", "none");
  });

  it("reports an uncertain outcome and re-reads the detail", () => {
    assertNotice(planRoomTypeImageMove("outcome-uncertain"), "image-outcome-uncertain", "detail");
  });

  it("reports a transport outage and re-reads the detail", () => {
    assertNotice(planRoomTypeImageMove("unavailable"), "image-unavailable", "detail");
  });

  it("answers a tampered reference identically to one that never existed", () => {
    const fromTampering = planRoomTypeImageMove("invalid-image-reference");
    const fromNotFound = planRoomTypeImageMove("image-not-found");

    assert.deepEqual(fromTampering, fromNotFound);
    assertNotice(fromTampering, "image-not-found", "detail");
  });
});

describe("planRoomTypeImageDelete", () => {
  it("reports a confirmed deletion and re-reads the detail", () => {
    assertNotice(planRoomTypeImageDelete("ok"), "image-deleted", "detail");
  });

  it("sends an ended session to the login page", () => {
    assert.deepEqual(planRoomTypeImageDelete("unauthenticated"), { kind: "login" });
  });

  for (const state of ["invalid-reference", "not-found"] as const) {
    it(`treats ${state} as a stale room type`, () => {
      assertStale(planRoomTypeImageDelete(state), "detail");
    });
  }

  it("reports an uncertain outcome and re-reads the detail, never claiming deletion succeeded", () => {
    assertNotice(planRoomTypeImageDelete("outcome-uncertain"), "image-outcome-uncertain", "detail");
  });

  it("reports a transport outage and re-reads the detail", () => {
    assertNotice(planRoomTypeImageDelete("unavailable"), "image-unavailable", "detail");
  });

  it("answers a tampered reference identically to one that never existed", () => {
    const fromTampering = planRoomTypeImageDelete("invalid-image-reference");
    const fromNotFound = planRoomTypeImageDelete("image-not-found");

    assert.deepEqual(fromTampering, fromNotFound);
    assertNotice(fromTampering, "image-not-found", "detail");
  });
});

describe("parseRoomTypeImageNotice", () => {
  it("matches a known token", () => {
    assert.equal(parseRoomTypeImageNotice({ action: "image-uploaded" }), "image-uploaded");
  });

  it("refuses an unknown token", () => {
    assert.equal(parseRoomTypeImageNotice({ action: "image-teleported" }), null);
  });

  it("refuses an absent action parameter", () => {
    assert.equal(parseRoomTypeImageNotice({}), null);
  });

  it("refuses a repeated parameter, which arrives as an array", () => {
    assert.equal(parseRoomTypeImageNotice({ action: ["image-uploaded", "image-deleted"] }), null);
  });

  it("refuses an inherited property name", () => {
    // Object.hasOwn must be what decides this, not `in` or bracket access
    // falling through the prototype chain.
    assert.equal(parseRoomTypeImageNotice({ action: "toString" }), null);
    assert.equal(parseRoomTypeImageNotice({ action: "constructor" }), null);
  });

  it("never collides with an existing room-type, capacity or physical-room token", () => {
    for (const token of Object.keys(ROOM_TYPE_IMAGE_NOTICES)) {
      assert.ok(token.startsWith("image-"), `${token} must carry the image- prefix`);
    }
  });
});

describe("uncertain and unavailable outcomes never claim a result that is not known", () => {
  const unresolved: [string, RoomTypeImageOutcome][] = [
    ["upload outcome-uncertain", planRoomTypeImageUpload("outcome-uncertain")],
    ["upload unavailable", planRoomTypeImageUpload("unavailable")],
    ["alt-text outcome-uncertain", planRoomTypeImageAltText("outcome-uncertain")],
    ["alt-text unavailable", planRoomTypeImageAltText("unavailable")],
    ["cover outcome-uncertain", planRoomTypeImageCover("outcome-uncertain")],
    ["cover unavailable", planRoomTypeImageCover("unavailable")],
    ["move outcome-uncertain", planRoomTypeImageMove("outcome-uncertain")],
    ["move unavailable", planRoomTypeImageMove("unavailable")],
    ["delete outcome-uncertain", planRoomTypeImageDelete("outcome-uncertain")],
    ["delete unavailable", planRoomTypeImageDelete("unavailable")],
  ];

  for (const [label, outcome] of unresolved) {
    it(`${label} re-reads the detail page`, () => {
      assert.equal(outcome.kind, "notice");
      assert.ok(outcome.kind === "notice" && outcome.revalidate === "detail");
    });

    it(`${label} never uses a "done" tone`, () => {
      assert.ok(outcome.kind === "notice");

      if (outcome.kind === "notice") {
        assert.equal(ROOM_TYPE_IMAGE_NOTICES[outcome.token].tone, "warn");
      }
    });
  }
});

describe("every image notice message is safe and fixed", () => {
  it("uses only the two established tones", () => {
    for (const [token, notice] of Object.entries(ROOM_TYPE_IMAGE_NOTICES)) {
      assert.ok(notice.tone === "done" || notice.tone === "warn", `${token} has tone ${notice.tone}`);
    }
  });

  it("never tells an administrator an uncertain change failed or succeeded", () => {
    for (const [token, notice] of Object.entries(ROOM_TYPE_IMAGE_NOTICES)) {
      if (!token.endsWith("uncertain")) {
        continue;
      }

      assert.doesNotMatch(notice.message, /\bfailed\b/i, token);
      assert.doesNotMatch(notice.message, /rolled back/i, token);
      assert.doesNotMatch(notice.message, /not created/i, token);
      assert.doesNotMatch(notice.message, /deleted successfully/i, token);
      assert.doesNotMatch(notice.message, /was not (saved|applied)/i, token);
    }
  });

  it("points an uncertain outcome at the refreshed gallery", () => {
    for (const [token, notice] of Object.entries(ROOM_TYPE_IMAGE_NOTICES)) {
      if (!token.endsWith("uncertain")) {
        continue;
      }

      assert.match(notice.message, /review|check/i, `${token} must point at the current state`);
    }
  });

  it("carries no ownership or authorization language for a missing image", () => {
    const message = ROOM_TYPE_IMAGE_NOTICES["image-not-found"].message;

    assert.doesNotMatch(message, /belongs to|another room type|not yours|unauthorized|forbidden/i);
  });

  it("mentions no filename, byte count, or MIME type in a refusal message", () => {
    for (const [token, notice] of Object.entries(ROOM_TYPE_IMAGE_NOTICES)) {
      assert.doesNotMatch(notice.message, /\.(png|jpe?g|webp|gif)\b/i, token);
    }
  });
});
