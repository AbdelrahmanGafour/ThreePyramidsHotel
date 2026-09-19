import type { ReactNode } from "react";

/** The one class every text / select / date / textarea control uses — styled in `globals.css`. */
export const fieldControlClass = "field-control";

type ControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
};

type FormFieldProps = {
  label: string;
  /** Becomes the control's `id`; hint/error ids derive from it. */
  id: string;
  error?: string;
  hint?: string;
  required?: boolean;
  /** Render prop so the control receives its id and aria wiring — no cloning, no guesswork. */
  children: (control: ControlProps) => ReactNode;
};

function AlertIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-[3px] shrink-0">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v4.2M8 10.9v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// One label / control / hint / error pattern for every form on the site:
// a real visible <label>, a required mark, an "(optional)" note on the rest,
// and an error that pairs an icon with text (never colour alone) and is tied
// to the control through aria-describedby.
export function FormField({ label, id, error, hint, required, children }: FormFieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-[var(--danger)]">
            {" "}
            *
          </span>
        ) : (
          <span className="ml-1.5 text-[0.875rem] font-normal text-ink/62">(optional)</span>
        )}
      </label>
      <div className="mt-2">
        {children({
          id,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
          "aria-required": required ? true : undefined,
        })}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="field-error">
          <AlertIcon />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type FormGroupProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

// A titled group of related fields — a real <fieldset>/<legend> so assistive
// tech announces the group, and a plain rule so sighted users see the split.
export function FormGroup({ title, description, children }: FormGroupProps) {
  return (
    <fieldset className="form-group">
      <legend>
        <span className="group-title block text-ink">{title}</span>
        {description ? <span className="fine-print mt-1 block">{description}</span> : null}
      </legend>
      <div className="grid gap-5">{children}</div>
    </fieldset>
  );
}

// Shown once at the top of a form so "*" is never a puzzle.
export function RequiredNote() {
  return (
    <p className="fine-print mb-6">
      Fields marked{" "}
      <span aria-hidden="true" className="font-bold text-[var(--danger)]">
        *
      </span>
      <span className="sr-only">with an asterisk</span> are required.
    </p>
  );
}

// The region stays mounted so screen readers announce the text when it appears.
export function FormErrorSummary({ message }: { message: string | null }) {
  return (
    <div role="alert" aria-live="assertive">
      {message ? (
        <p className="field-error mt-6 border border-[var(--danger)]/40 bg-[var(--danger)]/[0.06] px-3.5 py-3">
          <AlertIcon />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}
