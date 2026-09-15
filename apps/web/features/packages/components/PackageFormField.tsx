import type { ReactNode } from "react";

/** Shared bottom-line treatment for the inquiry form's fields — matches the booking flow's form language. */
export const packageInputClassName =
  "w-full border-b border-ink/22 bg-transparent py-2.5 text-[0.92rem] text-ink outline-none transition-colors focus:border-brass";

type PackageFormFieldProps = {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
};

export function PackageFormField({ label, htmlFor, error, hint, required, children }: PackageFormFieldProps) {
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
