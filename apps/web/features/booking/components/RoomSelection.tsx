"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookingActions } from "@/features/booking/components/BookingActions";
import { BookingEmptyState } from "@/features/booking/components/BookingEmptyState";
import { BookingRoomOption } from "@/features/booking/components/BookingRoomOption";
import { BookingStepHeader } from "@/features/booking/components/BookingStepHeader";
import { useBooking } from "@/features/booking/context/BookingContext";
import { formatDateLabel, nightsBetween } from "@/features/booking/lib/dates";
import { getRoomUnavailableReason } from "@/features/booking/lib/eligibility";
import {
  searchAvailability,
  type AvailabilityResult,
  type AvailabilityRoomType,
} from "@/features/booking/lib/availability";
import { formatRoomRate } from "@/features/rooms/lib/money";
import type { RoomWithPresentation } from "@/features/rooms/api";

type RoomSelectionProps = {
  rooms: RoomWithPresentation[];
};

// Backend/PostgreSQL is the sole source of truth for live availability and
// pricing (capacity eligibility alone is still a legitimate, immediate,
// no-network fact — see lib/eligibility.ts). This snapshot is never persisted
// to BookingContext/sessionStorage: it is a live search result, not a second
// inventory/pricing authority, and is re-fetched whenever dates or guests
// change.
type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; nights: number; roomTypes: AvailabilityRoomType[] };

function toSearchState(result: AvailabilityResult | undefined): SearchState {
  if (!result) return { status: "loading" };
  if (result.ok) return { status: "ready", nights: result.data.nights, roomTypes: result.data.roomTypes };
  return {
    status: "error",
    message:
      result.code === "INVALID_AVAILABILITY_QUERY"
        ? "Choose valid dates and guest counts, then try again."
        : "Availability is temporarily unavailable. Please try again shortly.",
  };
}

export function RoomSelection({ rooms }: RoomSelectionProps) {
  const router = useRouter();
  const { state, hydrated, hasValidStay, selectRoom } = useBooking();
  const totalGuests = state.adults + state.children;

  const searchKey =
    hasValidStay && state.checkIn && state.checkOut
      ? `${state.checkIn}|${state.checkOut}|${state.adults}|${state.children}`
      : null;

  // Keyed by the exact search criteria: a change in dates/guests always
  // starts a fresh backend search rather than trusting a stale result.
  // setState only ever happens inside the `.then()` continuation below
  // (a genuine async response), never synchronously in the effect body —
  // "loading" is derived (see toSearchState) whenever no result matches the
  // current key yet.
  const [result, setResult] = useState<{ key: string; value: AvailabilityResult } | null>(null);

  useEffect(() => {
    if (!hydrated || !searchKey || !state.checkIn || !state.checkOut) return;

    let cancelled = false;

    searchAvailability({
      checkIn: state.checkIn,
      checkOut: state.checkOut,
      adults: state.adults,
      children: state.children,
    }).then((value) => {
      if (!cancelled) setResult({ key: searchKey, value });
    });

    return () => {
      cancelled = true;
    };
  }, [hydrated, searchKey, state.checkIn, state.checkOut, state.adults, state.children]);

  const search: SearchState = searchKey
    ? toSearchState(result?.key === searchKey ? result.value : undefined)
    : { status: "idle" };

  if (!hydrated) return null;

  if (!hasValidStay) {
    return (
      <BookingEmptyState
        title="Start your reservation"
        message="Choose your dates first so we can show rooms that fit your stay."
      />
    );
  }

  const fallbackNights = nightsBetween(state.checkIn, state.checkOut);
  const ready = search.status === "ready";
  // Once the backend has answered, its own `nights` is authoritative for
  // display; fallbackNights is only for the loading/pre-response window.
  const displayNights = ready ? search.nights : fallbackNights;

  // One row per room-type prop, merged by the SAME canonical slug with the
  // live availability result — never a translation between slugs. A room
  // absent from the availability response (capacity too small, or excluded
  // by the backend for any other reason) is still shown, not hidden,
  // matching the existing "never hidden" UX, with an honest reason.
  const rows = rooms.map((room) => {
    const capacityReason = getRoomUnavailableReason(room, totalGuests);
    const availability = ready ? (search as Extract<SearchState, { status: "ready" }>).roomTypes.find((item) => item.slug === room.slug) ?? null : null;

    let unavailableReason = capacityReason;
    if (!unavailableReason && ready && !availability) {
      unavailableReason = "not available for your selected dates and guests.";
    } else if (!unavailableReason && availability && availability.availableRoomCount === 0) {
      unavailableReason = "fully booked for your selected dates.";
    }

    return { room, availability, unavailableReason };
  });

  const anyEligible = ready && rows.some((row) => !row.unavailableReason);
  const selectedRow = rows.find((row) => row.room.slug === state.selectedRoomSlug);
  const canContinue = Boolean(ready && selectedRow && !selectedRow.unavailableReason && selectedRow.availability);

  return (
    <div className="mx-auto max-w-[760px] px-[var(--page-x)] py-[clamp(2rem,5vw,3.5rem)]">
      <BookingStepHeader step="Step 2 of 4" title="Choose your room">
        Choose one room to continue. Prices shown are per night.
      </BookingStepHeader>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-y border-ink/15 py-3">
        <p className="text-[1rem] text-ink">
          <span className="font-semibold">
            {formatDateLabel(state.checkIn)} &ndash; {formatDateLabel(state.checkOut)}
          </span>
          <span className="text-ink/75">
            {" "}
            &middot; {displayNights} night{displayNights === 1 ? "" : "s"} &middot; {totalGuests} guest
            {totalGuests === 1 ? "" : "s"}
          </span>
        </p>
        <Link href="/booking" className="btn-link">
          Edit dates and guests
        </Link>
      </div>

      {search.status === "loading" || search.status === "idle" ? (
        <p role="status" className="mt-6 text-center text-[1rem] text-ink/75">
          Checking availability…
        </p>
      ) : search.status === "error" ? (
        <div className="mt-6 border border-ink/20 bg-[var(--panel-surface)] p-6 text-center">
          <p className="text-[1.0625rem] font-semibold text-ink">{search.message}</p>
          <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/booking" className="btn btn-primary w-full sm:w-auto">
              Edit dates and guests
            </Link>
          </div>
        </div>
      ) : anyEligible ? (
        <ul aria-label="Available room types">
          {rows.map(({ room, availability, unavailableReason }) => (
            <BookingRoomOption
              key={room.slug}
              room={room}
              availability={availability}
              nights={displayNights}
              selected={state.selectedRoomSlug === room.slug}
              unavailableReason={unavailableReason}
              onSelect={() => selectRoom(room.slug)}
            />
          ))}
        </ul>
      ) : (
        <div className="mt-6 border border-ink/20 bg-[var(--panel-surface)] p-6 text-center">
          <p className="text-[1.0625rem] font-semibold text-ink">
            None of our rooms are available for {totalGuests} guest{totalGuests === 1 ? "" : "s"} on these dates.
          </p>
          <p className="prose-body mt-2">
            Try different dates or fewer guests, or contact the hotel and we&apos;ll help you plan.
          </p>
          <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/booking" className="btn btn-primary w-full sm:w-auto">
              Edit dates and guests
            </Link>
            <Link href="/contact" className="btn btn-secondary w-full sm:w-auto">
              Contact the hotel
            </Link>
          </div>
        </div>
      )}

      <BookingActions
        backHref="/booking"
        backLabel="Back to dates"
        continueLabel="Continue to guest details"
        continueType="button"
        disabled={!canContinue}
        disabledHint={
          search.status === "loading" || search.status === "idle"
            ? "Checking availability…"
            : "Select an available room above to continue."
        }
        sticky
        helper={
          selectedRow && canContinue && selectedRow.availability ? (
            <>
              <span className="font-semibold text-ink">{selectedRow.room.name}</span>{" "}
              &middot; {formatRoomRate(selectedRow.availability.totalAmount, selectedRow.availability.currency)} total
            </>
          ) : null
        }
        onContinue={() => router.push("/booking/guest-details")}
      />

      <p className="fine-print mt-3 text-center">
        Availability shown is a snapshot. Final availability is confirmed when your reservation is created.
      </p>
    </div>
  );
}
