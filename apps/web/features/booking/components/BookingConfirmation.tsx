"use client";

import Image from "next/image";
import Link from "next/link";
import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
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
    <motion.div
      className="mx-auto max-w-[560px] px-[var(--page-x)] py-[clamp(3rem,6vw,4.5rem)] text-center"
      initial="hidden"
      animate="show"
      variants={motionPrimitives.staggerContainer}
    >
      <motion.span
        aria-hidden="true"
        className="mx-auto flex h-14 w-14 items-center justify-center border border-brass text-brass"
        variants={motionPrimitives.precisionDetail}
        transition={{ duration: 0.4, ease: luxuryEase }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 12.5 9.5 18 20 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.span>

      <motion.p
        className="label mt-5 text-aged-gold"
        variants={motionPrimitives.precisionDetail}
        transition={{ duration: 0.4, delay: 0.06, ease: luxuryEase }}
      >
        Reservation confirmed
      </motion.p>

      <motion.h1
        className="display mt-3 text-[clamp(1.8rem,5.5vw,2.3rem)] leading-[1.1] text-ink"
        variants={motionPrimitives.editorialText}
        transition={{ duration: 0.6, delay: 0.12, ease: luxuryEase }}
      >
        We&apos;ll see you in Giza.
      </motion.h1>

      <motion.p
        className="mt-3 text-[0.68rem] font-black uppercase tracking-[0.18em] text-ink/44"
        variants={motionPrimitives.precisionDetail}
        transition={{ duration: 0.4, delay: 0.2, ease: luxuryEase }}
      >
        Reference {state.confirmation.reference}
      </motion.p>

      <motion.div
        className="mt-8 grid gap-5 border-t border-ink/10 pt-6 text-left"
        variants={motionPrimitives.revealUp}
        transition={{ duration: 0.5, delay: 0.28, ease: luxuryEase }}
      >
        {room ? (
          <div className="grid grid-cols-[96px_1fr] gap-4">
            <div className="image-frame relative aspect-[4/3]">
              <Image src={room.image} alt={room.imageAlt} fill sizes="96px" className="object-cover" style={{ objectPosition: room.position }} />
            </div>
            <div>
              <h2 className="display text-[1rem] leading-[1.1] text-ink">{room.name}</h2>
              <p className="mt-1.5 text-[0.8rem] text-ink/64">
                {formatDateLabel(state.checkIn)} &ndash; {formatDateLabel(state.checkOut)}
              </p>
              <p className="mt-1 text-[0.8rem] text-ink/64">
                {nights} night{nights === 1 ? "" : "s"} &middot; {totalGuests} guest{totalGuests === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        ) : null}

        <div className="border-t border-ink/10 pt-5 text-[0.86rem] text-ink/68">
          <p>
            {state.guest.firstName} {state.guest.lastName}
          </p>
          <p className="mt-1 text-ink/56">{state.guest.email}</p>
        </div>

        <div className="border-t border-ink/10 pt-5">
          <p className="label text-aged-gold">Next steps</p>
          <p className="mt-2 text-[0.86rem] leading-[1.7] text-ink/64">
            A confirmation email will be sent to {state.guest.email || "your email"} once this reservation is
            processed. Our team will reach out if anything needs your attention before arrival.
          </p>
        </div>
      </motion.div>

      <motion.div
        className="mt-9 flex flex-col items-center gap-4"
        variants={motionPrimitives.precisionDetail}
        transition={{ duration: 0.4, delay: 0.36, ease: luxuryEase }}
      >
        <Link href="/" onClick={reset} className="brass-button min-h-11 w-full sm:w-auto">
          Return to the hotel
        </Link>
        <button type="button" disabled className="text-link cursor-not-allowed text-ink/36">
          Manage booking (coming soon) -&gt;
        </button>
      </motion.div>
    </motion.div>
  );
}
