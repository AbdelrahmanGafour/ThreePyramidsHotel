"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { BookingActions } from "@/features/booking/components/BookingActions";
import { BookingEmptyState } from "@/features/booking/components/BookingEmptyState";
import { PriceBreakdown } from "@/features/booking/components/PriceBreakdown";
import { useBooking } from "@/features/booking/context/BookingContext";
import { generateDemoBookingReference } from "@/features/booking/data/bookingDemoData";
import { formatDateLabel, nightsBetween } from "@/features/booking/lib/dates";
import { calculatePriceBreakdown } from "@/features/booking/lib/pricing";
import type { Room } from "@/features/rooms/data/roomsData";

type BookingSummaryProps = {
  rooms: Room[];
};

export function BookingSummary({ rooms }: BookingSummaryProps) {
  const router = useRouter();
  const { state, hydrated, hasValidStay, hasSelectedRoom, hasGuestDetails, setTermsAccepted, confirmBooking } =
    useBooking();
  const [submitError, setSubmitError] = useState(false);

  if (!hydrated) return null;

  if (!hasValidStay) {
    return <BookingEmptyState title="Start your reservation" message="Choose your dates to begin." />;
  }
  if (!hasSelectedRoom) {
    return (
      <BookingEmptyState
        title="Choose a room first"
        message="Pick the room you'd like to reserve before reviewing your booking."
        actionLabel="Choose a room"
        actionHref="/booking/rooms"
      />
    );
  }
  if (!hasGuestDetails) {
    return (
      <BookingEmptyState
        title="A few details first"
        message="Add your contact details so we know who to prepare the room for."
        actionLabel="Add guest details"
        actionHref="/booking/guest-details"
      />
    );
  }

  const room = rooms.find((item) => item.slug === state.selectedRoomSlug);
  if (!room) {
    return (
      <BookingEmptyState
        title="That room isn't available"
        message="Please choose a room again to continue."
        actionLabel="Choose a room"
        actionHref="/booking/rooms"
      />
    );
  }

  const nights = nightsBetween(state.checkIn, state.checkOut);
  const totalGuests = state.adults + state.children;
  const breakdown = calculatePriceBreakdown({
    nightlyRate: room.priceFrom ?? 0,
    nights,
  });

  const handleConfirm = () => {
    if (!state.termsAccepted) {
      setSubmitError(true);
      return;
    }
    setSubmitError(false);
    // DEMO BOOKING DATA — FRONTEND-ONLY PLACEHOLDER. Replace with the backend's
    // created-reservation response before production. This never calls a real
    // reservations or payment system and does not check availability.
    confirmBooking({ reference: generateDemoBookingReference(), confirmedAt: new Date().toISOString() });
    router.push("/booking/confirmation");
  };

  return (
    <motion.div
      className="mx-auto max-w-[640px] px-[var(--page-x)] py-[clamp(2.5rem,5vw,3.75rem)]"
      initial="hidden"
      animate="show"
      variants={motionPrimitives.staggerContainer}
    >
      <motion.p
        className="label text-aged-gold"
        variants={motionPrimitives.precisionDetail}
        transition={{ duration: 0.4, ease: luxuryEase }}
      >
        Review your reservation
      </motion.p>
      <motion.h1
        className="display mt-3 text-[clamp(1.7rem,5vw,2.1rem)] leading-[1.1] text-ink"
        variants={motionPrimitives.editorialText}
        transition={{ duration: 0.6, delay: 0.06, ease: luxuryEase }}
      >
        Almost there.
      </motion.h1>

      <motion.div
        className="mt-8 grid gap-8"
        variants={motionPrimitives.revealUp}
        transition={{ duration: 0.5, delay: 0.14, ease: luxuryEase }}
      >
        <div className="grid grid-cols-[120px_1fr] gap-5 border-t border-ink/10 pt-6">
          <div className="image-frame relative aspect-[4/3]">
            <Image src={room.image} alt={room.imageAlt} fill sizes="120px" className="object-cover" style={{ objectPosition: room.position }} />
          </div>
          <div>
            <h2 className="display text-[1.1rem] leading-[1.1] text-ink">{room.name}</h2>
            <p className="mt-2 text-[0.82rem] text-ink/64">
              {formatDateLabel(state.checkIn)} &ndash; {formatDateLabel(state.checkOut)}
            </p>
            <p className="mt-1 text-[0.82rem] text-ink/64">
              {nights} night{nights === 1 ? "" : "s"} &middot; {totalGuests} guest{totalGuests === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="border-t border-ink/10 pt-6">
          <p className="label text-aged-gold">Guest contact</p>
          <p className="mt-3 text-[0.92rem] text-ink/78">
            {state.guest.firstName} {state.guest.lastName}
          </p>
          <p className="mt-1 text-[0.86rem] text-ink/60">{state.guest.email}</p>
          <p className="mt-1 text-[0.86rem] text-ink/60">{state.guest.phone}</p>
          <p className="mt-1 text-[0.86rem] text-ink/60">{state.guest.country}</p>
          {state.guest.arrivalTime ? (
            <p className="mt-1 text-[0.86rem] text-ink/60">Arriving {state.guest.arrivalTime.toLowerCase()}</p>
          ) : null}
          {state.guest.specialRequests ? (
            <p className="mt-3 text-[0.86rem] italic text-ink/60">&ldquo;{state.guest.specialRequests}&rdquo;</p>
          ) : null}
        </div>

        <PriceBreakdown breakdown={breakdown} />

        <div className="border-t border-ink/10 pt-6">
          <label className="flex items-start gap-3 text-[0.82rem] leading-[1.6] text-ink/68">
            <input
              type="checkbox"
              checked={state.termsAccepted}
              onChange={(event) => {
                setTermsAccepted(event.target.checked);
                if (event.target.checked) setSubmitError(false);
              }}
              className="mt-1 h-4 w-4 shrink-0 accent-brass"
              aria-describedby={submitError ? "terms-error" : undefined}
              aria-invalid={submitError}
            />
            I agree to the hotel&apos;s reservation terms and cancellation policy.
          </label>
          {submitError ? (
            <p id="terms-error" role="alert" className="mt-2 text-[0.78rem] text-terracotta">
              Please accept the reservation terms to continue.
            </p>
          ) : null}
        </div>
      </motion.div>

      <BookingActions backHref="/booking/guest-details" continueLabel="Confirm reservation ->" onContinue={handleConfirm} />
    </motion.div>
  );
}
