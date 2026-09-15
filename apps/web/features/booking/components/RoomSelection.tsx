"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { BookingActions } from "@/features/booking/components/BookingActions";
import { BookingEmptyState } from "@/features/booking/components/BookingEmptyState";
import { BookingRoomOption } from "@/features/booking/components/BookingRoomOption";
import { useBooking } from "@/features/booking/context/BookingContext";
import { formatDateLabel, nightsBetween } from "@/features/booking/lib/dates";
import { getRoomUnavailableReason, hasAnyEligibleRoom } from "@/features/booking/lib/eligibility";
import type { Room } from "@/features/rooms/data/roomsData";

type RoomSelectionProps = {
  rooms: Room[];
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

  return (
    <motion.div
      className="mx-auto max-w-[760px] px-[var(--page-x)] py-[clamp(2.5rem,5vw,3.75rem)]"
      initial="hidden"
      animate="show"
      variants={motionPrimitives.staggerContainer}
    >
      <motion.p
        className="label text-aged-gold"
        variants={motionPrimitives.precisionDetail}
        transition={{ duration: 0.4, ease: luxuryEase }}
      >
        {formatDateLabel(state.checkIn)} &ndash; {formatDateLabel(state.checkOut)} &middot; {nights} night
        {nights === 1 ? "" : "s"} &middot; {totalGuests} guest{totalGuests === 1 ? "" : "s"}
      </motion.p>
      <motion.h1
        className="display mt-3 text-[clamp(1.7rem,5vw,2.1rem)] leading-[1.1] text-ink"
        variants={motionPrimitives.editorialText}
        transition={{ duration: 0.6, delay: 0.06, ease: luxuryEase }}
      >
        Choose your room.
      </motion.h1>

      {anyEligible ? (
        <motion.div variants={motionPrimitives.revealUp} transition={{ duration: 0.5, delay: 0.14, ease: luxuryEase }}>
          {rooms.map((room) => (
            <BookingRoomOption
              key={room.slug}
              room={room}
              selected={state.selectedRoomSlug === room.slug}
              unavailableReason={getRoomUnavailableReason(room, totalGuests)}
              onSelect={() => selectRoom(room.slug)}
            />
          ))}
        </motion.div>
      ) : (
        <div className="border-t border-ink/10 py-10 text-center">
          <p className="text-[0.94rem] text-ink/64">None of our rooms sleep {totalGuests}+ guests in one room.</p>
          <p className="mt-2 text-[0.94rem] text-ink/64">Try fewer guests, or edit your stay.</p>
          <Link href="/booking" className="text-link mt-5 inline-flex text-ink/72 hover:text-ink">
            Edit stay -&gt;
          </Link>
        </div>
      )}

      <BookingActions
        backHref="/booking"
        continueLabel="Continue to guest details ->"
        continueType="button"
        disabled={!canContinue}
        sticky
        onContinue={() => router.push("/booking/guest-details")}
      />
    </motion.div>
  );
}
