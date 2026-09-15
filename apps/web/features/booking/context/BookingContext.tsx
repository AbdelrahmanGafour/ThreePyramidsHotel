"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { isValidStayRange } from "@/features/booking/lib/dates";
import { emptyGuestDetails, type BookingConfirmation, type BookingState, type GuestDetails } from "@/features/booking/types";

// Versioned so a session saved under the old multi-room shape isn't restored into the one-room model.
const STORAGE_KEY = "tph-booking-state:v2";

const initialState: BookingState = {
  checkIn: null,
  checkOut: null,
  adults: 2,
  children: 0,
  selectedRoomSlug: null,
  guest: emptyGuestDetails,
  termsAccepted: false,
  confirmation: null,
};

type BookingAction =
  | { type: "SET_STAY"; checkIn: string | null; checkOut: string | null; adults: number; children: number }
  | { type: "SELECT_ROOM"; slug: string }
  | { type: "SET_GUEST"; guest: GuestDetails }
  | { type: "SET_TERMS_ACCEPTED"; accepted: boolean }
  | { type: "CONFIRM_BOOKING"; confirmation: BookingConfirmation }
  | { type: "RESET" }
  | { type: "HYDRATE"; state: BookingState };

function bookingReducer(state: BookingState, action: BookingAction): BookingState {
  switch (action.type) {
    case "SET_STAY":
      return {
        ...state,
        checkIn: action.checkIn,
        checkOut: action.checkOut,
        adults: action.adults,
        children: action.children,
        // Editing the stay after a previous confirmation (without resetting
        // via "Return to the hotel") means this is a new attempt — the old
        // reference must not carry over and render as if it were current.
        confirmation: null,
      };
    case "SELECT_ROOM":
      return { ...state, selectedRoomSlug: action.slug, confirmation: null };
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
  selectRoom: (slug: string) => void;
  setGuest: (guest: GuestDetails) => void;
  setTermsAccepted: (accepted: boolean) => void;
  confirmBooking: (confirmation: BookingConfirmation) => void;
  reset: () => void;
  hasValidStay: boolean;
  hasSelectedRoom: boolean;
  hasGuestDetails: boolean;
};

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
      if (raw) dispatch({ type: "HYDRATE", state: { ...initialState, ...JSON.parse(raw) } });
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
      selectRoom: (slug) => dispatch({ type: "SELECT_ROOM", slug }),
      setGuest: (guest) => dispatch({ type: "SET_GUEST", guest }),
      setTermsAccepted: (accepted) => dispatch({ type: "SET_TERMS_ACCEPTED", accepted }),
      confirmBooking: (confirmation) => dispatch({ type: "CONFIRM_BOOKING", confirmation }),
      reset: () => dispatch({ type: "RESET" }),
      // Same rule as the stay form: complete dates, none in the past, check-out after check-in.
      // A restored session whose dates have since passed is therefore treated as having no stay.
      hasValidStay: isValidStayRange(state.checkIn, state.checkOut),
      hasSelectedRoom: Boolean(state.selectedRoomSlug),
      hasGuestDetails: Boolean(state.guest.firstName && state.guest.lastName && state.guest.email),
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
