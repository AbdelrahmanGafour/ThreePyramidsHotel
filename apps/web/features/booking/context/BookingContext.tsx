"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { isValidStayRange } from "@/features/booking/lib/dates";
import { isCreatedReservation } from "@/features/booking/lib/reservationContract";
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
  reservationSubmissionUncertain: false,
};

type BookingAction =
  | { type: "SET_STAY"; checkIn: string | null; checkOut: string | null; adults: number; children: number }
  | { type: "SELECT_ROOM"; slug: string; snapshot: AvailabilitySnapshot | null }
  | { type: "SET_GUEST"; guest: GuestDetails }
  | { type: "SET_TERMS_ACCEPTED"; accepted: boolean }
  | { type: "MARK_RESERVATION_UNCERTAIN" }
  | { type: "CONFIRM_BOOKING"; confirmation: BookingConfirmation }
  | { type: "RESET" }
  | { type: "HYDRATE"; state: BookingState };

/**
 * Exported for the reducer test only — `BookingProvider` is the sole
 * production caller, via `dispatch`. Kept pure (no storage, no React
 * lifecycle) on purpose.
 */
export function bookingReducer(state: BookingState, action: BookingAction): BookingState {
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
    case "MARK_RESERVATION_UNCERTAIN":
      // PR #17: an uncertain POST outcome may already have committed a
      // reservation server-side. Deliberately touches ONLY this one field —
      // guest, terms and confirmation are left exactly as they were, and
      // nothing here counts as a new attempt the way SET_STAY/SELECT_ROOM/
      // SET_GUEST do. Persisted (not component state), so it survives a
      // BookingSummary remount/navigation/refresh in the same session.
      return { ...state, reservationSubmissionUncertain: true };
    case "CONFIRM_BOOKING":
      // WFI-T08: a successful backend confirmation is the point at which
      // transient guest PII (and the terms checkbox) is no longer needed —
      // cleared in the same transition so it never lingers in
      // sessionStorage past a successful submission. The confirmation
      // object itself carries no PII and is left untouched. A successful
      // confirmation also resolves any prior uncertainty for this session.
      return {
        ...state,
        confirmation: action.confirmation,
        guest: emptyGuestDetails,
        termsAccepted: false,
        reservationSubmissionUncertain: false,
      };
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
  /** PR #17: persists the uncertain-outcome lock so it survives a BookingSummary remount/navigation/refresh. */
  markReservationUncertain: () => void;
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

/**
 * WFI-T08: a session saved before T07 (or otherwise corrupted) may still
 * carry a legacy/fake confirmation shape under this same storage key.
 * Restores `confirmation` only if it structurally matches the real backend
 * 201 response exactly — the SAME check the POST response itself goes
 * through (features/booking/lib/reservationContract.ts's
 * isCreatedReservation), so the two validators can never drift apart —
 * otherwise treats it as no confirmation at all, never fabricating or
 * migrating an old fake reference. Invalid confirmation does not wipe the
 * rest of the restored booking state.
 */
function sanitizeConfirmation(confirmation: unknown): BookingConfirmation | null {
  return isCreatedReservation(confirmation) ? confirmation : null;
}

/**
 * PR #17: only a literal `true` restores as locked. Anything else — missing
 * (an old pre-this-fix session), `false`, or a malformed value like the
 * string `"true"`, `1`, or `{}` — restores as `false`. A truthy-but-wrong
 * value here must never be treated as a genuine, proven lock.
 */
function sanitizeUncertainFlag(value: unknown): boolean {
  return value === true;
}

/**
 * Builds the state HYDRATE restores from a raw parsed sessionStorage value.
 * Pure (no storage, no dispatch) so it's unit-testable without React —
 * exactly what the mount effect below feeds into `dispatch`. An invalid
 * `confirmation` becomes `null` here without affecting any other restored
 * field: `sanitizeConfirmation`/`sanitizeGuest`/`sanitizeUncertainFlag` only
 * ever replace their own key in the spread.
 */
export function buildHydratedState(parsed: unknown): BookingState {
  const raw = (parsed && typeof parsed === "object" ? parsed : {}) as Partial<BookingState>;

  return {
    ...initialState,
    ...raw,
    guest: sanitizeGuest(raw.guest),
    confirmation: sanitizeConfirmation(raw.confirmation),
    reservationSubmissionUncertain: sanitizeUncertainFlag(raw.reservationSubmissionUncertain),
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
        dispatch({ type: "HYDRATE", state: buildHydratedState(JSON.parse(raw)) });
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
      markReservationUncertain: () => dispatch({ type: "MARK_RESERVATION_UNCERTAIN" }),
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
