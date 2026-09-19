"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormField, FormGroup, RequiredNote, fieldControlClass } from "@/shared/components/ui/form";
import { BookingActions } from "@/features/booking/components/BookingActions";
import { BookingStepHeader } from "@/features/booking/components/BookingStepHeader";
import { GuestSelector } from "@/features/booking/components/GuestSelector";
import { useBooking } from "@/features/booking/context/BookingContext";
import { isValidStayRange, isPastDate, nightsBetween, todayISO } from "@/features/booking/lib/dates";
import type { BookingState } from "@/features/booking/types";
import { rooms } from "@/features/rooms/data/roomsData";

type StayErrors = { checkIn?: string; checkOut?: string };

// Only mounted once `hydrated` is true, so its lazy `useState` initializers
// read the already-restored booking state on their real first render — no
// effect needed to sync local state from context after the fact.
function StaySearchFields({ initial }: { initial: BookingState }) {
  const router = useRouter();
  const { setStay } = useBooking();

  const [checkIn, setCheckIn] = useState(initial.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initial.checkOut ?? "");
  const [guests, setGuests] = useState({ adults: initial.adults, children: initial.children });
  const [errors, setErrors] = useState<StayErrors>({});

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

    const nextErrors: StayErrors = {};
    if (!checkIn) nextErrors.checkIn = "Choose your check-in date.";
    else if (isPastDate(checkIn)) nextErrors.checkIn = "Check-in can't be in the past. Choose today or a later date.";

    if (!checkOut) nextErrors.checkOut = "Choose your check-out date.";
    else if (checkIn && !nextErrors.checkIn && !isValidStayRange(checkIn, checkOut)) {
      nextErrors.checkOut = "Check-out must be after check-in. Choose a later date.";
    }

    setErrors(nextErrors);
    if (nextErrors.checkIn || nextErrors.checkOut) {
      document.getElementById(nextErrors.checkIn ? "check-in" : "check-out")?.focus();
      return;
    }

    setStay({ checkIn, checkOut, adults: guests.adults, children: guests.children });
    router.push("/booking/rooms");
  };

  const nights = nightsBetween(checkIn, checkOut);

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8">
      <div className="form-panel">
        <RequiredNote />

        <FormGroup title="Your dates">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="Check-in date" id="check-in" required error={errors.checkIn}>
              {(control) => (
                <input
                  {...control}
                  type="date"
                  required
                  min={todayISO()}
                  value={checkIn}
                  onChange={(event) => handleCheckInChange(event.target.value)}
                  className={fieldControlClass}
                />
              )}
            </FormField>
            <FormField label="Check-out date" id="check-out" required error={errors.checkOut}>
              {(control) => (
                <input
                  {...control}
                  type="date"
                  required
                  min={checkIn || todayISO()}
                  value={checkOut}
                  onChange={(event) => setCheckOut(event.target.value)}
                  className={fieldControlClass}
                />
              )}
            </FormField>
          </div>
          {nights > 0 ? (
            <p role="status" className="text-[1rem] font-semibold text-ink">
              {nights} night{nights === 1 ? "" : "s"}
            </p>
          ) : null}
        </FormGroup>

        <FormGroup title="Guests" description="Choose one room for your whole party. Use the plus and minus buttons to change the numbers.">
          <GuestSelector value={guests} onChange={setGuests} />
        </FormGroup>
      </div>

      <BookingActions continueLabel="Continue to room selection" continueType="submit" />
    </form>
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

  const preselected = rooms.find((room) => room.slug === state.selectedRoomSlug);

  return (
    <div className="mx-auto max-w-[640px] px-[var(--page-x)] py-[clamp(2rem,5vw,3.5rem)]">
      <BookingStepHeader step="Step 1 of 4" title="Choose your stay dates">
        Choose your check-in and check-out dates and the number of guests. Next, you&apos;ll choose a room.
      </BookingStepHeader>

      {hydrated && preselected ? (
        <p className="mt-5 border-l-2 border-brass bg-[var(--panel-surface)] px-4 py-3 text-[1rem] text-ink/85">
          You&apos;re reserving <strong className="font-semibold text-ink">{preselected.name}</strong>. You can change the room in the
          next step.
        </p>
      ) : null}

      {hydrated ? <StaySearchFields initial={state} /> : null}
    </div>
  );
}
