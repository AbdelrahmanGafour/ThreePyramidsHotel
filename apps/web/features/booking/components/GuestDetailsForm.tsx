"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormErrorSummary, FormField, FormGroup, RequiredNote, fieldControlClass } from "@/shared/components/ui/form";
import { BookingActions } from "@/features/booking/components/BookingActions";
import { BookingEmptyState } from "@/features/booking/components/BookingEmptyState";
import { BookingStepHeader } from "@/features/booking/components/BookingStepHeader";
import { useBooking } from "@/features/booking/context/BookingContext";
import { DEMO_COUNTRIES } from "@/features/booking/data/bookingDemoData";
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

  // Once a submit has been attempted, re-check on every change so a fixed
  // field's error clears as soon as it's fixed.
  const update = (field: keyof GuestDetails, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    if (submitted) setErrors(validateGuestDetails(next));
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

  const errorCount = submitted ? Object.keys(errors).length : 0;

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8">
      <div className="form-panel">
        <RequiredNote />

        <FormGroup title="Guest information" description="The name the reservation will be under.">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="First name" id="first-name" required error={submitted ? errors.firstName : undefined}>
              {(control) => (
                <input
                  {...control}
                  autoComplete="given-name"
                  value={values.firstName}
                  onChange={(event) => update("firstName", event.target.value)}
                  className={fieldControlClass}
                />
              )}
            </FormField>
            <FormField label="Last name" id="last-name" required error={submitted ? errors.lastName : undefined}>
              {(control) => (
                <input
                  {...control}
                  autoComplete="family-name"
                  value={values.lastName}
                  onChange={(event) => update("lastName", event.target.value)}
                  className={fieldControlClass}
                />
              )}
            </FormField>
          </div>

          <FormField label="Country" id="country" required error={submitted ? errors.country : undefined}>
            {(control) => (
              <select
                {...control}
                autoComplete="country-name"
                value={values.country}
                onChange={(event) => update("country", event.target.value)}
                className={fieldControlClass}
              >
                <option value="">Select your country</option>
                {DEMO_COUNTRIES.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </FormGroup>

        <FormGroup title="Contact information" description="We'll send your confirmation here and use it if we need to reach you.">
          <FormField label="Email address" id="email" required error={submitted ? errors.email : undefined}>
            {(control) => (
              <input
                {...control}
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={(event) => update("email", event.target.value)}
                className={fieldControlClass}
              />
            )}
          </FormField>

          <FormField
            label="Phone number"
            id="phone"
            required
            hint="Include the country code if you're outside Egypt."
            error={submitted ? errors.phone : undefined}
          >
            {(control) => (
              <input
                {...control}
                type="tel"
                autoComplete="tel"
                value={values.phone}
                onChange={(event) => update("phone", event.target.value)}
                className={fieldControlClass}
              />
            )}
          </FormField>
        </FormGroup>

        <FormGroup title="Special requests" description="Optional. Tell us anything that would make your stay easier.">
          <FormField label="Requests or notes" id="special-requests" hint="For example: a quiet floor, early check-in, or a celebration.">
            {(control) => (
              <textarea
                {...control}
                rows={4}
                value={values.specialRequests}
                onChange={(event) => update("specialRequests", event.target.value)}
                className={fieldControlClass}
              />
            )}
          </FormField>
        </FormGroup>

        <FormErrorSummary
          message={errorCount ? `Please fix ${errorCount} field${errorCount === 1 ? "" : "s"} above, then continue.` : null}
        />
      </div>

      <BookingActions backHref="/booking/rooms" backLabel="Back to room selection" continueLabel="Review reservation" continueType="submit" />
    </form>
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
        message="Choose the room you'd like to reserve before adding your details."
        actionLabel="Choose a room"
        actionHref="/booking/rooms"
      />
    );
  }

  return (
    <div className="mx-auto max-w-[640px] px-[var(--page-x)] py-[clamp(2rem,5vw,3.5rem)]">
      <BookingStepHeader step="Step 3 of 4" title="Tell us who the reservation is for">
        We&apos;ll use these details to prepare your stay and send your confirmation.
      </BookingStepHeader>

      <GuestDetailsFields initial={state.guest} />
    </div>
  );
}
