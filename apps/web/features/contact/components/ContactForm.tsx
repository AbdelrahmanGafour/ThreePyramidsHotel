"use client";

import { useEffect, useRef, useState } from "react";
import { FormErrorSummary, FormField, FormGroup, RequiredNote, fieldControlClass } from "@/shared/components/ui/form";
import { contactInfo } from "@/features/contact/data/contactData";
import {
  CONTACT_SUBMISSION_ERROR_MESSAGE,
  submitContactInquiry,
} from "@/features/contact/lib/contactApi";
import { hasContactInquiryErrors, validateContactInquiry, type ContactInquiryErrors } from "@/features/contact/lib/validation";
import { emptyContactInquiryDetails, inquiryTypes, type ContactInquiryDetails } from "@/features/contact/types";

// Submits to the same-origin bridge at /api/v1/contact, which forwards to
// Express. The confirmation panel below is shown only after the backend has
// actually accepted the inquiry — never on a local validation pass alone.
//
// Accepting an inquiry queues it; the hotel is emailed asynchronously. Nothing
// is sent to the visitor, so the copy promises a reply from a person and never
// claims a confirmation email is on its way.
export function ContactForm() {
  const [values, setValues] = useState<ContactInquiryDetails>(emptyContactInquiryDetails);
  const [errors, setErrors] = useState<ContactInquiryErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /**
   * The honeypot: a field a real visitor never sees and never fills in.
   *
   * Kept in state like any other so it is always sent, blank or not — the
   * server is what decides. Never mentioned in any visible copy.
   */
  const [website, setWebsite] = useState("");
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (sent) confirmationHeadingRef.current?.focus();
  }, [sent]);

  // Once a submit has been attempted, re-check on every change so a fixed
  // field's error clears as soon as it's fixed.
  const update = (field: keyof ContactInquiryDetails, value: string) => {
    const next = { ...values, [field]: value } as ContactInquiryDetails;
    setValues(next);
    if (submitted) setErrors(validateContactInquiry(next));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    // A second submit while one is in flight would send the same inquiry
    // twice, and the hotel would get two emails about one message.
    if (pending) return;

    setSubmitted(true);
    const nextErrors = validateContactInquiry(values);
    setErrors(nextErrors);

    if (hasContactInquiryErrors(nextErrors)) {
      const fieldOrder: (keyof ContactInquiryDetails)[] = ["firstName", "lastName", "email", "phone", "inquiryType", "message"];
      const firstInvalid = fieldOrder.find((field) => nextErrors[field]);
      if (firstInvalid) document.getElementById(`inquiry-${firstInvalid}`)?.focus();
      return;
    }

    setPending(true);
    setSubmitError(null);

    const result = await submitContactInquiry({ ...values, website });

    setPending(false);

    // The confirmation panel appears for one reason only: the backend said it
    // accepted the inquiry. A refusal and a fault both leave the visitor here
    // with everything they typed still in the form, free to try again.
    if (result.outcome === "success") {
      setSent(true);
      return;
    }

    setSubmitError(CONTACT_SUBMISSION_ERROR_MESSAGE);
  };

  const sendAnother = () => {
    setValues(emptyContactInquiryDetails);
    setErrors({});
    setSubmitted(false);
    setSent(false);
    setSubmitError(null);
    setWebsite("");
  };

  if (sent) {
    const inquiryLabel = values.inquiryType === "General inquiry" ? "inquiry" : `${values.inquiryType.toLowerCase()} inquiry`;

    return (
      <div role="status" aria-live="polite" className="form-panel">
        <span className="flex h-12 w-12 items-center justify-center border-2 border-aged-gold text-[var(--brass-ink)]" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 12.5 9.5 18 20 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h2 ref={confirmationHeadingRef} tabIndex={-1} className="section-title mt-4 outline-none">
          Thank you for getting in touch, {values.firstName}.
        </h2>
        <p className="prose-body mt-3">
          Your message has been received. Our team will be in touch shortly about your {inquiryLabel}. For anything urgent, call{" "}
          <a
            href={`tel:${contactInfo.phone.replace(/[\s()]/g, "")}`}
            className="font-semibold text-ink underline decoration-ink/35 underline-offset-4 hover:text-[var(--brass-ink)]"
          >
            {contactInfo.phone}
          </a>{" "}
          directly.
        </p>
        <button type="button" onClick={sendAnother} className="btn btn-secondary mt-6 w-full sm:w-auto">
          Send another inquiry
        </button>
      </div>
    );
  }

  const errorCount = submitted ? Object.keys(errors).length : 0;

  return (
    <div>
      <h2 className="section-title">Send an inquiry</h2>
      <p className="prose-body mt-2">
        Tell us what you need and our team will get back to you using the details you provide.
      </p>

      <form onSubmit={handleSubmit} noValidate className="form-panel mt-5">
        {/*
          Not a field anybody is meant to fill in. It is removed from the
          accessibility tree and skipped by keyboard and autofill, so a person
          using a screen reader or tabbing through never meets it — while an
          automated submitter that fills every input it finds will.

          `hidden` is deliberately not used: some submitters skip hidden inputs
          outright, which would defeat the point. It is positioned off-screen
          instead.
        */}
        <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="inquiry-website">Do not fill this in</label>
          <input
            id="inquiry-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </div>

        <RequiredNote />

        <FormGroup title="Your details">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="First name" id="inquiry-firstName" required error={submitted ? errors.firstName : undefined}>
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
            <FormField label="Last name" id="inquiry-lastName" required error={submitted ? errors.lastName : undefined}>
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

          <FormField
            label="Phone number"
            id="inquiry-phone"
            hint="Helpful if you'd like a call back."
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

        <FormGroup title="Your inquiry">
          <FormField label="What is your inquiry about?" id="inquiry-inquiryType" required error={submitted ? errors.inquiryType : undefined}>
            {(control) => (
              <select
                {...control}
                value={values.inquiryType}
                onChange={(event) => update("inquiryType", event.target.value)}
                className={fieldControlClass}
              >
                <option value="">Choose a topic</option>
                {inquiryTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField label="Your message" id="inquiry-message" required error={submitted ? errors.message : undefined}>
            {(control) => (
              <textarea
                {...control}
                rows={5}
                value={values.message}
                onChange={(event) => update("message", event.target.value)}
                className={fieldControlClass}
              />
            )}
          </FormField>
        </FormGroup>

        <FormErrorSummary
          message={
            errorCount
              ? `Please fix ${errorCount} field${errorCount === 1 ? "" : "s"} above, then send your inquiry.`
              : submitError
          }
        />

        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="btn btn-primary mt-6 w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[14rem]"
        >
          {pending ? "Sending…" : "Send inquiry"}
        </button>
      </form>
    </div>
  );
}
