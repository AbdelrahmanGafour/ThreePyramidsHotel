"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BookingActions } from "@/features/booking/components/BookingActions";
import { BookingEmptyState } from "@/features/booking/components/BookingEmptyState";
import { BookingStepHeader } from "@/features/booking/components/BookingStepHeader";
import { useBooking } from "@/features/booking/context/BookingContext";
import { formatDateLabel } from "@/features/booking/lib/dates";
import { submitReservation } from "@/features/booking/lib/reservations";
import { formatRoomRate } from "@/features/rooms/lib/money";
import { demoStayPolicies, roomPresentationBySlug } from "@/features/rooms/data/roomsData";

// WFI-T06: reads the room type only through BookingContext's
// `availabilitySnapshot` (WFI-T05) — never the legacy static `rooms` array
// or its `priceFrom` field. `hasSelectedRoom` already requires a snapshot
// that matches the current stay exactly (see BookingContext.tsx), so once
// that guard passes, `state.availabilitySnapshot` is guaranteed present and
// consistent; no separate "room not found" fallback is needed. The only
// thing still read from `roomsData.ts` is the presentation-only image
// lookup, by the same canonical slug — never a business fact.
//
// WFI-T07: submits the real POST /api/v1/reservations (via
// features/booking/lib/reservations.ts, the same-origin bridge). The
// snapshot above is display-only and is never sent in the request body —
// only roomTypeSlug/dates/adults/children/guest fields are, exactly the
// approved contract. On success, only the backend's own response populates
// BookingContext's `confirmation`; nothing is fabricated.

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

type SubmitError = {
  code: "INVALID_RESERVATION" | "ROOM_TYPE_NOT_FOUND" | "NO_AVAILABILITY" | null;
  message: string;
};

export function BookingSummary() {
  const router = useRouter();
  const { state, hydrated, hasValidStay, hasSelectedRoom, hasGuestDetails, setTermsAccepted, confirmBooking } =
    useBooking();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsError, setTermsError] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  // Synchronous guard against a true double-click race — React state alone
  // updates on the next render, which is not early enough to stop a second
  // click fired before that render commits.
  const submittingRef = useRef(false);

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

  // Guaranteed present and consistent with the current stay by hasSelectedRoom above.
  const snapshot = state.availabilitySnapshot!;
  const presentation = roomPresentationBySlug[snapshot.roomTypeSlug];

  const handleSubmit = async () => {
    if (submittingRef.current) return;

    if (!state.termsAccepted) {
      setTermsError(true);
      return;
    }
    setTermsError(false);
    setSubmitError(null);

    // Re-validate workflow state at submit time, not just at initial render.
    if (!hasValidStay || !hasSelectedRoom || !hasGuestDetails || !state.checkIn || !state.checkOut) {
      setSubmitError({ code: null, message: "Some details are missing. Please review your reservation and try again." });
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    const result = await submitReservation({
      roomTypeSlug: snapshot.roomTypeSlug,
      checkIn: state.checkIn,
      checkOut: state.checkOut,
      adults: state.adults,
      children: state.children,
      guestFirstName: state.guest.firstName,
      guestLastName: state.guest.lastName,
      guestEmail: state.guest.email,
      guestPhone: state.guest.phone,
      guestCountry: state.guest.country,
      specialRequests: state.guest.specialRequests,
    });

    if (!result.ok) {
      submittingRef.current = false;
      setIsSubmitting(false);
      const message =
        result.code === "INVALID_RESERVATION"
          ? result.message || "Some details aren't valid. Please review and try again."
          : result.code === "ROOM_TYPE_NOT_FOUND"
            ? "This room is no longer recognized. Please choose a room again."
            : result.code === "NO_AVAILABILITY"
              ? "This room just became unavailable for your dates. Please choose another room."
              : "We couldn't submit your reservation. Please try again.";
      setSubmitError({ code: result.code, message });
      return;
    }

    // Only the backend's own response populates confirmation state.
    confirmBooking({
      bookingReference: result.data.bookingReference,
      status: result.data.status,
      roomType: result.data.roomType,
      checkIn: result.data.checkIn,
      checkOut: result.data.checkOut,
      nights: result.data.nights,
      adults: result.data.adults,
      children: result.data.children,
      nightlyRate: result.data.nightlyRate,
      totalAmount: result.data.totalAmount,
      currency: result.data.currency,
    });
    router.push("/booking/confirmation");
    // submittingRef/isSubmitting intentionally left true — this component is unmounting.
  };

  return (
    <div className="mx-auto max-w-[720px] px-[var(--page-x)] py-[clamp(2rem,5vw,3.5rem)]">
      <BookingStepHeader step="Step 4 of 4" title="Review your reservation">
        Check the details below. Nothing is booked yet.
      </BookingStepHeader>

      <div className="mt-8 grid gap-7">
        <ReviewSection title="Stay" editHref="/booking" editLabel="Edit dates and guests">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
            <Fact label="Check-in">{formatDateLabel(state.checkIn)}</Fact>
            <Fact label="Check-out">{formatDateLabel(state.checkOut)}</Fact>
            <Fact label="Length and guests">
              {snapshot.nights} night{snapshot.nights === 1 ? "" : "s"} &middot; {state.adults} adult
              {state.adults === 1 ? "" : "s"}
              {" "}
              &middot; {state.children} {state.children === 1 ? "child" : "children"}
            </Fact>
          </dl>
        </ReviewSection>

        <ReviewSection title="Room" editHref="/booking/rooms" editLabel="Edit room">
          <div className="grid grid-cols-[110px_1fr] gap-4 sm:grid-cols-[150px_1fr] sm:gap-5">
            {presentation ? (
              <div className="image-frame relative aspect-[4/3]">
                <Image
                  src={presentation.image}
                  alt={presentation.imageAlt}
                  fill
                  sizes="150px"
                  className="object-cover"
                  style={{ objectPosition: presentation.position }}
                />
              </div>
            ) : null}
            <div>
              <p className="display text-[1.25rem] leading-[1.15]">{snapshot.roomName}</p>
              <p className="mt-1.5 text-[1rem] text-ink/80">
                {formatRoomRate(snapshot.nightlyRate, snapshot.currency)} per night
              </p>
              <Link
                href={`/rooms/${snapshot.roomTypeSlug}`}
                className="btn-link"
                target="_blank"
                rel="noopener noreferrer"
              >
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
            {state.guest.specialRequests ? (
              <Fact label="Special requests" wide>
                <span className="font-normal">{state.guest.specialRequests}</span>
              </Fact>
            ) : null}
          </dl>
        </ReviewSection>

        <ReviewSection title="Price">
          <div className="flex items-baseline justify-between gap-4 py-2 text-[1rem] text-ink/80">
            <span>
              {formatRoomRate(snapshot.nightlyRate, snapshot.currency)} per night &times; {snapshot.nights} night
              {snapshot.nights === 1 ? "" : "s"}
            </span>
            <span className="font-semibold text-ink">{formatRoomRate(snapshot.totalAmount, snapshot.currency)}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-ink/20 pt-3">
            <span className="text-[1.0625rem] font-bold text-ink">Total for your stay</span>
            <span className="display text-[1.75rem] leading-none text-ink">
              {formatRoomRate(snapshot.totalAmount, snapshot.currency)}
            </span>
          </div>
          <p className="fine-print mt-3">
            This is the latest availability price shown to you. Final booking values are confirmed by the hotel when
            your reservation is created.
          </p>
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
                  if (event.target.checked) setTermsError(false);
                }}
                className="inner-focus mt-0.5 h-6 w-6 shrink-0 accent-[#7a5a2b]"
                aria-describedby={termsError ? "terms-error" : undefined}
                aria-invalid={termsError || undefined}
                aria-required="true"
              />
              <span>I agree to the hotel&apos;s reservation terms and cancellation policy.</span>
            </label>
            <Link href="/policies" target="_blank" rel="noopener noreferrer" className="btn-link ml-9">
              Read the hotel policies<span className="sr-only"> (opens in a new tab)</span>
            </Link>
            {termsError ? (
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

        {submitError ? (
          <div role="alert" className="field-error border border-[var(--danger)]/40 bg-[var(--danger)]/[0.06] px-3.5 py-3">
            <span>{submitError.message}</span>
            {submitError.code === "ROOM_TYPE_NOT_FOUND" || submitError.code === "NO_AVAILABILITY" ? (
              <Link href="/booking/rooms" className="btn-link mt-2 block">
                Choose a room again
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      <BookingActions
        backHref="/booking/guest-details"
        backLabel="Back to guest details"
        continueLabel={isSubmitting ? "Submitting…" : "Confirm reservation"}
        disabled={isSubmitting}
        disabledHint={isSubmitting ? "Submitting your reservation…" : undefined}
        onContinue={handleSubmit}
      />
    </div>
  );
}
