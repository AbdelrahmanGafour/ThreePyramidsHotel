import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCreatedReservation, parseCalendarDateUTC, type CreatedReservation } from "./reservationContract";

// Pure: no network, no storage, no React. This is the ONE validator shared by
// the POST 201 response (reservations.ts) and sessionStorage confirmation
// hydration (BookingContext.tsx) — see reservationContract.ts's header.

const VALID: CreatedReservation = {
  bookingReference: "TPH-A2B3C4D5E6F7",
  status: "pending",
  roomType: { slug: "room-concept-01", name: "Room concept 01" },
  checkIn: "2026-10-10",
  checkOut: "2026-10-12",
  nights: 2,
  adults: 2,
  children: 1,
  nightlyRate: "1000.00",
  totalAmount: "2000.00",
  currency: "EGP",
};

function withField(overrides: Record<string, unknown>): unknown {
  return { ...VALID, ...overrides };
}

describe("isCreatedReservation", () => {
  it("accepts a valid backend reservation shape", () => {
    assert.equal(isCreatedReservation(VALID), true);
  });

  it("accepts a valid shape with zero children", () => {
    assert.equal(isCreatedReservation(withField({ children: 0 })), true);
  });

  it("rejects null/undefined/non-object values", () => {
    assert.equal(isCreatedReservation(null), false);
    assert.equal(isCreatedReservation(undefined), false);
    assert.equal(isCreatedReservation("TPH-A2B3C4D5E6F7"), false);
    assert.equal(isCreatedReservation(42), false);
    assert.equal(isCreatedReservation([]), false);
  });

  describe("bookingReference", () => {
    for (const bad of ["", "not-a-reference", "tph-a2b3c4d5e6f7", "TPH-A2B3C4D5E6F", "DEMO-000000000001"]) {
      it(`rejects ${JSON.stringify(bad)}`, () => {
        assert.equal(isCreatedReservation(withField({ bookingReference: bad })), false);
      });
    }
    it("rejects a missing bookingReference", () => {
      const { bookingReference, ...rest } = VALID;
      void bookingReference;
      assert.equal(isCreatedReservation(rest), false);
    });
  });

  describe("status", () => {
    for (const bad of ["confirmed", "cancelled", "Pending", "", null, 1]) {
      it(`rejects status ${JSON.stringify(bad)}`, () => {
        assert.equal(isCreatedReservation(withField({ status: bad })), false);
      });
    }
  });

  describe("roomType", () => {
    it("rejects a missing roomType", () => {
      assert.equal(isCreatedReservation(withField({ roomType: undefined })), false);
    });
    it("rejects a null roomType", () => {
      assert.equal(isCreatedReservation(withField({ roomType: null })), false);
    });
    it("rejects an empty slug", () => {
      assert.equal(isCreatedReservation(withField({ roomType: { slug: "", name: "Room concept 01" } })), false);
    });
    it("rejects an empty name", () => {
      assert.equal(isCreatedReservation(withField({ roomType: { slug: "room-concept-01", name: "" } })), false);
    });
    it("rejects a non-string slug", () => {
      assert.equal(isCreatedReservation(withField({ roomType: { slug: 1, name: "Room concept 01" } })), false);
    });
  });

  describe("dates", () => {
    it("rejects a malformed checkIn string", () => {
      assert.equal(isCreatedReservation(withField({ checkIn: "10/10/2026" })), false);
    });
    it("rejects an impossible calendar date (2026-02-30)", () => {
      assert.equal(isCreatedReservation(withField({ checkIn: "2026-02-28", checkOut: "2026-02-30" })), false);
    });
    it("rejects checkOut equal to checkIn", () => {
      assert.equal(isCreatedReservation(withField({ checkOut: "2026-10-10", nights: 0 })), false);
    });
    it("rejects checkOut before checkIn", () => {
      assert.equal(isCreatedReservation(withField({ checkIn: "2026-10-12", checkOut: "2026-10-10" })), false);
    });
    it("rejects a non-string date", () => {
      assert.equal(isCreatedReservation(withField({ checkIn: 20261010 })), false);
    });
  });

  describe("nights/adults/children", () => {
    it("rejects nights that disagree with the check-in/check-out interval", () => {
      assert.equal(isCreatedReservation(withField({ nights: 3 })), false);
    });
    it("rejects zero nights", () => {
      assert.equal(isCreatedReservation(withField({ nights: 0, checkOut: "2026-10-10" })), false);
    });
    it("rejects a fractional nights value", () => {
      assert.equal(isCreatedReservation(withField({ nights: 1.5 })), false);
    });
    it("rejects zero adults", () => {
      assert.equal(isCreatedReservation(withField({ adults: 0 })), false);
    });
    it("rejects negative children", () => {
      assert.equal(isCreatedReservation(withField({ children: -1 })), false);
    });
    it("rejects a non-integer adults value", () => {
      assert.equal(isCreatedReservation(withField({ adults: 2.5 })), false);
    });
    it("rejects an unsafe adults+children sum", () => {
      assert.equal(
        isCreatedReservation(withField({ adults: Number.MAX_SAFE_INTEGER, children: Number.MAX_SAFE_INTEGER })),
        false,
      );
    });
  });

  describe("money", () => {
    for (const bad of ["-100.00", "1000", "1000.0", "1000.000", "abc", "", "1,000.00"]) {
      it(`rejects nightlyRate ${JSON.stringify(bad)}`, () => {
        assert.equal(isCreatedReservation(withField({ nightlyRate: bad })), false);
      });
      it(`rejects totalAmount ${JSON.stringify(bad)}`, () => {
        assert.equal(isCreatedReservation(withField({ totalAmount: bad })), false);
      });
    }
    it("rejects a numeric (non-string) nightlyRate — money must stay an exact string", () => {
      assert.equal(isCreatedReservation(withField({ nightlyRate: 1000 })), false);
    });
  });

  describe("currency", () => {
    for (const bad of ["USD", "egp", "", null]) {
      it(`rejects currency ${JSON.stringify(bad)}`, () => {
        assert.equal(isCreatedReservation(withField({ currency: bad })), false);
      });
    }
  });

  it("rejects the legacy/fake confirmation shape from before the real reservation contract existed", () => {
    // A plausible pre-WFI-T07 fake confirmation: a made-up reference, no
    // real room type object, and prices as numbers instead of decimal strings.
    const legacy = {
      bookingReference: "BK-12345",
      status: "pending",
      roomType: "Deluxe Room",
      checkIn: "2026-10-10",
      checkOut: "2026-10-12",
      nights: 2,
      adults: 2,
      children: 0,
      nightlyRate: 1000,
      totalAmount: 2000,
      currency: "EGP",
    };
    assert.equal(isCreatedReservation(legacy), false);
  });
});

describe("parseCalendarDateUTC", () => {
  it("accepts a real calendar date", () => {
    assert.equal(parseCalendarDateUTC("2026-10-10"), Date.UTC(2026, 9, 10));
  });
  it("rejects an impossible date instead of rolling over (Date's default behavior)", () => {
    assert.equal(parseCalendarDateUTC("2026-02-30"), null);
  });
  it("rejects a malformed string", () => {
    assert.equal(parseCalendarDateUTC("2026/10/10"), null);
    assert.equal(parseCalendarDateUTC("not-a-date"), null);
    assert.equal(parseCalendarDateUTC(""), null);
  });
});
