"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookingActions } from "@/features/booking/components/BookingActions";
import { BookingEmptyState } from "@/features/booking/components/BookingEmptyState";
import { BookingRoomOption } from "@/features/booking/components/BookingRoomOption";
import { BookingStepHeader } from "@/features/booking/components/BookingStepHeader";
import { useBooking } from "@/features/booking/context/BookingContext";
import { formatDateLabel, nightsBetween } from "@/features/booking/lib/dates";
import { getRoomUnavailableReason, hasAnyEligibleRoom } from "@/features/booking/lib/eligibility";
import { formatRoomRate } from "@/features/rooms/lib/money";
import type { RoomWithPresentation } from "@/features/rooms/api";

type RoomSelectionProps = {
  rooms: RoomWithPresentation[];
};

export function RoomSelection({ rooms }: RoomSelectionProps) {
  const router = useRouter();
  const { state, hydrated, hasValidStay, selectRoom } = useBooking();

  if (!hydrated) return null;

  if (!hasValidStay) {
    return (
      <BookingEmptyState
        title="Start your reservation"
        message="Choose your dates first so we can show rooms that fit your stay."
      />
    );
  }

  // One room per reservation, so the whole party must fit the chosen room type (capacity only, not availability).
  const totalGuests = state.adults + state.children;
  const nights = nightsBetween(state.checkIn, state.checkOut);
  const anyEligible = hasAnyEligibleRoom(rooms, totalGuests);

  const selectedRoom = rooms.find((room) => room.slug === state.selectedRoomSlug);
  // A room chosen earlier can become ineligible if the guest count changes
  // after the fact (e.g. going back to step 1 and adding a guest) — that must
  // block continuing, not just look wrong.
  const canContinue = selectedRoom ? !getRoomUnavailableReason(selectedRoom, totalGuests) : false;
  // No total is computed here — the accepted price/total is a backend
  // fact (see the reservation ticket), not something derived from
  // baseNightlyRate via floating-point arithmetic on the frontend.

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
            &middot; {nights} night{nights === 1 ? "" : "s"} &middot; {totalGuests} guest{totalGuests === 1 ? "" : "s"}
          </span>
        </p>
        <Link href="/booking" className="btn-link">
          Edit dates and guests
        </Link>
      </div>

      {anyEligible ? (
        <ul aria-label="Available room types">
          {rooms.map((room) => (
            <BookingRoomOption
              key={room.slug}
              room={room}
              selected={state.selectedRoomSlug === room.slug}
              unavailableReason={getRoomUnavailableReason(room, totalGuests)}
              onSelect={() => selectRoom(room.slug)}
            />
          ))}
        </ul>
      ) : (
        <div className="mt-6 border border-ink/20 bg-[var(--panel-surface)] p-6 text-center">
          <p className="text-[1.0625rem] font-semibold text-ink">
            None of our rooms sleep {totalGuests} guests in one room.
          </p>
          <p className="prose-body mt-2">Try fewer guests, or contact the hotel and we&apos;ll help you plan.</p>
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
        disabledHint="Select a room above to continue."
        sticky
        helper={
          selectedRoom && canContinue ? (
            <>
              <span className="font-semibold text-ink">{selectedRoom.name}</span>
              {" "}&middot; {formatRoomRate(selectedRoom.baseNightlyRate, selectedRoom.currency)} per night
            </>
          ) : null
        }
        onContinue={() => router.push("/booking/guest-details")}
      />
    </div>
  );
}
