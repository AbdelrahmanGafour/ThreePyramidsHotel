"use client";

import { useState } from "react";
import { PackageFormField, packageInputClassName } from "@/features/packages/components/PackageFormField";
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

  const update = (field: keyof PackageInquiryDetails, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
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
      <section id="inquire" className="scroll-mt-24 border-t border-ink/10 bg-ivory py-[clamp(2.75rem,5vw,4rem)] text-ink">
        <div className="mx-auto max-w-[480px] px-[var(--page-x)] text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center border border-brass text-brass" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 12.5 9.5 18 20 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="label mt-4 text-aged-gold">Inquiry received</p>
          <h2 className="display mt-3 text-[1.4rem] leading-[1.2] text-ink">We&apos;ll be in touch about {pkg.shortTitle}.</h2>
          <p className="mt-3 text-[0.88rem] leading-[1.65] text-ink/64">
            This is a demo confirmation for design review — no inquiry has actually been sent. Once connected, the
            hotel would typically reply within one business day.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="inquire" className="scroll-mt-24 border-t border-ink/10 bg-ivory py-[clamp(2.75rem,5vw,4rem)] text-ink">
      <div className="page-grid">
        <div className="col-span-6 col-start-2 max-md:col-span-full">
          <p className="label text-aged-gold">Enquire</p>
          <h2 className="display mt-3 text-[1.4rem] leading-[1.2] text-ink">Ask about {pkg.shortTitle}.</h2>
          <p className="mt-3 max-w-[440px] text-[0.88rem] leading-[1.65] text-ink/64">
            Share a few details and the hotel will follow up to shape the route around your dates.
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-8 grid max-w-[440px] gap-6">
            <PackageFormField label="Name" htmlFor="inquiry-name" required error={submitted ? errors.name : undefined}>
              <input
                id="inquiry-name"
                autoComplete="name"
                value={values.name}
                onChange={(event) => update("name", event.target.value)}
                aria-describedby={errors.name ? "inquiry-name-error" : undefined}
                aria-invalid={Boolean(submitted && errors.name)}
                className={packageInputClassName}
              />
            </PackageFormField>

            <div className="grid grid-cols-2 gap-5">
              <PackageFormField label="Email" htmlFor="inquiry-email" required error={submitted ? errors.email : undefined}>
                <input
                  id="inquiry-email"
                  type="email"
                  autoComplete="email"
                  value={values.email}
                  onChange={(event) => update("email", event.target.value)}
                  aria-describedby={errors.email ? "inquiry-email-error" : undefined}
                  aria-invalid={Boolean(submitted && errors.email)}
                  className={packageInputClassName}
                />
              </PackageFormField>
              <PackageFormField label="Phone" htmlFor="inquiry-phone" required error={submitted ? errors.phone : undefined}>
                <input
                  id="inquiry-phone"
                  type="tel"
                  autoComplete="tel"
                  value={values.phone}
                  onChange={(event) => update("phone", event.target.value)}
                  aria-describedby={errors.phone ? "inquiry-phone-error" : undefined}
                  aria-invalid={Boolean(submitted && errors.phone)}
                  className={packageInputClassName}
                />
              </PackageFormField>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <PackageFormField label="Preferred dates" htmlFor="inquiry-dates" hint="Optional — a rough window is fine.">
                <input
                  id="inquiry-dates"
                  value={values.preferredDates}
                  onChange={(event) => update("preferredDates", event.target.value)}
                  className={packageInputClassName}
                />
              </PackageFormField>
              <PackageFormField label="Party size" htmlFor="inquiry-party-size" hint="Optional">
                <input
                  id="inquiry-party-size"
                  inputMode="numeric"
                  value={values.partySize}
                  onChange={(event) => update("partySize", event.target.value)}
                  className={packageInputClassName}
                />
              </PackageFormField>
            </div>

            <PackageFormField label="Message" htmlFor="inquiry-message" hint="Optional — anything that helps shape the route.">
              <textarea
                id="inquiry-message"
                rows={3}
                value={values.message}
                onChange={(event) => update("message", event.target.value)}
                className={`${packageInputClassName} resize-none`}
              />
            </PackageFormField>

            <button type="submit" className="brass-button mt-2 min-h-11 w-full sm:w-auto">
              Send inquiry -&gt;
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
