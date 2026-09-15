"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as motion from "motion/react-client";
import { luxuryEase, motionPrimitives } from "@/shared/components/motion/PremiumMotion";
import { BookingActions } from "@/features/booking/components/BookingActions";
import { BookingEmptyState } from "@/features/booking/components/BookingEmptyState";
import { BookingFormField, bookingInputClassName } from "@/features/booking/components/BookingFormField";
import { useBooking } from "@/features/booking/context/BookingContext";
import { DEMO_ARRIVAL_WINDOWS, DEMO_COUNTRIES } from "@/features/booking/data/bookingDemoData";
import { hasGuestDetailsErrors, validateGuestDetails, type GuestDetailsErrors } from "@/features/booking/lib/validation";
import type { GuestDetails } from "@/features/booking/types";

// Only mounted once the guards below pass, so its lazy `useState` reads the
// already-restored guest details on its real first render.
function GuestDetailsFields({ initial }: { initial: GuestDetails }) {
  const router = useRouter();
  const { setGuest } = useBooking();

  const [values, setValues] = useState<GuestDetails>(initial);
  const [errors, setErrors] = useState<GuestDetailsErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const update = (field: keyof GuestDetails, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const nextErrors = validateGuestDetails(values);
    setErrors(nextErrors);

    if (hasGuestDetailsErrors(nextErrors)) {
      const fieldOrder: (keyof GuestDetails)[] = ["firstName", "lastName", "email", "phone", "country"];
      const firstInvalid = fieldOrder.find((field) => nextErrors[field]);
      if (firstInvalid) {
        const fieldId = firstInvalid.replace(/([A-Z])/g, "-$1").toLowerCase();
        document.getElementById(fieldId)?.focus();
      }
      return;
    }

    setGuest(values);
    router.push("/booking/review");
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
        <BookingFormField label="First name" htmlFor="first-name" required error={submitted ? errors.firstName : undefined}>
          <input
            id="first-name"
            autoComplete="given-name"
            value={values.firstName}
            onChange={(event) => update("firstName", event.target.value)}
            aria-describedby={errors.firstName ? "first-name-error" : undefined}
            aria-invalid={Boolean(submitted && errors.firstName)}
            className={bookingInputClassName}
          />
        </BookingFormField>
        <BookingFormField label="Last name" htmlFor="last-name" required error={submitted ? errors.lastName : undefined}>
          <input
            id="last-name"
            autoComplete="family-name"
            value={values.lastName}
            onChange={(event) => update("lastName", event.target.value)}
            aria-describedby={errors.lastName ? "last-name-error" : undefined}
            aria-invalid={Boolean(submitted && errors.lastName)}
            className={bookingInputClassName}
          />
        </BookingFormField>
      </div>

      <BookingFormField label="Email" htmlFor="email" required error={submitted ? errors.email : undefined}>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(event) => update("email", event.target.value)}
          aria-describedby={errors.email ? "email-error" : undefined}
          aria-invalid={Boolean(submitted && errors.email)}
          className={bookingInputClassName}
        />
      </BookingFormField>

      <BookingFormField label="Phone" htmlFor="phone" required error={submitted ? errors.phone : undefined}>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          value={values.phone}
          onChange={(event) => update("phone", event.target.value)}
          aria-describedby={errors.phone ? "phone-error" : undefined}
          aria-invalid={Boolean(submitted && errors.phone)}
          className={bookingInputClassName}
        />
      </BookingFormField>

      <BookingFormField label="Country" htmlFor="country" required error={submitted ? errors.country : undefined}>
        <select
          id="country"
          autoComplete="country-name"
          value={values.country}
          onChange={(event) => update("country", event.target.value)}
          aria-describedby={errors.country ? "country-error" : undefined}
          aria-invalid={Boolean(submitted && errors.country)}
          className={bookingInputClassName}
        >
          <option value="">Select country</option>
          {DEMO_COUNTRIES.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>
      </BookingFormField>

      <BookingFormField label="Expected arrival time" htmlFor="arrival-time" hint="Optional — helps us prepare for you.">
        <select
          id="arrival-time"
          value={values.arrivalTime}
          onChange={(event) => update("arrivalTime", event.target.value)}
          className={bookingInputClassName}
        >
          <option value="">No preference</option>
          {DEMO_ARRIVAL_WINDOWS.map((window) => (
            <option key={window} value={window}>
              {window}
            </option>
          ))}
        </select>
      </BookingFormField>

      <BookingFormField label="Special requests" htmlFor="special-requests" hint="Optional — quiet floor, early check-in, celebrations.">
        <textarea
          id="special-requests"
          rows={3}
          value={values.specialRequests}
          onChange={(event) => update("specialRequests", event.target.value)}
          className={`${bookingInputClassName} resize-none`}
        />
      </BookingFormField>

      <BookingActions backHref="/booking/rooms" continueLabel="Continue to review ->" continueType="submit" />
    </motion.form>
  );
}

export function GuestDetailsForm() {
  const { state, hydrated, hasValidStay, hasSelectedRoom } = useBooking();

  if (!hydrated) return null;

  if (!hasValidStay) {
    return <BookingEmptyState title="Start your reservation" message="Choose your dates to begin." />;
  }

  if (!hasSelectedRoom) {
    return (
      <BookingEmptyState
        title="Choose a room first"
        message="Pick the room you'd like to reserve before adding your details."
        actionLabel="Choose a room"
        actionHref="/booking/rooms"
      />
    );
  }

  return (
    <motion.div
      className="mx-auto max-w-[560px] px-[var(--page-x)] py-[clamp(2.5rem,5vw,3.75rem)]"
      initial="hidden"
      animate="show"
      variants={motionPrimitives.staggerContainer}
    >
      <motion.p
        className="label text-aged-gold"
        variants={motionPrimitives.precisionDetail}
        transition={{ duration: 0.4, ease: luxuryEase }}
      >
        Guest details
      </motion.p>
      <motion.h1
        className="display mt-3 text-[clamp(1.7rem,5vw,2.1rem)] leading-[1.1] text-ink"
        variants={motionPrimitives.editorialText}
        transition={{ duration: 0.6, delay: 0.06, ease: luxuryEase }}
      >
        Who should we prepare the room for?
      </motion.h1>

      <GuestDetailsFields initial={state.guest} />
    </motion.div>
  );
}
