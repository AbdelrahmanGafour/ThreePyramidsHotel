"use client";

import { useFormStatus } from "react-dom";

// The smallest possible island: a submit button that knows its own form is in
// flight. Everything that decides anything stays in the Server Action.
//
// `useFormStatus` reports on the nearest enclosing form, and each action here
// has a form of its own, so confirming disables the confirm button without
// touching cancel.

export function AdminActionButton({
  tone,
  pendingLabel,
  children,
}: {
  tone: "confirm" | "cancel";
  pendingLabel: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="adm-action-btn" data-tone={tone} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
