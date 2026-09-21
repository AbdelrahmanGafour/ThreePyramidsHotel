import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bookingReducer, buildHydratedState } from "./BookingContext";
import type { BookingState } from "@/features/booking/types";

// Pure: `buildHydratedState` is exactly what the mount effect feeds into
// `dispatch({ type: "HYDRATE", ... })` — no storage, no React rendering
// needed to exercise it.

const VALID_CONFIRMATION = {
  bookingReference: "TPH-A2B3C4D5E6F7",
  status: "pending" as const,
  roomType: { slug: "room-concept-01", name: "Room concept 01" },
  checkIn: "2026-10-10",
  checkOut: "2026-10-12",
  nights: 2,
  adults: 2,
  children: 0,
  nightlyRate: "1000.00",
  totalAmount: "2000.00",
  currency: "EGP" as const,
};

describe("buildHydratedState — confirmation", () => {
  it("a valid confirmation survives sanitization unchanged", () => {
    const state = buildHydratedState({ checkIn: "2026-10-10", confirmation: VALID_CONFIRMATION });
    assert.deepEqual(state.confirmation, VALID_CONFIRMATION);
  });

  it("a legacy/pre-contract confirmation shape is rejected (becomes null)", () => {
    // Shape from before WFI-T07: a made-up reference, room type as a bare
    // string, and prices as numbers instead of the backend's decimal strings.
    const legacyConfirmation = {
      bookingReference: "BK-99999",
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

    const state = buildHydratedState({ checkIn: "2026-10-10", confirmation: legacyConfirmation });
    assert.equal(state.confirmation, null);
  });

  it("a malformed confirmation becomes null WITHOUT wiping unrelated restored booking state", () => {
    const state = buildHydratedState({
      checkIn: "2026-10-10",
      checkOut: "2026-10-12",
      adults: 3,
      children: 1,
      guest: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+20", country: "Egypt" },
      termsAccepted: true,
      confirmation: { bookingReference: "not-a-real-reference" },
    });

    assert.equal(state.confirmation, null);
    assert.equal(state.checkIn, "2026-10-10");
    assert.equal(state.checkOut, "2026-10-12");
    assert.equal(state.adults, 3);
    assert.equal(state.children, 1);
    assert.equal(state.guest.firstName, "Ada");
    assert.equal(state.termsAccepted, true);
  });

  it("invalid confirmation sanitization does not wipe an already-persisted uncertainty flag", () => {
    const state = buildHydratedState({
      checkIn: "2026-10-10",
      reservationSubmissionUncertain: true,
      confirmation: { bookingReference: "not-a-real-reference" },
    });

    assert.equal(state.confirmation, null);
    assert.equal(state.reservationSubmissionUncertain, true);
  });

  it("a missing confirmation restores as null", () => {
    const state = buildHydratedState({ checkIn: "2026-10-10" });
    assert.equal(state.confirmation, null);
  });

  it("a non-object raw value restores as the untouched initial state", () => {
    const state = buildHydratedState("not-an-object");
    assert.equal(state.confirmation, null);
    assert.equal(state.checkIn, null);
    assert.equal(state.adults, 2);
  });
});

describe("buildHydratedState — guest sanitization", () => {
  it("strips stray legacy properties (e.g. removed arrivalTime) from guest", () => {
    const state = buildHydratedState({
      guest: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "+20",
        country: "Egypt",
        specialRequests: "",
        arrivalTime: "14:00",
      },
    });

    assert.equal((state.guest as Record<string, unknown>).arrivalTime, undefined);
    assert.equal(state.guest.firstName, "Ada");
  });
});

// PR #17: the uncertain-submission lock must be a PERSISTED field, not local
// component state — otherwise a BookingSummary remount/navigation/refresh
// would silently drop it and allow a second POST after an unproven outcome.
describe("buildHydratedState — reservationSubmissionUncertain sanitization", () => {
  it("an old session with no uncertainty field restores as false", () => {
    const state = buildHydratedState({ checkIn: "2026-10-10" });
    assert.equal(state.reservationSubmissionUncertain, false);
  });

  it("a persisted true survives hydration", () => {
    const state = buildHydratedState({ checkIn: "2026-10-10", reservationSubmissionUncertain: true });
    assert.equal(state.reservationSubmissionUncertain, true);
  });

  it("a persisted false restores as false", () => {
    const state = buildHydratedState({ reservationSubmissionUncertain: false });
    assert.equal(state.reservationSubmissionUncertain, false);
  });

  for (const malformed of ["true", 1, {}, [], null, "1", "yes"]) {
    it(`a malformed value ${JSON.stringify(malformed)} restores as false, not true`, () => {
      const state = buildHydratedState({ reservationSubmissionUncertain: malformed });
      assert.equal(state.reservationSubmissionUncertain, false);
    });
  }
});

// bookingReducer itself: exercises exactly what PR #17 requires — the flag
// is set only by MARK_RESERVATION_UNCERTAIN, cleared only by RESET or a
// successful CONFIRM_BOOKING, and left untouched by every other action that
// edits stay/room/guest/terms.
describe("bookingReducer — reservationSubmissionUncertain", () => {
  const baseState: BookingState = {
    checkIn: "2026-10-10",
    checkOut: "2026-10-12",
    adults: 2,
    children: 0,
    selectedRoomSlug: "room-concept-01",
    availabilitySnapshot: null,
    guest: {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "+201000000000",
      country: "Egypt",
      specialRequests: "",
    },
    termsAccepted: true,
    confirmation: null,
    reservationSubmissionUncertain: false,
  };

  it("MARK_RESERVATION_UNCERTAIN sets the flag true and touches nothing else", () => {
    const next = bookingReducer(baseState, { type: "MARK_RESERVATION_UNCERTAIN" });

    assert.equal(next.reservationSubmissionUncertain, true);
    assert.deepEqual(next.guest, baseState.guest);
    assert.equal(next.termsAccepted, true);
    assert.equal(next.confirmation, null);
    assert.equal(next.checkIn, baseState.checkIn);
  });

  it("a successful CONFIRM_BOOKING clears a prior uncertainty flag", () => {
    const uncertainState: BookingState = { ...baseState, reservationSubmissionUncertain: true };
    const confirmation = {
      bookingReference: "TPH-A2B3C4D5E6F7",
      status: "pending" as const,
      roomType: { slug: "room-concept-01", name: "Room concept 01" },
      checkIn: "2026-10-10",
      checkOut: "2026-10-12",
      nights: 2,
      adults: 2,
      children: 0,
      nightlyRate: "1000.00",
      totalAmount: "2000.00",
      currency: "EGP" as const,
    };

    const next = bookingReducer(uncertainState, { type: "CONFIRM_BOOKING", confirmation });

    assert.equal(next.reservationSubmissionUncertain, false);
    assert.deepEqual(next.confirmation, confirmation);
  });

  it("RESET clears the flag back to the default false", () => {
    const uncertainState: BookingState = { ...baseState, reservationSubmissionUncertain: true };
    const next = bookingReducer(uncertainState, { type: "RESET" });
    assert.equal(next.reservationSubmissionUncertain, false);
  });

  it("SET_STAY does not clear an existing uncertainty flag", () => {
    const uncertainState: BookingState = { ...baseState, reservationSubmissionUncertain: true };
    const next = bookingReducer(uncertainState, {
      type: "SET_STAY",
      checkIn: "2026-11-01",
      checkOut: "2026-11-03",
      adults: 2,
      children: 0,
    });
    assert.equal(next.reservationSubmissionUncertain, true);
  });

  it("SELECT_ROOM does not clear an existing uncertainty flag", () => {
    const uncertainState: BookingState = { ...baseState, reservationSubmissionUncertain: true };
    const next = bookingReducer(uncertainState, { type: "SELECT_ROOM", slug: "room-concept-02", snapshot: null });
    assert.equal(next.reservationSubmissionUncertain, true);
  });

  it("SET_GUEST does not clear an existing uncertainty flag", () => {
    const uncertainState: BookingState = { ...baseState, reservationSubmissionUncertain: true };
    const next = bookingReducer(uncertainState, { type: "SET_GUEST", guest: baseState.guest });
    assert.equal(next.reservationSubmissionUncertain, true);
  });

  it("SET_TERMS_ACCEPTED does not clear an existing uncertainty flag", () => {
    const uncertainState: BookingState = { ...baseState, reservationSubmissionUncertain: true };
    const next = bookingReducer(uncertainState, { type: "SET_TERMS_ACCEPTED", accepted: false });
    assert.equal(next.reservationSubmissionUncertain, true);
  });
});
