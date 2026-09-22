import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PHYSICAL_ROOM_NOTICES } from "./physicalRooms.js";
import {
  ROOM_TYPE_CREATE_NOTICES,
  ROOM_TYPE_LIST_NOTICES,
  ROOM_TYPE_NOTICES,
  parseNoticeToken,
  parseRoomTypeNotice,
} from "./roomTypes.js";

// Which notice tokens each page will accept, and what they say.
//
// Pure: these are the real parsers and the real message maps the shipping
// pages read. Rendering a page under node:test would need Next's request
// context and a parallel rendering harness, which is not worth building — the
// browser proof belongs to H5. What is worth pinning here is the part that
// decides: a token allowed on the wrong surface, or a message that tells an
// administrator the wrong thing, is a real defect.

describe("the create page accepts only its own two tokens", () => {
  for (const token of ["create-refused", "create-slug-taken"] as const) {
    it(`accepts ${token}`, () => {
      assert.equal(parseNoticeToken({ action: token }, ROOM_TYPE_CREATE_NOTICES), token);
    });
  }

  it("rejects create-uncertain, which belongs to the list", () => {
    // An unconfirmed POST may or may not have created the room type. Saying so
    // on the form, beside a Create button, would invite an immediate resubmit.
    assert.equal(parseNoticeToken({ action: "create-uncertain" }, ROOM_TYPE_CREATE_NOTICES), null);
  });

  for (const [label, action] of [
    ["a detail token", "saved"],
    ["a capacity token", "capacity-conflict"],
    ["a physical-room token", "room-added"],
    ["an unknown token", "anything-at-all"],
    ["an empty token", ""],
    ["a prototype property name", "constructor"],
    ["another prototype property name", "toString"],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.equal(parseNoticeToken({ action }, ROOM_TYPE_CREATE_NOTICES), null);
    });
  }

  it("rejects a repeated parameter, which arrives as an array", () => {
    assert.equal(
      parseNoticeToken({ action: ["create-refused", "create-slug-taken"] }, ROOM_TYPE_CREATE_NOTICES),
      null,
    );
  });

  it("renders nothing when there is no action at all", () => {
    assert.equal(parseNoticeToken({}, ROOM_TYPE_CREATE_NOTICES), null);
  });
});

describe("the list page accepts only create-uncertain", () => {
  it("accepts create-uncertain", () => {
    assert.equal(parseNoticeToken({ action: "create-uncertain" }, ROOM_TYPE_LIST_NOTICES), "create-uncertain");
  });

  for (const action of ["create-refused", "create-slug-taken", "created", "saved", "room-added"] as const) {
    it(`rejects ${action}`, () => {
      assert.equal(parseNoticeToken({ action }, ROOM_TYPE_LIST_NOTICES), null);
    });
  }
});

describe("the detail page renders the created notice", () => {
  // H2 redirects a confirmed creation to the detail page with ?action=created.
  // The detail page parses against ROOM_TYPE_NOTICES, so that token must be in
  // it — otherwise a successful creation would land on a silent page.
  it("accepts created", () => {
    assert.equal(parseRoomTypeNotice({ action: "created" }), "created");
    assert.ok(Object.hasOwn(ROOM_TYPE_NOTICES, "created"));
  });

  it("still accepts the T01 tokens", () => {
    for (const token of ["saved", "refused", "uncertain"] as const) {
      assert.equal(parseRoomTypeNotice({ action: token }), token);
    }
  });

  it("rejects the tokens that belong to other surfaces", () => {
    for (const action of ["create-refused", "create-slug-taken", "create-uncertain"] as const) {
      assert.equal(parseRoomTypeNotice({ action }), null);
    }
  });
});

describe("no notice message can echo what was submitted", () => {
  const allNotices = {
    ...ROOM_TYPE_NOTICES,
    ...ROOM_TYPE_LIST_NOTICES,
    ...ROOM_TYPE_CREATE_NOTICES,
    ...PHYSICAL_ROOM_NOTICES,
  } as Record<string, { tone: string; message: string }>;

  it("carries no interpolation placeholder of any kind", () => {
    for (const [token, notice] of Object.entries(allNotices)) {
      assert.doesNotMatch(notice.message, /\$\{|%s|\{\{|<%/, `${token} must be fixed text`);
    }
  });

  it("ignores every query parameter except action", () => {
    // The only thing that can vary a message is the token itself, so a
    // submitted reference cannot reach the page through the URL.
    const withNoise = parseNoticeToken(
      { action: "create-slug-taken", slug: "garden-suite", name: "Garden Suite" },
      ROOM_TYPE_CREATE_NOTICES,
    );

    assert.equal(withNoise, "create-slug-taken");
    assert.equal(
      ROOM_TYPE_CREATE_NOTICES["create-slug-taken"].message,
      ROOM_TYPE_CREATE_NOTICES["create-slug-taken"].message,
    );
    assert.doesNotMatch(ROOM_TYPE_CREATE_NOTICES["create-slug-taken"].message, /garden-suite/);
  });
});

describe("the create-uncertain wording", () => {
  const message = ROOM_TYPE_LIST_NOTICES["create-uncertain"].message;

  it("says the outcome could not be confirmed", () => {
    assert.match(message, /could not be confirmed/);
  });

  it("tells the administrator to review the current room types first", () => {
    assert.match(message, /review|check/i);
    assert.match(message, /room types/i);
  });

  it("accounts for the catalogue itself being unavailable below", () => {
    // This page renders the notice in both branches: the catalogue read that
    // follows an uncertain POST can fail too, so there may be no list below.
    assert.match(message, /not shown below|not available below|cannot be loaded/i);
    assert.match(message, /reload/i);
  });

  it("never claims the current state was successfully re-read", () => {
    // Saying "the refreshed list below" would be a promise this page cannot
    // keep when fetchAdminRoomTypes is itself unavailable.
    for (const forbidden of [/refreshed list/i, /has been refreshed/i, /list below shows/i]) {
      assert.doesNotMatch(message, forbidden, `create-uncertain must not match ${forbidden}`);
    }
  });

  it("never claims the creation failed or that nothing was created", () => {
    // The POST may already have committed. Saying otherwise would be wrong,
    // and inviting an immediate resubmit could create a duplicate.
    for (const forbidden of [/\bfailed\b/i, /was not created/i, /try again/i, /resubmit/i]) {
      assert.doesNotMatch(message, forbidden, `create-uncertain must not match ${forbidden}`);
    }
  });

  it("carries no interpolation placeholder", () => {
    assert.doesNotMatch(message, /\$\{|%s|\{\{|<%/);
  });

  it("is a warning rather than a confirmation", () => {
    assert.equal(ROOM_TYPE_LIST_NOTICES["create-uncertain"].tone, "warn");
  });
});

describe("the detail page renders every capacity notice", () => {
  for (const token of [
    "capacity-saved",
    "capacity-refused",
    "capacity-conflict",
    "capacity-uncertain",
  ] as const) {
    it(`accepts ${token}`, () => {
      assert.equal(parseRoomTypeNotice({ action: token }), token);
      assert.ok(Object.hasOwn(ROOM_TYPE_NOTICES, token));
    });
  }

  it("marks only the saved one as a confirmation", () => {
    assert.equal(ROOM_TYPE_NOTICES["capacity-saved"].tone, "done");

    for (const token of ["capacity-refused", "capacity-conflict", "capacity-uncertain"] as const) {
      assert.equal(ROOM_TYPE_NOTICES[token].tone, "warn", token);
    }
  });
});

describe("the capacity-conflict wording", () => {
  const message = ROOM_TYPE_NOTICES["capacity-conflict"].message;

  it("explains that the proposed capacity conflicts with a booked stay", () => {
    assert.match(message, /cannot be lowered/i);
    assert.match(message, /reservation/i);
    assert.match(message, /more guests than/i);
  });

  it("covers a stay that is current, not only upcoming", () => {
    // A guest who checked in yesterday and leaves tomorrow blocks the change
    // too; the API's rule is check_out > CURRENT_DATE, not check_in.
    assert.match(message, /current or upcoming/i);
  });

  it("does not claim every reservation blocks a decrease", () => {
    assert.doesNotMatch(message, /all (existing|upcoming) reservations/i);
    assert.doesNotMatch(message, /any reservation\b/i);
  });

  it("carries no count, reference, guest or date", () => {
    // The API returns none of these, so none can be shown.
    assert.doesNotMatch(message, /\d/, "no count or date");
    assert.doesNotMatch(message, /TPH-/, "no booking reference");
    assert.doesNotMatch(message, /\$\{|%s|\{\{|<%/, "no interpolation placeholder");
  });

  it("does not suggest moving a booking to another room", () => {
    // There is no reassignment workflow anywhere in this system.
    assert.doesNotMatch(message, /reassign|move (it|the|that) (booking|reservation|stay)/i);
  });
});

describe("the capacity-uncertain wording", () => {
  const message = ROOM_TYPE_NOTICES["capacity-uncertain"].message;

  it("says the outcome could not be confirmed", () => {
    assert.match(message, /could not be confirmed/);
  });

  it("tells the administrator to review the current capacity first", () => {
    assert.match(message, /review|check/i);
    assert.match(message, /capacity/i);
  });

  it("does not claim specifically that the API did not answer", () => {
    // `unavailable` also covers a 5xx, an unusable 2xx body and an unexpected
    // status, in all of which the API did answer.
    assert.doesNotMatch(message, /did not answer|no answer|did not respond/i);
  });

  it("does not unconditionally claim the detail was re-read", () => {
    // The read that follows the redirect can itself be unavailable.
    for (const forbidden of [/just been re-read/i, /has been refreshed/i, /the capacity below shows/i]) {
      assert.doesNotMatch(message, forbidden, `capacity-uncertain must not match ${forbidden}`);
    }
  });

  it("accounts for the room type not being shown below", () => {
    assert.match(message, /not shown below|not available below|cannot be loaded/i);
    assert.match(message, /reload/i);
  });

  it("never claims the change failed or invites an immediate resubmit", () => {
    for (const forbidden of [/\bfailed\b/i, /was not saved/i, /try again/i, /resubmit/i]) {
      assert.doesNotMatch(message, forbidden, `capacity-uncertain must not match ${forbidden}`);
    }
  });

  it("carries no interpolation placeholder", () => {
    assert.doesNotMatch(message, /\$\{|%s|\{\{|<%/);
  });
});

describe("the detail page renders every physical-room notice", () => {
  const tokens = Object.keys(PHYSICAL_ROOM_NOTICES) as (keyof typeof PHYSICAL_ROOM_NOTICES)[];

  it("declares all thirteen tokens the room actions can produce", () => {
    assert.deepEqual(tokens.slice().sort(), [
      "room-activated",
      "room-add-refused",
      "room-add-uncertain",
      "room-added",
      "room-deactivated",
      "room-has-future-reservations",
      "room-not-found",
      "room-number-taken",
      "room-rename-refused",
      "room-rename-uncertain",
      "room-renamed",
      "room-status-refused",
      "room-status-uncertain",
    ]);
  });

  for (const token of tokens) {
    it(`accepts ${token}`, () => {
      assert.equal(parseNoticeToken({ action: token }, PHYSICAL_ROOM_NOTICES), token);
    });
  }

  it("rejects room-type tokens and unknown ones", () => {
    for (const action of ["saved", "created", "capacity-saved", "create-uncertain", "nope"] as const) {
      assert.equal(parseNoticeToken({ action }, PHYSICAL_ROOM_NOTICES), null);
    }
  });

  it("keeps the two token sets disjoint, so one URL cannot mean two things", () => {
    for (const token of tokens) {
      assert.equal(parseRoomTypeNotice({ action: token }), null, token);
    }
  });
});

describe("the room-number-taken wording", () => {
  const message = PHYSICAL_ROOM_NOTICES["room-number-taken"].message;

  it("says the number is already in use", () => {
    assert.match(message, /already in use/i);
  });

  it("makes clear uniqueness is hotel-wide, not per room type", () => {
    assert.match(message, /whole hotel|across the hotel|hotel-wide/i);
    assert.doesNotMatch(message, /in this room type|within this room type|for this room type/i);
  });

  it("mentions that capitalisation does not make a different number", () => {
    assert.match(message, /capitalisation|capitalization|letter case/i);
  });

  it("echoes no room number", () => {
    assert.doesNotMatch(message, /\$\{|%s|\{\{|<%/);
  });
});

describe("the room-not-found wording", () => {
  const message = PHYSICAL_ROOM_NOTICES["room-not-found"].message;

  it("is neutral about why the room is no longer there", () => {
    // Rooms are never deleted by this system, and guessing at a cause would
    // be inventing one.
    assert.doesNotMatch(message, /deleted|removed|was renamed by/i);
  });

  it("instructs a review of the current inventory", () => {
    assert.match(message, /review|check/i);
    assert.match(message, /room list|inventory|rooms/i);
  });

  it("does not claim the list was already re-read", () => {
    assert.doesNotMatch(message, /just been re-read|has been refreshed/i);
  });
});

describe("the room-has-future-reservations wording", () => {
  const message = PHYSICAL_ROOM_NOTICES["room-has-future-reservations"].message;

  it("explains the conflict is a current or upcoming booked stay", () => {
    assert.match(message, /current or upcoming/i);
    assert.match(message, /reservation/i);
  });

  it("does not imply a cancelled or ended stay blocks the change", () => {
    // The API's rule is status IN ('pending','confirmed') AND check_out >
    // CURRENT_DATE, so neither of those blocks anything.
    assert.match(message, /pending or confirmed/i);
    assert.doesNotMatch(message, /any reservation\b|all reservations/i);
  });

  it("says the reservation itself is not shown here", () => {
    assert.match(message, /not shown here/i);
  });

  it("carries no count, reference, guest or date", () => {
    assert.doesNotMatch(message, /\d/, "no count or date");
    assert.doesNotMatch(message, /TPH-/, "no booking reference");
    assert.doesNotMatch(message, /\$\{|%s|\{\{|<%/, "no interpolation placeholder");
  });

  it("does not offer reassignment, which does not exist", () => {
    assert.match(message, /cannot be moved/i);
    assert.doesNotMatch(message, /reassign|move it to another room\b(?! )/i);
  });
});

describe("the three physical-room uncertain messages", () => {
  const uncertain = [
    "room-add-uncertain",
    "room-rename-uncertain",
    "room-status-uncertain",
  ] as const;

  for (const token of uncertain) {
    const message = PHYSICAL_ROOM_NOTICES[token].message;

    describe(token, () => {
      it("says the outcome could not be confirmed", () => {
        assert.match(message, /could not be confirmed/);
        assert.match(message, /may or may not/i);
      });

      it("instructs a review before another change", () => {
        assert.match(message, /review|check/i);
        assert.match(message, /rooms|inventory/i);
      });

      it("accounts for the inventory itself being unavailable", () => {
        assert.match(message, /not shown below|not available below|cannot be loaded/i);
        assert.match(message, /reload/i);
      });

      it("does not claim specifically that the API did not answer", () => {
        // `unavailable` also covers a 5xx, an unusable 2xx body and an
        // unexpected status, in all of which the API did answer.
        assert.doesNotMatch(message, /did not answer|did not respond|no answer/i);
      });

      it("does not unconditionally claim the rooms were re-read", () => {
        for (const forbidden of [/refreshed list/i, /just been re-read/i, /has been refreshed/i]) {
          assert.doesNotMatch(message, forbidden, `${token} must not match ${forbidden}`);
        }
      });

      it("never claims the change failed or invites an immediate resubmit", () => {
        for (const forbidden of [
          /\bfailed\b/i,
          /was not added/i,
          /was not renamed/i,
          /was not changed/i,
          /try again/i,
          /resubmit/i,
        ]) {
          assert.doesNotMatch(message, forbidden, `${token} must not match ${forbidden}`);
        }
      });

      it("carries no interpolation placeholder", () => {
        assert.doesNotMatch(message, /\$\{|%s|\{\{|<%/);
      });

      it("is a warning rather than a confirmation", () => {
        assert.equal(PHYSICAL_ROOM_NOTICES[token].tone, "warn");
      });
    });
  }
});

describe("the create-page wording", () => {
  it("explains a refused submission without blaming the API", () => {
    const message = ROOM_TYPE_CREATE_NOTICES["create-refused"].message;

    assert.match(message, /not created/i);
    assert.doesNotMatch(message, /could not be reached|unavailable/i);
  });

  it("explains a taken reference and that references are permanent", () => {
    const message = ROOM_TYPE_CREATE_NOTICES["create-slug-taken"].message;

    assert.match(message, /already in use/i);
    assert.match(message, /permanent/i);
  });
});
