/**
 * One labelled field with its help text.
 *
 * Purely presentational: it owns no validation, no state and no business rule.
 * It exists because the same label/control/hint markup was written out four
 * times across the room-type forms, and a fifth copy is one too many.
 *
 * The hint is always rendered and always carries `${id}-hint`, so every caller
 * can point `aria-describedby` at it without wondering whether it is there.
 */
export function AdminFormField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="adm-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      <p className="field-hint" id={`${id}-hint`}>
        {hint}
      </p>
    </div>
  );
}
