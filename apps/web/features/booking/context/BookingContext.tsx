"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { isValidStayRange } from "@/features/booking/lib/dates";
import {
  emptyGuestDetails,
  type AvailabilitySnapshot,
  type BookingConfirmation,
  type BookingState,
  type GuestDetails,
} from "@/features/booking/types";

// Versioned so a session saved under the old multi-room shape isn't restored into the one-room model.
// WFI-T05 adds `availabilitySnapshot` (purely additive, nullable): an old v2
// session restored via HYDRATE's `{...initialState, ...parsed}` merge simply
// gets `null` for it from initialState, so no version bump is needed here.
const STORAGE_KEY = "tph-booking-state:v2";

const initialState: BookingState = {
  checkIn: null,
  checkOut: null,
  adults: 2,
  children: 0,
  selectedRoomSlug: null,
  availabilitySnapshot: null,
  guest: emptyGuestDetails,
  termsAccepted: false,
  confirmation: null,
};

type BookingAction =
  | { type: "SET_STAY"; checkIn: string | null; checkOut: string | null; adults: number; children: number }
  | { type: "SELECT_ROOM"; slug: string; snapshot: AvailabilitySnapshot | null }
  | { type: "SET_GUEST"; guest: GuestDetails }
  | { type: "SET_TERMS_ACCEPTED"; accepted: boolean }
  | { type: "CONFIRM_BOOKING"; confirmation: BookingConfirmation }
  | { type: "RESET" }
  | { type: "HYDRATE"; state: BookingState };

function bookingReducer(state: BookingState, action: BookingAction): BookingState {
  switch (action.type) {
    case "SET_STAY": {
      const unchanged =
        state.checkIn === action.checkIn &&
        state.checkOut === action.checkOut &&
        state.adults === action.adults &&
        state.children === action.children;

      return {
        ...state,
        checkIn: action.checkIn,
        checkOut: action.checkOut,
        adults: action.adults,
        children: action.children,
        // `selectedRoomSlug` is preserved either way (keeps a provisional
        // ?room= preselection or a prior choice visible/highlighted). Only
        // the live snapshot is invalidated when criteria actually changed —
        // `hasSelectedRoom` below requires a snapshot matching the CURRENT
        // stay, so a changed stay can never count as a completed selection
        // even though the slug is still remembered.
        availabilitySnapshot: unchanged ? state.availabilitySnapshot : null,
        // Editing the stay after a previous confirmation (without resetting
        // via "Return to the hotel") means this is a new attempt — the old
        // reference must not carry over and render as if it were current.
        confirmation: null,
      };
    }
    case "SELECT_ROOM":
      return { ...state, selectedRoomSlug: action.slug, availabilitySnapshot: action.snapshot, confirmation: null };
    case "SET_GUEST":
      return { ...state, guest: action.guest, confirmation: null };
    case "SET_TERMS_ACCEPTED":
      return { ...state, termsAccepted: action.accepted };
    case "CONFIRM_BOOKING":
      return { ...state, confirmation: action.confirmation };
    case "RESET":
      return initialState;
    case "HYDRATE":
      return action.state;
    default:
      return state;
  }
}

type BookingContextValue = {
  state: BookingState;
  hydrated: boolean;
  setStay: (input: { checkIn: string; checkOut: string; adults: number; children: number }) => void;
  selectRoom: (slug: string, snapshot?: AvailabilitySnapshot | null) => void;
  setGuest: (guest: GuestDetails) => void;
  setTermsAccepted: (accepted: boolean) => void;
  confirmBooking: (confirmation: BookingConfirmation) => void;
  reset: () => void;
  hasValidStay: boolean;
  hasSelectedRoom: boolean;
  hasGuestDetails: boolean;
};

/**
 * A selection only counts as complete once a live availability snapshot
 * backs it for the CURRENT stay — a bare `selectedRoomSlug` (from a
 * provisional ?room= preselection, or an old v2 session restored without a
 * snapshot) is not enough. This lets both cases recover safely instead of
 * being treated as an already-confirmed choice. The snapshot is workflow/
 * display state only — never proof of current inventory.
 */
function hasCompleteRoomSelection(state: BookingState): boolean {
  const { selectedRoomSlug, availabilitySnapshot: snapshot } = state;
  if (!selectedRoomSlug || !snapshot) return false;

  return (
    snapshot.roomTypeSlug === selectedRoomSlug &&
    snapshot.checkIn === state.checkIn &&
    snapshot.checkOut === state.checkOut &&
    snapshot.adults === state.adults &&
    snapshot.children === state.children
  );
}

/**
 * WFI-T06 removed `arrivalTime` from `GuestDetails` while keeping the same
 * session key — an old v2 session could still restore it as a stray runtime
 * property via the shallow `{...initialState, ...parsed}` merge. Sanitizes
 * the restored `guest` to exactly the current shape (only this nested
 * object, not the whole session) rather than wiping anything.
 */
function sanitizeGuest(guest: unknown): GuestDetails {
  const raw = (guest && typeof guest === "object" ? guest : {}) as Partial<Record<keyof GuestDetails, unknown>>;
  const asString = (value: unknown): string => (typeof value === "string" ? value : "");

  return {
    firstName: asString(raw.firstName),
    lastName: asString(raw.lastName),
    email: asString(raw.email),
    phone: asString(raw.phone),
    country: asString(raw.country),
    specialRequests: asString(raw.specialRequests),
  };
}

const BookingContext = createContext<BookingContextValue | null>(null);

export function BookingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(bookingReducer, initialState);
  const [hydrated, setHydrated] = useReducer(() => true, false);

  // Restore in-progress bookings within the same browser session only — a
  // genuinely fresh visit (or a different tab/device) still starts empty, so
  // the direct-route guards below are the real source of truth, not this.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        dispatch({ type: "HYDRATE", state: { ...initialState, ...parsed, guest: sanitizeGuest(parsed.guest) } });
      }
    } catch {
      // Ignore unavailable/blocked storage — booking simply starts empty.
    } finally {
      setHydrated();
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore unavailable/blocked storage.
    }
  }, [state, hydrated]);

  const value = useMemo<BookingContextValue>(
    () => ({
      state,
      hydrated,
      setStay: (input) => dispatch({ type: "SET_STAY", ...input }),
      selectRoom: (slug, snapshot = null) => dispatch({ type: "SELECT_ROOM", slug, snapshot }),
      setGuest: (guest) => dispatch({ type: "SET_GUEST", guest }),
      setTermsAccepted: (accepted) => dispatch({ type: "SET_TERMS_ACCEPTED", accepted }),
      confirmBooking: (confirmation) => dispatch({ type: "CONFIRM_BOOKING", confirmation }),
      reset: () => dispatch({ type: "RESET" }),
      // Same rule as the stay form: complete dates, none in the past, check-out after check-in.
      // A restored session whose dates have since passed is therefore treated as having no stay.
      hasValidStay: isValidStayRange(state.checkIn, state.checkOut),
      hasSelectedRoom: hasCompleteRoomSelection(state),
      // Completeness guard only (for restored/direct-entry state) — not a
      // duplicate of validation.ts's detailed format/regex checks.
      hasGuestDetails: Boolean(
        state.guest.firstName &&
          state.guest.lastName &&
          state.guest.email &&
          state.guest.phone &&
          state.guest.country,
      ),
    }),
    [state, hydrated],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBooking() {
  const context = useContext(BookingContext);
  if (!context) throw new Error("useBooking must be used within a BookingProvider");
  return context;
}
