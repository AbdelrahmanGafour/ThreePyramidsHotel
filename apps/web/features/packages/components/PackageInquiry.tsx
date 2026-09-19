"use client";

import { useEffect, useRef, useState } from "react";
import { FormErrorSummary, FormField, FormGroup, RequiredNote, fieldControlClass } from "@/shared/components/ui/form";
import { InfoSection } from "@/shared/components/ui/InfoSection";
import { hasPackageInquiryErrors, validatePackageInquiry, type PackageInquiryErrors } from "@/features/packages/lib/validation";
import { emptyPackageInquiryDetails, type Package, type PackageInquiryDetails } from "@/features/packages/types";

type PackageInquiryProps = {
  pkg: Package;
};

// Frontend-only: packages don't fit the room-booking flow's date-range/room
// state model (multi-day itinerary, per-person pricing tiers, no fixed
// check-in/out), and a dedicated multi-step package-booking flow would be
// premature without confirmed inventory or a payment step to build toward.
// This is a single, self-contained inquiry — the submit handler is the
// integration boundary a backend can replace with a real API call later.
export function PackageInquiry({ pkg }: PackageInquiryProps) {
  const [values, setValues] = useState<PackageInquiryDetails>(emptyPackageInquiryDetails);
  const [errors, setErrors] = useState<PackageInquiryErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [sent, setSent] = useState(false);
  const confirmationRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (sent) confirmationRef.current?.focus();
  }, [sent]);

  // Once a submit has been attempted, re-check on every change so a fixed
  // field's error clears as soon as it's fixed.
  const update = (field: keyof PackageInquiryDetails, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    if (submitted) setErrors(validatePackageInquiry(next));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const nextErrors = validatePackageInquiry(values);
    setErrors(nextErrors);

    if (hasPackageInquiryErrors(nextErrors)) {
      const fieldOrder: (keyof PackageInquiryDetails)[] = ["name", "email", "phone"];
      const firstInvalid = fieldOrder.find((field) => nextErrors[field]);
      if (firstInvalid) document.getElementById(`inquiry-${firstInvalid}`)?.focus();
      return;
    }

    // DEMO — local UI state only. No inquiry has actually been sent; wire
    // this to a real endpoint before launch.
    setSent(true);
  };

  if (sent) {
    return (
      <InfoSection id="inquire" title="Inquiry received">
        <div role="status" className="form-panel">
          <p ref={confirmationRef} tabIndex={-1} className="group-title outline-none">
            Thank you. We&apos;ll be in touch about {pkg.shortTitle}.
          </p>
          <p className="prose-body mt-3">
            This is a demo confirmation for design review — no inquiry has actually been sent. Once connected, the hotel would
            typically reply within one business day.
          </p>
        </div>
      </InfoSection>
    );
  }

  const errorCount = submitted ? Object.keys(errors).length : 0;

  return (
    <InfoSection
      id="inquire"
      title="Send an inquiry"
      intro={`Tell us about your dates and group. The hotel will reply to shape ${pkg.shortTitle} around you.`}
    >
      <form onSubmit={handleSubmit} noValidate className="form-panel">
        <RequiredNote />

        <FormGroup title="Your details">
          <FormField label="Full name" id="inquiry-name" required error={submitted ? errors.name : undefined}>
            {(control) => (
              <input
                {...control}
                autoComplete="name"
                value={values.name}
                onChange={(event) => update("name", event.target.value)}
                className={fieldControlClass}
              />
            )}
          </FormField>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="Email address" id="inquiry-email" required error={submitted ? errors.email : undefined}>
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
            <FormField label="Phone number" id="inquiry-phone" required error={submitted ? errors.phone : undefined}>
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
          </div>
        </FormGroup>

        <FormGroup title="Your journey" description="Optional. These help us plan, but you can send the inquiry without them.">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="Preferred dates" id="inquiry-dates" hint="A rough window is fine, such as “early March”.">
              {(control) => (
                <input
                  {...control}
                  value={values.preferredDates}
                  onChange={(event) => update("preferredDates", event.target.value)}
                  className={fieldControlClass}
                />
              )}
            </FormField>
            <FormField label="Number of guests" id="inquiry-party-size" hint="How many people are travelling.">
              {(control) => (
                <input
                  {...control}
                  inputMode="numeric"
                  value={values.partySize}
                  onChange={(event) => update("partySize", event.target.value)}
                  className={fieldControlClass}
                />
              )}
            </FormField>
          </div>

          <FormField label="Message" id="inquiry-message" hint="Anything that helps us shape the journey.">
            {(control) => (
              <textarea
                {...control}
                rows={4}
                value={values.message}
                onChange={(event) => update("message", event.target.value)}
                className={fieldControlClass}
              />
            )}
          </FormField>
        </FormGroup>

        <FormErrorSummary
          message={errorCount ? `Please fix ${errorCount} field${errorCount === 1 ? "" : "s"} above, then send your inquiry.` : null}
        />

        <button type="submit" className="btn btn-primary mt-6 w-full sm:w-auto sm:min-w-[14rem]">
          Send inquiry
        </button>
      </form>
    </InfoSection>
  );
}
