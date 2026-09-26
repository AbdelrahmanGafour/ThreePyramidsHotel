import {
  packageStatusActions,
  packageTerminalNote,
  type PackageStatusAction,
} from "../lib/packageReservations";
import { updatePackageReservationStatusAction } from "../server/adminPackageReservationActions";
import type { AdminPackageReservationStatus, AdminPackageReservationStatusTarget } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { DetailEmpty, DetailSection } from "./AdminDetail";

// What an administrator can do to this package reservation right now.
//
// A server component with one plain form per action, so the buttons work
// before any JavaScript arrives. Each form is bound on the server to this
// reservation and one fixed target — nothing about which booking or which
// status is taken from the browser.
//
// These buttons are a hint, not a rule. The status they were rendered from may
// already be out of date, and the backend re-checks every transition under a
// row lock; a stale Confirm is refused there, not here.
//
// Nothing beyond the status changes. There is no cancellation, refund or
// payment workflow behind these buttons, and the wording does not imply one.

function ActionForm({
  bookingReference,
  target,
  tone,
  label,
  pendingLabel,
}: {
  bookingReference: string;
  target: AdminPackageReservationStatusTarget;
  tone: "confirm" | "cancel";
  label: string;
  pendingLabel: string;
}) {
  // Bound server-side: the form posts no reference and no status, so a crafted
  // submission has nothing to substitute.
  const submit = updatePackageReservationStatusAction.bind(null, bookingReference, target);

  return (
    <form action={submit}>
      <AdminActionButton tone={tone} pendingLabel={pendingLabel}>
        {label}
      </AdminActionButton>
    </form>
  );
}

export function AdminPackageReservationActions({
  bookingReference,
  status,
}: {
  bookingReference: string;
  status: AdminPackageReservationStatus;
}) {
  // Both answers come from lib/packageReservations, which is pure and tested:
  // this component only renders what that decided.
  const actions: PackageStatusAction[] = packageStatusActions(status);
  const terminalNote = packageTerminalNote(status);

  if (actions.length === 0) {
    return (
      <DetailSection
        id="package-detail-actions"
        title="Request actions"
        note="This request has been decided."
      >
        <DetailEmpty>{terminalNote}</DetailEmpty>
      </DetailSection>
    );
  }

  return (
    <DetailSection
      id="package-detail-actions"
      title="Request actions"
      note="Changes apply immediately and are recorded against this request."
    >
      <div className="adm-actions">
        {actions.map((action) => (
          <ActionForm
            key={action.target}
            bookingReference={bookingReference}
            target={action.target}
            tone={action.tone}
            label={action.label}
            pendingLabel={action.pendingLabel}
          />
        ))}
      </div>
    </DetailSection>
  );
}
