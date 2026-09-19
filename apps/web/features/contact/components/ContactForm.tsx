"use client";

import { useEffect, useRef, useState } from "react";
import { FormErrorSummary, FormField, FormGroup, RequiredNote, fieldControlClass } from "@/shared/components/ui/form";
import { contactInfo } from "@/features/contact/data/contactData";
import { hasContactInquiryErrors, validateContactInquiry, type ContactInquiryErrors } from "@/features/contact/lib/validation";
import { emptyContactInquiryDetails, inquiryTypes, type ContactInquiryDetails } from "@/features/contact/types";

// PRESENTATION/DEMO BEHAVIOR ONLY — there is no backend endpoint yet. This
// form validates locally and, on a valid submit, only flips local UI state
// to the confirmation panel below; no request is sent and no inquiry is
// persisted anywhere. Before production launch, wire the marked line in
// `handleSubmit` to a real inquiry endpoint — the confirmation copy below
// describes an outcome ("our team will be in touch") that does not actually
// happen until that integration exists.
export function ContactForm() {
  const [values, setValues] = useState<ContactInquiryDetails>(emptyContactInquiryDetails);
  const [errors, setErrors] = useState<ContactInquiryErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [sent, setSent] = useState(false);
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const nextErrors = validateContactInquiry(values);
    setErrors(nextErrors);

    if (hasContactInquiryErrors(nextErrors)) {
      const fieldOrder: (keyof ContactInquiryDetails)[] = ["firstName", "lastName", "email", "phone", "inquiryType", "message"];
      const firstInvalid = fieldOrder.find((field) => nextErrors[field]);
      if (firstInvalid) document.getElementById(`inquiry-${firstInvalid}`)?.focus();
      return;
    }

    // DEMO — no network request happens here. See file header comment.
    setSent(true);
  };

  const sendAnother = () => {
    setValues(emptyContactInquiryDetails);
    setErrors({});
    setSubmitted(false);
    setSent(false);
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
          message={errorCount ? `Please fix ${errorCount} field${errorCount === 1 ? "" : "s"} above, then send your inquiry.` : null}
        />

        <button type="submit" className="btn btn-primary mt-6 w-full sm:w-auto sm:min-w-[14rem]">
          Send inquiry
        </button>
      </form>
    </div>
  );
}
