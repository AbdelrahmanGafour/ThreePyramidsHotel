"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookingEmptyState } from "@/features/booking/components/BookingEmptyState";
import { useBooking } from "@/features/booking/context/BookingContext";
import { formatDateLabel, nightsBetween } from "@/features/booking/lib/dates";
import type { Room } from "@/features/rooms/data/roomsData";

type BookingConfirmationProps = {
  rooms: Room[];
};

// Frontend demo confirmation only — `state.confirmation` is set locally by
// `BookingSummary` via `generateDemoBookingReference()`. No reservation or
// payment has actually been created; a real integration replaces that call
// with the backend's create-reservation response before this screen can be
// trusted as a real confirmation.
export function BookingConfirmation({ rooms }: BookingConfirmationProps) {
  const { state, hydrated, reset } = useBooking();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmed = Boolean(state.confirmation);

  // Move focus to the result so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (hydrated && confirmed) headingRef.current?.focus();
  }, [hydrated, confirmed]);

  if (!hydrated) return null;

  if (!state.confirmation) {
    return (
      <BookingEmptyState
        title="No reservation to confirm yet"
        message="Complete your reservation details first, then confirm to see this page."
        actionLabel="Start your reservation"
        actionHref="/booking"
      />
    );
  }

  const room = rooms.find((item) => item.slug === state.selectedRoomSlug);
  const nights = nightsBetween(state.checkIn, state.checkOut);
  const totalGuests = state.adults + state.children;

  return (
    <div className="mx-auto max-w-[640px] px-[var(--page-x)] py-[clamp(2.5rem,6vw,4rem)]">
      <div className="text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center border-2 border-aged-gold text-[var(--brass-ink)]"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 12.5 9.5 18 20 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        <p className="eyebrow mt-5">Reservation confirmed</p>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="page-title mt-2 text-[clamp(1.85rem,5vw,2.4rem)]! outline-none"
        >
          Thank you{state.guest.firstName ? `, ${state.guest.firstName}` : ""}.
        </h1>
        <p className="page-lede mx-auto mt-3">Your reservation is confirmed. We look forward to welcoming you to Giza.</p>
      </div>

      <div className="mt-8 border border-ink/20 border-t-2 border-t-brass bg-[var(--panel-surface)] p-5 text-center">
        <p className="text-[0.9375rem] text-ink/75">Your reservation reference</p>
        <p className="mt-1 text-[1.5rem] font-bold tracking-[0.08em] text-ink">{state.confirmation.reference}</p>
        <p className="fine-print mt-1">Keep this reference for your records.</p>
      </div>

      <section aria-labelledby="stay-summary-title" className="mt-8 border-t border-ink/20 pt-5">
        <h2 id="stay-summary-title" className="group-title">
          Your stay
        </h2>
        <div className={`mt-4 grid gap-4 ${room ? "grid-cols-[110px_1fr] sm:grid-cols-[150px_1fr] sm:gap-5" : ""}`}>
          {room ? (
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
          ) : null}
          <dl className="grid gap-y-2 text-[1rem]">
            {room ? (
              <div>
                <dt className="sr-only">Room</dt>
                <dd className="display text-[1.25rem] leading-[1.15]">{room.name}</dd>
              </div>
            ) : null}
            <div>
              <dt className="sr-only">Dates</dt>
              <dd className="font-semibold">
                {formatDateLabel(state.checkIn)} &ndash; {formatDateLabel(state.checkOut)}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Length and guests</dt>
              <dd className="text-ink/80">
                {nights} night{nights === 1 ? "" : "s"}, {totalGuests} guest{totalGuests === 1 ? "" : "s"}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Reserved for</dt>
              <dd className="text-ink/80">
                {state.guest.firstName} {state.guest.lastName}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="next-steps-title" className="mt-8 border-t border-ink/20 pt-5">
        <h2 id="next-steps-title" className="group-title">
          What happens next
        </h2>
        <p className="prose-body mt-3">
          A confirmation email will be sent to <strong className="font-semibold text-ink">{state.guest.email || "your email address"}</strong>.
          If anything needs your attention before arrival, our team will contact you. Questions in the meantime?{" "}
          <Link href="/contact" className="font-semibold text-ink underline underline-offset-4 hover:text-[var(--brass-ink)]">
            Contact the hotel
          </Link>
          .
        </p>
      </section>

      <div className="mt-9 flex justify-center">
        <Link href="/" onClick={reset} className="btn btn-primary w-full sm:w-auto sm:min-w-[16rem]">
          Return to the hotel
        </Link>
      </div>
    </div>
  );
}
