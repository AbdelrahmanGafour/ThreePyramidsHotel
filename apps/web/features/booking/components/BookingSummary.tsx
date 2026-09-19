"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BookingActions } from "@/features/booking/components/BookingActions";
import { BookingEmptyState } from "@/features/booking/components/BookingEmptyState";
import { BookingStepHeader } from "@/features/booking/components/BookingStepHeader";
import { PriceBreakdown } from "@/features/booking/components/PriceBreakdown";
import { useBooking } from "@/features/booking/context/BookingContext";
import { generateDemoBookingReference } from "@/features/booking/data/bookingDemoData";
import { formatDateLabel, nightsBetween } from "@/features/booking/lib/dates";
import { calculatePriceBreakdown, formatCurrency } from "@/features/booking/lib/pricing";
import { demoStayPolicies, type Room } from "@/features/rooms/data/roomsData";

type BookingSummaryProps = {
  rooms: Room[];
};

type ReviewSectionProps = {
  title: string;
  editHref?: string;
  editLabel?: string;
  children: ReactNode;
};

// One labelled block per topic — Stay, Room, Guest, Price, Policies — each
// with its own quiet "Edit" link, so nothing on the review screen is a
// mystery and every correction is one click away.
function ReviewSection({ title, editHref, editLabel, children }: ReviewSectionProps) {
  return (
    <section aria-label={title} className="border-t border-ink/20 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="group-title">{title}</h2>
        {editHref ? (
          <Link href={editHref} className="btn-link">
            {editLabel}
          </Link>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[0.875rem] text-ink/68">{label}</dt>
      <dd className="mt-0.5 break-words text-[1.0625rem] font-semibold">{children}</dd>
    </div>
  );
}

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
        message="Choose the room you'd like to reserve before reviewing your booking."
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
    <div className="mx-auto max-w-[720px] px-[var(--page-x)] py-[clamp(2rem,5vw,3.5rem)]">
      <BookingStepHeader step="Step 4 of 4" title="Review your reservation">
        Check the details below. Nothing is confirmed until you choose &ldquo;Confirm reservation&rdquo;.
      </BookingStepHeader>

      <div className="mt-8 grid gap-7">
        <ReviewSection title="Stay" editHref="/booking" editLabel="Edit dates and guests">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
            <Fact label="Check-in">{formatDateLabel(state.checkIn)}</Fact>
            <Fact label="Check-out">{formatDateLabel(state.checkOut)}</Fact>
            <Fact label="Length and guests">
              {nights} night{nights === 1 ? "" : "s"}, {totalGuests} guest{totalGuests === 1 ? "" : "s"}
            </Fact>
          </dl>
        </ReviewSection>

        <ReviewSection title="Room" editHref="/booking/rooms" editLabel="Edit room">
          <div className="grid grid-cols-[110px_1fr] gap-4 sm:grid-cols-[150px_1fr] sm:gap-5">
            <div className="image-frame relative aspect-[4/3]">
              <Image
                src={room.image}
                alt={room.imageAlt}
                fill
                sizes="150px"
                className="object-cover"
                style={{ objectPosition: room.position }}
              />
            </div>
            <div>
              <p className="display text-[1.25rem] leading-[1.15]">{room.name}</p>
              {room.priceFrom ? (
                <p className="mt-1.5 text-[1rem] text-ink/80">{formatCurrency(room.priceFrom)} per night</p>
              ) : null}
              <Link href={`/rooms/${room.slug}`} className="btn-link" target="_blank" rel="noopener noreferrer">
                View room details<span className="sr-only"> (opens in a new tab)</span>
              </Link>
            </div>
          </div>
        </ReviewSection>

        <ReviewSection title="Guest" editHref="/booking/guest-details" editLabel="Edit guest details">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Fact label="Name">
              {state.guest.firstName} {state.guest.lastName}
            </Fact>
            <Fact label="Country">{state.guest.country}</Fact>
            <Fact label="Email">{state.guest.email}</Fact>
            <Fact label="Phone">{state.guest.phone}</Fact>
            {state.guest.arrivalTime ? <Fact label="Expected arrival">{state.guest.arrivalTime}</Fact> : null}
            {state.guest.specialRequests ? (
              <Fact label="Special requests" wide>
                <span className="font-normal">{state.guest.specialRequests}</span>
              </Fact>
            ) : null}
          </dl>
        </ReviewSection>

        <ReviewSection title="Price">
          <PriceBreakdown breakdown={breakdown} />
        </ReviewSection>

        <ReviewSection title="Policies and terms">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Fact label="Check-in / check-out">
              {demoStayPolicies.checkIn} / {demoStayPolicies.checkOut}
            </Fact>
            <Fact label="Cancellation">{demoStayPolicies.cancellation}</Fact>
          </dl>

          <div className="mt-5 border border-ink/25 bg-[var(--panel-surface)] p-4">
            <label className="flex cursor-pointer items-start gap-3 text-[1rem] leading-[1.55] text-ink">
              <input
                type="checkbox"
                checked={state.termsAccepted}
                onChange={(event) => {
                  setTermsAccepted(event.target.checked);
                  if (event.target.checked) setSubmitError(false);
                }}
                className="inner-focus mt-0.5 h-6 w-6 shrink-0 accent-[#7a5a2b]"
                aria-describedby={submitError ? "terms-error" : undefined}
                aria-invalid={submitError || undefined}
                aria-required="true"
              />
              <span>I agree to the hotel&apos;s reservation terms and cancellation policy.</span>
            </label>
            <Link href="/policies" target="_blank" rel="noopener noreferrer" className="btn-link ml-9">
              Read the hotel policies<span className="sr-only"> (opens in a new tab)</span>
            </Link>
            {submitError ? (
              <p id="terms-error" role="alert" className="field-error ml-9">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-[3px] shrink-0">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 4.5v4.2M8 10.9v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <span>Tick the box to accept the reservation terms, then confirm.</span>
              </p>
            ) : null}
          </div>
        </ReviewSection>
      </div>

      <BookingActions
        backHref="/booking/guest-details"
        backLabel="Back to guest details"
        continueLabel="Confirm reservation"
        onContinue={handleConfirm}
      />
    </div>
  );
}
