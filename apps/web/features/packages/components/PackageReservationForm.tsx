"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicPackageDetail } from "@/features/packages/api/contracts";
import { submitPackageReservation, type PackageReservationOutcome } from "@/features/packages/api/reservationClient";
import {
  buildPackageReservationRequest,
  emptyPackageReservationDraft,
  validatePackageReservationDraft,
  variantNeedsChildAges,
  type PackageReservationDraft,
  type PackageReservationFormErrors,
} from "@/features/packages/lib/reservationForm";
import { childRuleLabel, formatUsdMoney } from "@/features/packages/lib/publicPresentation";
import { FormErrorSummary, FormField, FormGroup, RequiredNote, fieldControlClass } from "@/shared/components/ui/form";
import { InfoSection } from "@/shared/components/ui/InfoSection";

const fieldOrder: Array<keyof PackageReservationDraft> = [
  "variantKey", "tourDate", "adults", "children", "childAges", "guestFirstName", "guestLastName", "guestEmail", "guestPhone", "guestCountry", "specialRequests",
];

export function PackageReservationForm({ pkg }: { pkg: PublicPackageDetail }) {
  const [draft, setDraft] = useState(() => emptyPackageReservationDraft(pkg));
  const [errors, setErrors] = useState<PackageReservationFormErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locked, setLocked] = useState(false);
  const [outcome, setOutcome] = useState<PackageReservationOutcome | null>(null);
  const inFlightRef = useRef(false);
  const statusRef = useRef<HTMLDivElement>(null);

  const selectedVariant = useMemo(() => pkg.variants.find((variant) => variant.key === draft.variantKey), [draft.variantKey, pkg.variants]);
  const childCount = /^\d+$/.test(draft.children) ? Number(draft.children) : 0;
  const needsChildAges = variantNeedsChildAges(selectedVariant, childCount);

  useEffect(() => {
    if (outcome || locked) statusRef.current?.focus();
  }, [locked, outcome]);

  function update<K extends keyof PackageReservationDraft>(field: K, value: PackageReservationDraft[K]) {
    const next = { ...draft, [field]: value };
    if (field === "children") next.childAges = [];
    if (field === "variantKey") next.childAges = [];
    setDraft(next);
    if (attempted) setErrors(validatePackageReservationDraft(pkg, next));
    if (outcome?.kind === "refused") setOutcome(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlightRef.current || locked) return;
    setAttempted(true);
    const nextErrors = validatePackageReservationDraft(pkg, draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const first = fieldOrder.find((field) => nextErrors[field]);
      if (first) document.getElementById(`package-${first}`)?.focus();
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setOutcome(null);
    try {
      const result = await submitPackageReservation(buildPackageReservationRequest(pkg, draft));
      setOutcome(result);
      if (result.kind === "success") {
        setDraft((current) => ({
          ...current,
          guestFirstName: "",
          guestLastName: "",
          guestEmail: "",
          guestPhone: "",
          guestCountry: "",
          specialRequests: "",
        }));
      } else if (result.kind === "uncertain") {
        setLocked(true);
      }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  if (outcome?.kind === "success") {
    const confirmation = outcome.confirmation;
    return (
      <InfoSection id="reserve" title="Reservation request received">
        <div ref={statusRef} tabIndex={-1} role="status" className="form-panel outline-none">
          <p className="group-title">Reference {confirmation.bookingReference}</p>
          <p className="prose-body mt-3">Your request is pending confirmation. No payment has been taken.</p>
          <dl className="mt-5 grid gap-3 text-[0.9375rem] sm:grid-cols-2">
            <div><dt className="text-ink/65">Journey</dt><dd className="font-semibold">{confirmation.package.title}</dd></div>
            <div><dt className="text-ink/65">Option</dt><dd className="font-semibold">{confirmation.variant.label}</dd></div>
            <div><dt className="text-ink/65">Tour date</dt><dd className="font-semibold">{confirmation.tourDate}</dd></div>
            <div><dt className="text-ink/65">Party</dt><dd className="font-semibold">{confirmation.adults} adult{confirmation.adults === 1 ? "" : "s"}, {confirmation.children} child{confirmation.children === 1 ? "" : "ren"}</dd></div>
          </dl>
          {confirmation.pricingStatus === "quoted" && confirmation.totalAmount ? (
            <p className="mt-5 text-[1.05rem] font-semibold">Quoted total: {formatUsdMoney(confirmation.totalAmount)}</p>
          ) : (
            <p className="mt-5 text-[1rem] font-semibold">Final price requires confirmation.</p>
          )}
        </div>
      </InfoSection>
    );
  }

  if (locked) {
    return (
      <InfoSection id="reserve" title="Reservation status could not be confirmed">
        <div ref={statusRef} tabIndex={-1} role="alert" className="form-panel outline-none">
          <p className="group-title">Do not submit this request again yet.</p>
          <p className="prose-body mt-3">The request may have reached the hotel, but the website could not confirm the result. Please contact the hotel and check before making another reservation request.</p>
        </div>
      </InfoSection>
    );
  }

  const refusal = outcome?.kind === "refused" ? outcome.error.message : null;
  const clientErrorCount = attempted ? Object.keys(errors).length : 0;

  return (
    <InfoSection id="reserve" title="Request this journey" intro="Choose one date and party size. The request starts pending; there is no online payment.">
      <form onSubmit={handleSubmit} noValidate className="form-panel">
        <RequiredNote />
        <FormGroup title="Journey details">
          {pkg.variants.length > 1 ? (
            <FormField label="Option" id="package-variantKey" required error={attempted ? errors.variantKey : undefined}>
              {(control) => <select {...control} value={draft.variantKey} onChange={(event) => update("variantKey", event.target.value)} className={fieldControlClass}><option value="">Select an option</option>{pkg.variants.map((variant) => <option key={variant.key} value={variant.key}>{variant.label}</option>)}</select>}
            </FormField>
          ) : selectedVariant ? <p className="fine-print">Option: <strong className="text-ink">{selectedVariant.label}</strong></p> : null}

          <div className="grid gap-5 sm:grid-cols-3">
            <FormField label="Tour date" id="package-tourDate" required error={attempted ? errors.tourDate : undefined}>
              {(control) => <input {...control} type="date" value={draft.tourDate} onChange={(event) => update("tourDate", event.target.value)} className={fieldControlClass} />}
            </FormField>
            <FormField label="Adults" id="package-adults" required error={attempted ? errors.adults : undefined}>
              {(control) => <input {...control} type="number" min="1" step="1" value={draft.adults} onChange={(event) => update("adults", event.target.value)} className={fieldControlClass} />}
            </FormField>
            <FormField label="Children" id="package-children" required error={attempted ? errors.children : undefined}>
              {(control) => <input {...control} type="number" min="0" step="1" value={draft.children} onChange={(event) => update("children", event.target.value)} className={fieldControlClass} />}
            </FormField>
          </div>

          {needsChildAges ? (
            <div>
              <p className="field-label">Child ages <span aria-hidden="true" className="text-[var(--danger)]">*</span></p>
              {selectedVariant ? <p className="field-hint mb-3">{childRuleLabel(selectedVariant)}</p> : null}
              <input
                id="package-childAges"
                aria-label="Child ages"
                aria-invalid={attempted && errors.childAges ? true : undefined}
                value={draft.childAges.join(", ")}
                onChange={(event) => update("childAges", event.target.value === "" ? [] : event.target.value.split(",").map((age) => age.trim()))}
                placeholder="Example: 7, 10"
                className={fieldControlClass}
              />
              <p className="field-hint mt-2">Enter one age per child, separated by commas.</p>
              {attempted && errors.childAges ? <p role="alert" className="field-error mt-2">{errors.childAges}</p> : null}
            </div>
          ) : null}
        </FormGroup>

        <FormGroup title="Guest contact">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="First name" id="package-guestFirstName" required error={attempted ? errors.guestFirstName : undefined}>{(control) => <input {...control} autoComplete="given-name" value={draft.guestFirstName} onChange={(event) => update("guestFirstName", event.target.value)} className={fieldControlClass} />}</FormField>
            <FormField label="Last name" id="package-guestLastName" required error={attempted ? errors.guestLastName : undefined}>{(control) => <input {...control} autoComplete="family-name" value={draft.guestLastName} onChange={(event) => update("guestLastName", event.target.value)} className={fieldControlClass} />}</FormField>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Email" id="package-guestEmail" required error={attempted ? errors.guestEmail : undefined}>{(control) => <input {...control} type="email" autoComplete="email" value={draft.guestEmail} onChange={(event) => update("guestEmail", event.target.value)} className={fieldControlClass} />}</FormField>
            <FormField label="Phone" id="package-guestPhone" required error={attempted ? errors.guestPhone : undefined}>{(control) => <input {...control} type="tel" autoComplete="tel" value={draft.guestPhone} onChange={(event) => update("guestPhone", event.target.value)} className={fieldControlClass} />}</FormField>
          </div>
          <FormField label="Country" id="package-guestCountry" required error={attempted ? errors.guestCountry : undefined}>{(control) => <input {...control} autoComplete="country-name" value={draft.guestCountry} onChange={(event) => update("guestCountry", event.target.value)} className={fieldControlClass} />}</FormField>
          <FormField label="Special requests" id="package-specialRequests" error={attempted ? errors.specialRequests : undefined}>{(control) => <textarea {...control} rows={4} maxLength={2000} value={draft.specialRequests} onChange={(event) => update("specialRequests", event.target.value)} className={fieldControlClass} />}</FormField>
        </FormGroup>

        <FormErrorSummary message={refusal ?? (clientErrorCount ? `Please fix ${clientErrorCount} field${clientErrorCount === 1 ? "" : "s"} above.` : null)} />
        <button type="submit" disabled={submitting} className="btn btn-primary mt-6 w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[14rem]">{submitting ? "Sending request…" : "Send reservation request"}</button>
      </form>
    </InfoSection>
  );
}
