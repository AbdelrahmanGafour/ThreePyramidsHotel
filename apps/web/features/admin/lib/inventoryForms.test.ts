import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCapacityForm,
  parseRoomNumberForm,
  parseRoomTypeCreateForm,
} from "./inventoryForms.js";

// Pure: these are the real parsers the shipping Server Actions call, imported
// directly. They take a standard FormData and return a payload or a refusal —
// no request context, no network.
//
// What they are NOT is a second copy of the API's validation contract. Nothing
// here asserts a length, a pattern or a PostgreSQL range, because none of that
// is this layer's to decide.

/** Builds a FormData from plain entries, as a submitted form produces. */
function form(entries: Record<string, string>): FormData {
  const data = new FormData();

  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }

  return data;
}

const REQUIRED = {
  slug: "garden-suite",
  name: "Garden Suite",
  capacity: "3",
  baseNightlyRate: "2400.50",
};

describe("parseRoomTypeCreateForm", () => {
  it("builds the payload from the required fields alone", () => {
    const parsed = parseRoomTypeCreateForm(form(REQUIRED));

    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, {
      slug: "garden-suite",
      name: "Garden Suite",
      capacity: 3,
      baseNightlyRate: "2400.50",
      sortOrder: 0,
      shortDescription: null,
      description: null,
      bedType: null,
      bedCount: null,
      sizeSqm: null,
      view: null,
    });
  });

  it("passes the slug through byte for byte", () => {
    // Not trimmed, not lower-cased: the slug is the permanent public address,
    // and tidying it would create the room type somewhere else.
    for (const slug of ["  garden-suite  ", "Garden-Suite", "GARDEN", "garden suite"]) {
      const parsed = parseRoomTypeCreateForm(form({ ...REQUIRED, slug }));

      assert.ok(parsed.ok);
      assert.equal(parsed.value.slug, slug, "the API owns whether this is a slug");
    }
  });

  it("passes the name through untrimmed", () => {
    const parsed = parseRoomTypeCreateForm(form({ ...REQUIRED, name: "  Garden Suite  " }));

    assert.ok(parsed.ok);
    assert.equal(parsed.value.name, "  Garden Suite  ");
  });

  it("keeps money as a string, never a number", () => {
    for (const rate of ["2400.50", "0", "0.00", "9999999999.99"]) {
      const parsed = parseRoomTypeCreateForm(form({ ...REQUIRED, baseNightlyRate: rate }));

      assert.ok(parsed.ok);
      assert.equal(typeof parsed.value.baseNightlyRate, "string");
      assert.equal(parsed.value.baseNightlyRate, rate);
    }
  });

  it("keeps sizeSqm as an exact string", () => {
    const parsed = parseRoomTypeCreateForm(form({ ...REQUIRED, sizeSqm: "42.50" }));

    assert.ok(parsed.ok);
    assert.equal(parsed.value.sizeSqm, "42.50");
    assert.equal(typeof parsed.value.sizeSqm, "string");
  });

  it("sends null for an omitted descriptive field and the string for a present one", () => {
    const omitted = parseRoomTypeCreateForm(form(REQUIRED));
    assert.ok(omitted.ok);
    assert.equal(omitted.value.shortDescription, null);
    assert.equal(omitted.value.description, null);
    assert.equal(omitted.value.bedType, null);
    assert.equal(omitted.value.view, null);

    const present = parseRoomTypeCreateForm(
      form({ ...REQUIRED, shortDescription: "  A quiet floor.  ", view: "Plateau" }),
    );
    assert.ok(present.ok);
    // Verbatim: the API owns empty -> null and trimming.
    assert.equal(present.value.shortDescription, "  A quiet floor.  ");
    assert.equal(present.value.view, "Plateau");
  });

  it("keeps an empty descriptive field as an empty string", () => {
    const parsed = parseRoomTypeCreateForm(form({ ...REQUIRED, description: "" }));

    assert.ok(parsed.ok);
    assert.equal(parsed.value.description, "", "the backend normalises empty to null");
  });

  it("turns an empty or omitted bedCount into null", () => {
    for (const entries of [REQUIRED, { ...REQUIRED, bedCount: "" }, { ...REQUIRED, bedCount: "   " }]) {
      const parsed = parseRoomTypeCreateForm(form(entries));

      assert.ok(parsed.ok);
      assert.equal(parsed.value.bedCount, null);
    }
  });

  it("turns a present bedCount into a number", () => {
    const parsed = parseRoomTypeCreateForm(form({ ...REQUIRED, bedCount: "2" }));

    assert.ok(parsed.ok);
    assert.equal(parsed.value.bedCount, 2);
  });

  it("defaults an empty or omitted sortOrder to 0", () => {
    for (const entries of [REQUIRED, { ...REQUIRED, sortOrder: "" }, { ...REQUIRED, sortOrder: "  " }]) {
      const parsed = parseRoomTypeCreateForm(form(entries));

      assert.ok(parsed.ok);
      assert.equal(parsed.value.sortOrder, 0, "an empty entry must not be read as a missing field");
    }
  });

  it("turns a present sortOrder into a number, including an explicit 0", () => {
    const explicit = parseRoomTypeCreateForm(form({ ...REQUIRED, sortOrder: "0" }));
    assert.ok(explicit.ok);
    assert.equal(explicit.value.sortOrder, 0);

    const seventh = parseRoomTypeCreateForm(form({ ...REQUIRED, sortOrder: "7" }));
    assert.ok(seventh.ok);
    assert.equal(seventh.value.sortOrder, 7);
  });

  it("does not round or clamp a number the API will refuse", () => {
    const parsed = parseRoomTypeCreateForm(form({ ...REQUIRED, capacity: "2.5" }));

    assert.ok(parsed.ok);
    assert.equal(parsed.value.capacity, 2.5, "silently storing 2 or 3 would be worse than a refusal");
  });

  it("does not enforce the API's ranges", () => {
    // Far past int4, and zero. Both are the API's to refuse.
    const huge = parseRoomTypeCreateForm(form({ ...REQUIRED, capacity: "2147483648" }));
    assert.ok(huge.ok);
    assert.equal(huge.value.capacity, 2147483648);

    const zero = parseRoomTypeCreateForm(form({ ...REQUIRED, capacity: "0" }));
    assert.ok(zero.ok);
    assert.equal(zero.value.capacity, 0);
  });

  describe("refuses locally, without issuing a request", () => {
    for (const field of ["slug", "name", "capacity", "baseNightlyRate"] as const) {
      it(`a missing ${field}`, () => {
        const entries: Record<string, string> = { ...REQUIRED };
        delete entries[field];

        assert.deepEqual(parseRoomTypeCreateForm(form(entries)), { ok: false });
      });
    }

    for (const [label, value] of [
      ["text", "three"],
      ["empty", ""],
      ["whitespace", "   "],
      ["Infinity", "Infinity"],
      ["NaN", "NaN"],
    ] as const) {
      it(`a capacity that is ${label}`, () => {
        assert.deepEqual(parseRoomTypeCreateForm(form({ ...REQUIRED, capacity: value })), {
          ok: false,
        });
      });
    }

    it("an unrepresentable bedCount", () => {
      assert.deepEqual(parseRoomTypeCreateForm(form({ ...REQUIRED, bedCount: "two" })), { ok: false });
    });

    it("an unrepresentable sortOrder", () => {
      assert.deepEqual(parseRoomTypeCreateForm(form({ ...REQUIRED, sortOrder: "first" })), {
        ok: false,
      });
    });

    it("a required field submitted as a file rather than text", () => {
      const data = form(REQUIRED);
      data.set("name", new File(["x"], "name.txt"));

      assert.deepEqual(parseRoomTypeCreateForm(data), { ok: false });
    });
  });

  describe("reads only the eleven allowed fields", () => {
    it("ignores every server-controlled key", () => {
      const data = form({
        ...REQUIRED,
        isActive: "true",
        id: "42",
        roomCount: "9",
        currency: "USD",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        roomNumber: "D-101",
        somethingElse: "x",
      });

      const parsed = parseRoomTypeCreateForm(data);

      assert.ok(parsed.ok);
      assert.deepEqual(Object.keys(parsed.value).sort(), [
        "baseNightlyRate",
        "bedCount",
        "bedType",
        "capacity",
        "description",
        "name",
        "shortDescription",
        "sizeSqm",
        "slug",
        "sortOrder",
        "view",
      ]);
      assert.ok(!("isActive" in parsed.value), "creation always yields a draft");
    });

    it("does not let an extra key change an allowed value", () => {
      const data = form({ ...REQUIRED, isActive: "true", currency: "USD" });
      const parsed = parseRoomTypeCreateForm(data);

      assert.ok(parsed.ok);
      assert.equal(parsed.value.slug, "garden-suite");
      assert.equal(parsed.value.capacity, 3);
    });
  });
});

describe("parseCapacityForm", () => {
  it("reads a finite number", () => {
    assert.deepEqual(parseCapacityForm(form({ capacity: "4" })), { ok: true, value: 4 });
  });

  it("does not round a fractional value", () => {
    assert.deepEqual(parseCapacityForm(form({ capacity: "2.5" })), { ok: true, value: 2.5 });
  });

  it("does not clamp a value past the API's range", () => {
    assert.deepEqual(parseCapacityForm(form({ capacity: "2147483648" })), {
      ok: true,
      value: 2147483648,
    });
    assert.deepEqual(parseCapacityForm(form({ capacity: "0" })), { ok: true, value: 0 });
    assert.deepEqual(parseCapacityForm(form({ capacity: "-1" })), { ok: true, value: -1 });
  });

  describe("refuses locally", () => {
    for (const [label, entries] of [
      ["an absent field", {}],
      ["an empty value", { capacity: "" }],
      ["whitespace", { capacity: "   " }],
      ["text", { capacity: "four" }],
      ["Infinity", { capacity: "Infinity" }],
      ["NaN", { capacity: "NaN" }],
    ] as const) {
      it(label, () => {
        assert.deepEqual(parseCapacityForm(form(entries)), { ok: false });
      });
    }
  });

  it("reads nothing but capacity", () => {
    const parsed = parseCapacityForm(form({ capacity: "4", isActive: "false", slug: "elsewhere" }));

    assert.deepEqual(parsed, { ok: true, value: 4 });
  });
});

describe("parseRoomNumberForm", () => {
  it("passes the room number through byte for byte", () => {
    for (const roomNumber of ["D-101", "d-101", "Ph-Suite", "Suite 4", "  D-101  ", "D/101", ""]) {
      assert.deepEqual(
        parseRoomNumberForm(form({ roomNumber })),
        { ok: true, value: roomNumber },
        "the API owns trimming and what a room number may be",
      );
    }
  });

  it("refuses an absent field", () => {
    assert.deepEqual(parseRoomNumberForm(form({})), { ok: false });
  });

  it("refuses a file", () => {
    const data = new FormData();
    data.set("roomNumber", new File(["x"], "n.txt"));

    assert.deepEqual(parseRoomNumberForm(data), { ok: false });
  });

  it("reads nothing but roomNumber", () => {
    const parsed = parseRoomNumberForm(form({ roomNumber: "D-101", isActive: "false", id: "42" }));

    assert.deepEqual(parsed, { ok: true, value: "D-101" });
  });
});
