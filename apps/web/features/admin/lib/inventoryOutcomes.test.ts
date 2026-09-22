import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planPhysicalRoomAdd,
  planPhysicalRoomRename,
  planPhysicalRoomStatus,
  planRoomTypeCapacity,
  planRoomTypeCreate,
  type InventoryOutcome,
} from "./inventoryOutcomes.js";
import { PHYSICAL_ROOM_NOTICES } from "./physicalRooms.js";
import {
  ROOM_TYPE_CREATE_NOTICES,
  ROOM_TYPE_LIST_NOTICES,
  ROOM_TYPE_NOTICES,
} from "./roomTypes.js";

// Pure: these are the real planners the shipping Server Actions call. They
// take a state an H1 client already decided and say what follows from it —
// which fixed notice, which page, what to re-read.
//
// The clients' own classification is proven in adminRoomsApi.test.ts and
// adminRoomTypesApi.test.ts and is not re-tested here.
//
// What this cannot cover is the action wiring itself: a Server Action needs
// Next's request context to import, so whether each action calls the right
// client and executes its plan is verified at runtime in H5.

/** Every token a plan can name must exist in one of the notice maps. */
const KNOWN_TOKENS = new Set([
  ...Object.keys(ROOM_TYPE_NOTICES),
  ...Object.keys(ROOM_TYPE_LIST_NOTICES),
  ...Object.keys(ROOM_TYPE_CREATE_NOTICES),
  ...Object.keys(PHYSICAL_ROOM_NOTICES),
]);

function assertNotice(
  outcome: InventoryOutcome,
  token: string,
  surface: "list" | "new" | "detail",
  revalidate: string,
): void {
  assert.equal(outcome.kind, "notice");

  if (outcome.kind !== "notice") {
    return;
  }

  assert.equal(outcome.token, token);
  assert.equal(outcome.surface, surface);
  assert.equal(outcome.revalidate, revalidate);
  assert.ok(KNOWN_TOKENS.has(outcome.token), `${outcome.token} must be a declared notice`);
}

describe("planRoomTypeCreate", () => {
  it("sends a confirmed creation to the new room type, re-reading both paths", () => {
    assertNotice(planRoomTypeCreate("ok"), "created", "detail", "list-and-detail");
  });

  it("keeps a refused body on the create form", () => {
    assertNotice(planRoomTypeCreate("invalid-create"), "create-refused", "new", "none");
  });

  it("keeps a taken slug on the create form", () => {
    assertNotice(planRoomTypeCreate("slug-taken"), "create-slug-taken", "new", "none");
  });

  it("sends an unconfirmed creation to the refreshed list, not to a slug that may not exist", () => {
    // The one operation with no detail page to fall back to: whether the room
    // type exists can only be answered by the list.
    assertNotice(planRoomTypeCreate("unavailable"), "create-uncertain", "list", "list");
  });

  it("sends an ended session to the login page", () => {
    assert.deepEqual(planRoomTypeCreate("unauthenticated"), { kind: "login" });
  });
});

describe("planRoomTypeCapacity", () => {
  it("re-reads both paths on a confirmed save", () => {
    assertNotice(planRoomTypeCapacity("ok"), "capacity-saved", "detail", "list-and-detail");
  });

  it("reports a refused value without re-reading anything", () => {
    assertNotice(planRoomTypeCapacity("invalid-capacity"), "capacity-refused", "detail", "none");
  });

  it("reports a booked-guest conflict and re-reads the detail", () => {
    assertNotice(planRoomTypeCapacity("capacity-conflict"), "capacity-conflict", "detail", "detail");
  });

  it("reports an unconfirmed change as uncertain, re-reading both paths", () => {
    assertNotice(
      planRoomTypeCapacity("unavailable"),
      "capacity-uncertain",
      "detail",
      "list-and-detail",
    );
  });

  for (const state of ["invalid-reference", "not-found"] as const) {
    it(`treats ${state} as a stale resource, with no invented notice`, () => {
      assert.deepEqual(planRoomTypeCapacity(state), { kind: "stale", revalidate: "list" });
    });
  }

  it("sends an ended session to the login page", () => {
    assert.deepEqual(planRoomTypeCapacity("unauthenticated"), { kind: "login" });
  });
});

describe("planPhysicalRoomAdd", () => {
  it("re-reads the list too, because a room type's room count changed", () => {
    assertNotice(planPhysicalRoomAdd("ok"), "room-added", "detail", "list-and-detail");
  });

  it("reports a refused room number", () => {
    assertNotice(planPhysicalRoomAdd("invalid-create"), "room-add-refused", "detail", "none");
  });

  it("reports a number already in use", () => {
    assertNotice(planPhysicalRoomAdd("room-number-taken"), "room-number-taken", "detail", "none");
  });

  it("reports an unconfirmed add as uncertain", () => {
    assertNotice(
      planPhysicalRoomAdd("unavailable"),
      "room-add-uncertain",
      "detail",
      "list-and-detail",
    );
  });

  for (const state of ["invalid-reference", "not-found"] as const) {
    it(`treats ${state} as a stale room type`, () => {
      assert.deepEqual(planPhysicalRoomAdd(state), { kind: "stale", revalidate: "list" });
    });
  }
});

describe("planPhysicalRoomRename", () => {
  it("re-reads only the detail on a confirmed rename", () => {
    // A rename changes no count on the list.
    assertNotice(planPhysicalRoomRename("ok"), "room-renamed", "detail", "detail");
  });

  it("reports a refused replacement number", () => {
    assertNotice(planPhysicalRoomRename("invalid-update"), "room-rename-refused", "detail", "none");
  });

  it("reports a replacement number already in use", () => {
    assertNotice(planPhysicalRoomRename("room-number-taken"), "room-number-taken", "detail", "none");
  });

  it("reports a room renamed by someone else, and re-reads the rooms", () => {
    assertNotice(planPhysicalRoomRename("not-found"), "room-not-found", "detail", "detail");
  });

  it("reports an unconfirmed rename as uncertain", () => {
    assertNotice(planPhysicalRoomRename("unavailable"), "room-rename-uncertain", "detail", "detail");
  });

  it("treats invalid-reference as a stale resource", () => {
    assert.deepEqual(planPhysicalRoomRename("invalid-reference"), {
      kind: "stale",
      revalidate: "detail",
    });
  });
});

describe("planPhysicalRoomStatus", () => {
  it("reports the direction that was asked for", () => {
    assertNotice(planPhysicalRoomStatus("ok", true), "room-activated", "detail", "detail");
    assertNotice(planPhysicalRoomStatus("ok", false), "room-deactivated", "detail", "detail");
  });

  it("reports a blocked deactivation with the fixed message", () => {
    assertNotice(
      planPhysicalRoomStatus("has-future-reservations", false),
      "room-has-future-reservations",
      "detail",
      "detail",
    );
  });

  it("reports a room that is no longer there", () => {
    assertNotice(planPhysicalRoomStatus("not-found", false), "room-not-found", "detail", "detail");
  });

  it("reports a refused body", () => {
    assertNotice(planPhysicalRoomStatus("invalid-update", true), "room-status-refused", "detail", "none");
  });

  it("reports an unconfirmed change as uncertain", () => {
    assertNotice(
      planPhysicalRoomStatus("unavailable", false),
      "room-status-uncertain",
      "detail",
      "detail",
    );
  });

  it("treats invalid-reference as a stale resource", () => {
    assert.deepEqual(planPhysicalRoomStatus("invalid-reference", true), {
      kind: "stale",
      revalidate: "detail",
    });
  });
});

describe("unavailable always means uncertain, never refused", () => {
  // The load-bearing rule: an answer that never arrived may still have
  // committed, so no wording may claim the change failed.
  const uncertain: [string, InventoryOutcome][] = [
    ["create", planRoomTypeCreate("unavailable")],
    ["capacity", planRoomTypeCapacity("unavailable")],
    ["add room", planPhysicalRoomAdd("unavailable")],
    ["rename", planPhysicalRoomRename("unavailable")],
    ["status", planPhysicalRoomStatus("unavailable", false)],
  ];

  for (const [label, outcome] of uncertain) {
    it(`${label} maps to an uncertain token`, () => {
      assert.equal(outcome.kind, "notice");
      assert.ok(
        outcome.kind === "notice" && outcome.token.endsWith("uncertain"),
        `${label} must not be reported as a refusal`,
      );
    });
  }

  it("never reuses a refusal token for an unavailable answer", () => {
    for (const [, outcome] of uncertain) {
      assert.ok(outcome.kind === "notice" && !outcome.token.includes("refused"));
    }
  });
});

describe("every notice message is safe and fixed", () => {
  const allNotices = {
    ...ROOM_TYPE_NOTICES,
    ...ROOM_TYPE_LIST_NOTICES,
    ...ROOM_TYPE_CREATE_NOTICES,
    ...PHYSICAL_ROOM_NOTICES,
  } as Record<string, { tone: string; message: string }>;

  it("uses only the two established tones", () => {
    for (const [token, notice] of Object.entries(allNotices)) {
      assert.ok(notice.tone === "done" || notice.tone === "warn", `${token} has tone ${notice.tone}`);
    }
  });

  it("carries no reservation count, reference, date or guest in a conflict message", () => {
    for (const token of ["capacity-conflict", "room-has-future-reservations"]) {
      const message = allNotices[token]!.message;

      assert.doesNotMatch(message, /\d/, `${token} must carry no count or date`);
      assert.doesNotMatch(message, /TPH-/, `${token} must carry no booking reference`);
    }
  });

  it("never tells an administrator an uncertain change failed", () => {
    for (const [token, notice] of Object.entries(allNotices)) {
      if (!token.endsWith("uncertain")) {
        continue;
      }

      assert.match(notice.message, /could not be confirmed/, `${token} must say the outcome is unknown`);
      assert.doesNotMatch(notice.message, /\bfailed\b|was not saved|was not applied/i, token);
      // "try again" would invite an immediate resubmit of something that may
      // already have committed.
      assert.doesNotMatch(notice.message, /try again|resubmit now/i, token);
    }
  });

  it("tells an administrator to review the current state after an uncertain change", () => {
    for (const [token, notice] of Object.entries(allNotices)) {
      if (!token.endsWith("uncertain")) {
        continue;
      }

      assert.match(notice.message, /review|check/i, `${token} must point at the refreshed state`);
    }
  });
});
