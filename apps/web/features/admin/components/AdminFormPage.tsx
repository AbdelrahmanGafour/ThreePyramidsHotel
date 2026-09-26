import Link from "next/link";
import type React from "react";
import { DetailSection } from "./AdminDetail";

// The shared shape of an admin create page.
//
// The two screens that make a new record — a room type and a journey — were
// each one long undifferentiated form inside a single panel, with the fields
// running from a permanent reference straight through to an optional view
// description without a break. The pieces here give them the same frame the
// detail pages got: a masthead, then one panel per group of fields, then one
// action bar.
//
//   <FormPage>
//     <FormMasthead …/>          what this page makes, and what that means
//     <FormSection …/>           optional prose about the operation
//     <FormStack action={…}>     one <form>, several panels
//       <FormSection …>
//         <FormFields> … </FormFields>
//       </FormSection>
//       <FormActions …/>
//     </FormStack>
//   </FormPage>
//
// One `<form>` wraps every section, so grouping the fields visually changes
// nothing about what is submitted: the same controls, the same names, in one
// payload.
//
// The panel and heading come from `DetailSection`, because a section of a
// create page and a section of a detail page are the same thing on screen.
// Nothing table-shaped is reused — a form is not a metadata table.
//
// Presentation only: no validation, no state, no Server Action. The edit
// screens deliberately do not use any of this; the styles are scoped to
// `.adm-form-page` so nothing else picks them up.

/** The page-level stack, and the scope every style below lives under. */
export function FormPage({ children }: { children: React.ReactNode }) {
  return <div className="adm-form-page">{children}</div>;
}

/**
 * The first panel: what this page makes.
 *
 * It carries the page's `<h1>`, so the name sits inside a panel rather than
 * floating above it on the workspace ground — the same arrangement the detail
 * pages use. A page that renders a masthead must not also render a heading in
 * its page header.
 */
export function FormMasthead({ title, lede }: { title: string; lede?: React.ReactNode }) {
  return (
    <header className="adm-panel adm-form-masthead">
      <h1 className="adm-ident-title">{title}</h1>
      {lede ? <p className="adm-form-lede">{lede}</p> : null}
    </header>
  );
}

/** One group of fields, in the same panel a detail page uses for a section. */
export function FormSection({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <DetailSection id={id} title={title} note={note}>
      {children ?? null}
    </DetailSection>
  );
}

/**
 * The one form, wrapping every section.
 *
 * `action` is passed straight through to the `<form>`: this component never
 * inspects it, never binds it and never wraps it, so the Server Action the
 * page hands over is exactly the one the browser posts to.
 */
export function FormStack({
  action,
  children,
}: {
  action: React.ComponentProps<"form">["action"];
  children: React.ReactNode;
}) {
  return (
    <form className="adm-form-stack" action={action}>
      {children}
    </form>
  );
}

/** The fields inside one section, in the admin's existing form rhythm. */
export function FormFields({ children }: { children: React.ReactNode }) {
  return <div className="adm-form">{children}</div>;
}

/** Two short, related fields side by side once there is room for both. */
export function FormRow({ children }: { children: React.ReactNode }) {
  return <div className="adm-field-row">{children}</div>;
}

/**
 * The submit, and the way out.
 *
 * Its own bar at the foot of the form rather than a row inside the last
 * section, so it reads as the end of the page instead of the end of whatever
 * group of fields happens to come last.
 */
export function FormActions({
  cancelHref,
  cancelLabel,
  children,
}: {
  cancelHref?: string;
  cancelLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="adm-form-actions">
      {children}
      {cancelHref ? (
        // A link, not a button: leaving posts nothing and cancels nothing
        // server-side, because nothing has been created yet.
        <Link className="adm-form-cancel" href={cancelHref}>
          {cancelLabel ?? "Cancel"}
        </Link>
      ) : null}
    </div>
  );
}
