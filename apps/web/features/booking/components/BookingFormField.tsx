import type { ReactNode } from "react";

/** Shared bottom-line treatment for every text/select/date/textarea field in the booking flow. */
export const bookingInputClassName =
  "w-full border-b border-ink/22 bg-transparent py-2.5 text-[0.92rem] text-ink outline-none transition-colors focus:border-brass";

export const bookingInputErrorClassName = "border-terracotta";

type BookingFormFieldProps = {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
};

// One label/input/error pattern for every booking form — real `<label>`s,
// never placeholder-as-label, errors announced and visually tied to their
// field via `aria-describedby` on the input itself.
export function BookingFormField({ label, htmlFor, error, hint, required, children }: BookingFormFieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label text-ink/56">
        {label}
        {required ? <span className="text-brass"> *</span> : null}
      </label>
      <div className="mt-2">{children}</div>
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-[0.78rem] text-terracotta">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-[0.78rem] text-ink/44">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
