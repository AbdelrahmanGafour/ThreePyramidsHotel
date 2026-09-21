"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookingEmptyState } from "@/features/booking/components/BookingEmptyState";
import { useBooking } from "@/features/booking/context/BookingContext";
import { formatDateLabel } from "@/features/booking/lib/dates";
import { roomPresentationBySlug } from "@/features/rooms/data/roomsData";
import { formatRoomRate } from "@/features/rooms/lib/money";

// WFI-T08: `state.confirmation` — the backend's real 201 response to
// POST /api/v1/reservations — is the ONLY source of business facts on this
// screen (room type, dates, guests, price, status). No T05
// availabilitySnapshot, no legacy static room data, and no guest PII (it is
// cleared from state right after a successful confirmation; see
// BookingContext.tsx's CONFIRM_BOOKING handling). The room image is looked
// up by the confirmed roomType.slug purely for presentation.
export function BookingConfirmation() {
  const { state, hydrated, reset } = useBooking();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmation = state.confirmation;

  // Move focus to the result so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (hydrated && confirmation) headingRef.current?.focus();
  }, [hydrated, confirmation]);

  if (!hydrated) return null;

  if (!confirmation) {
    return (
      <BookingEmptyState
        title="No reservation to show"
        message="Complete your reservation details first, then submit your request to see this page."
        actionLabel="Start your reservation"
        actionHref="/booking"
      />
    );
  }

  const presentation = roomPresentationBySlug[confirmation.roomType.slug];

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

        <p className="eyebrow mt-5">Reservation received</p>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="page-title mt-2 text-[clamp(1.85rem,5vw,2.4rem)]! outline-none"
        >
          Thank you.
        </h1>
        <p className="page-lede mx-auto mt-3">
          Your reservation request has been created and is currently pending confirmation from the hotel.
        </p>
      </div>

      <div className="mt-8 border border-ink/20 border-t-2 border-t-brass bg-[var(--panel-surface)] p-5 text-center">
        <p className="text-[0.9375rem] text-ink/75">Your reservation reference</p>
        <p className="mt-1 text-[1.5rem] font-bold tracking-[0.08em] text-ink">{confirmation.bookingReference}</p>
        <p className="fine-print mt-1">Status: pending &middot; keep this reference for your records.</p>
      </div>

      <section aria-labelledby="stay-summary-title" className="mt-8 border-t border-ink/20 pt-5">
        <h2 id="stay-summary-title" className="group-title">
          Your stay
        </h2>
        <div
          className={`mt-4 grid gap-4 ${presentation ? "grid-cols-[110px_1fr] sm:grid-cols-[150px_1fr] sm:gap-5" : ""}`}
        >
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
          <dl className="grid gap-y-2 text-[1rem]">
            <div>
              <dt className="sr-only">Room</dt>
              <dd className="display text-[1.25rem] leading-[1.15]">{confirmation.roomType.name}</dd>
            </div>
            <div>
              <dt className="sr-only">Dates</dt>
              <dd className="font-semibold">
                {formatDateLabel(confirmation.checkIn)} &ndash; {formatDateLabel(confirmation.checkOut)}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Length and guests</dt>
              <dd className="text-ink/80">
                {confirmation.nights} night{confirmation.nights === 1 ? "" : "s"} &middot; {confirmation.adults} adult
                {confirmation.adults === 1 ? "" : "s"} &middot; {confirmation.children}{" "}
                {confirmation.children === 1 ? "child" : "children"}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Price</dt>
              <dd className="text-ink/80">
                {formatRoomRate(confirmation.nightlyRate, confirmation.currency)} per night &middot; total{" "}
                {formatRoomRate(confirmation.totalAmount, confirmation.currency)}
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
          Keep your reservation reference for your records. If anything needs your attention before arrival, our
          team will contact you. Questions in the meantime?{" "}
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
