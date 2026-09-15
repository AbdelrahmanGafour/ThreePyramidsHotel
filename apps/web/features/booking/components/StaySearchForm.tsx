"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { BookingFormField, bookingInputClassName } from "@/features/booking/components/BookingFormField";
import { GuestSelector } from "@/features/booking/components/GuestSelector";
import { useBooking } from "@/features/booking/context/BookingContext";
import { isValidStayRange, isPastDate, todayISO } from "@/features/booking/lib/dates";
import type { BookingState } from "@/features/booking/types";
import { rooms } from "@/features/rooms/data/roomsData";

// Only mounted once `hydrated` is true, so its lazy `useState` initializers
// read the already-restored booking state on their real first render — no
// effect needed to sync local state from context after the fact.
function StaySearchFields({ initial }: { initial: BookingState }) {
  const router = useRouter();
  const { setStay } = useBooking();

  const [checkIn, setCheckIn] = useState(initial.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initial.checkOut ?? "");
  const [guests, setGuests] = useState({ adults: initial.adults, children: initial.children });
  const [error, setError] = useState<string | null>(null);

  // A native date input's `min` only constrains *future* picks — it won't
  // retroactively clear a check-out the guest already chose. Without this,
  // moving check-in later than an existing check-out leaves a silently
  // invalid range sitting in the field until submit.
  const handleCheckInChange = (value: string) => {
    setCheckIn(value);
    if (checkOut && value >= checkOut) setCheckOut("");
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!checkIn || !checkOut) {
      setError("Choose your check-in and check-out dates.");
      return;
    }
    if (isPastDate(checkIn)) {
      setError("Check-in can't be in the past.");
      return;
    }
    if (!isValidStayRange(checkIn, checkOut)) {
      setError("Check-out must be after check-in.");
      return;
    }

    setError(null);
    setStay({ checkIn, checkOut, adults: guests.adults, children: guests.children });
    router.push("/booking/rooms");
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      noValidate
      className="mt-8 grid gap-6"
      variants={motionPrimitives.revealUp}
      transition={{ duration: 0.5, delay: 0.14, ease: luxuryEase }}
    >
      <div className="grid grid-cols-2 gap-5">
        <BookingFormField label="Check in" htmlFor="check-in" required>
          <input
            id="check-in"
            type="date"
            required
            min={todayISO()}
            value={checkIn}
            onChange={(event) => handleCheckInChange(event.target.value)}
            className={bookingInputClassName}
          />
        </BookingFormField>
        <BookingFormField label="Check out" htmlFor="check-out" required>
          <input
            id="check-out"
            type="date"
            required
            min={checkIn || todayISO()}
            value={checkOut}
            onChange={(event) => setCheckOut(event.target.value)}
            className={bookingInputClassName}
          />
        </BookingFormField>
      </div>

      <fieldset className="m-0 border-0 p-0">
        <legend className="label mb-2 p-0 text-ink/56">Guests</legend>
        <GuestSelector value={guests} onChange={setGuests} />
      </fieldset>

      {error ? (
        <p role="alert" className="text-[0.82rem] text-terracotta">
          {error}
        </p>
      ) : null}

      <button type="submit" className="brass-button mt-2 min-h-11 w-full">
        Search availability -&gt;
      </button>
    </motion.form>
  );
}

export function StaySearchForm() {
  const searchParams = useSearchParams();
  const { state, hydrated, selectRoom } = useBooking();

  // Waits for `hydrated` so this always runs *after* any sessionStorage
  // restore has resolved — otherwise a same-session HYDRATE (which replaces
  // state wholesale) can land right after this dispatch and silently wipe
  // out the room the URL just asked to preselect. Comparing against the
  // current selection avoids redundant dispatches (and any effect churn)
  // once the two already agree.
  useEffect(() => {
    if (!hydrated) return;
    const roomSlug = searchParams.get("room");
    if (!roomSlug || roomSlug === state.selectedRoomSlug) return;
    if (rooms.some((room) => room.slug === roomSlug)) selectRoom(roomSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, hydrated]);

  return (
    <motion.div
      className="mx-auto flex min-h-[70dvh] max-w-[520px] flex-col justify-center px-[var(--page-x)] py-[clamp(2rem,5vw,3rem)]"
      initial="hidden"
      animate="show"
      variants={motionPrimitives.staggerContainer}
    >
      <motion.p
        className="label text-aged-gold"
        variants={motionPrimitives.precisionDetail}
        transition={{ duration: 0.4, ease: luxuryEase }}
      >
        Reserve your stay
      </motion.p>
      <motion.h1
        className="display mt-3 text-[clamp(1.7rem,5vw,2.1rem)] leading-[1.1] text-ink"
        variants={motionPrimitives.editorialText}
        transition={{ duration: 0.6, delay: 0.06, ease: luxuryEase }}
      >
        When would you like to arrive?
      </motion.h1>

      {hydrated ? <StaySearchFields initial={state} /> : null}
    </motion.div>
  );
}
