import { updateReservationStatusAction } from "../server/adminReservationActions";
import type { AdminReservationStatus, AdminReservationStatusTarget } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { DetailEmpty, DetailSection } from "./AdminDetail";

// What an administrator can do to this reservation right now.
//
// A server component with one plain form per action, so the buttons work before
// any JavaScript arrives. Each form is bound on the server to this reservation
// and one fixed target — nothing about which booking or which status is taken
// from the browser.
//
// These buttons are a hint, not a rule. The status they were rendered from may
// already be out of date, and the backend re-checks every transition under a
// row lock; a stale Confirm is refused there, not here.

function ActionForm({
  bookingReference,
  target,
  tone,
  label,
  pendingLabel,
}: {
  bookingReference: string;
  target: AdminReservationStatusTarget;
  tone: "confirm" | "cancel";
  label: string;
  pendingLabel: string;
}) {
  // Bound server-side: the form posts no reference and no status, so a crafted
  // submission has nothing to substitute.
  const submit = updateReservationStatusAction.bind(null, bookingReference, target);

  return (
    <form action={submit}>
      <AdminActionButton tone={tone} pendingLabel={pendingLabel}>
        {label}
      </AdminActionButton>
    </form>
  );
}

export function AdminReservationActions({
  bookingReference,
  status,
}: {
  bookingReference: string;
  status: AdminReservationStatus;
}) {
  // Presentation only. The one authoritative transition policy lives in the
  // API; this decides which buttons are worth offering, not what is allowed.
  const canConfirm = status === "pending";
  const canCancel = status === "pending" || status === "confirmed";

  return (
    <DetailSection
      id="detail-actions"
      title="Reservation actions"
      note="Changes apply immediately and are recorded against this booking."
    >
      {canConfirm || canCancel ? (
        <div className="adm-actions">
          {canConfirm ? (
            <ActionForm
              bookingReference={bookingReference}
              target="confirmed"
              tone="confirm"
              label="Confirm reservation"
              pendingLabel="Confirming…"
            />
          ) : null}

          {canCancel ? (
            <ActionForm
              bookingReference={bookingReference}
              target="cancelled"
              tone="cancel"
              label="Cancel reservation"
              pendingLabel="Cancelling…"
            />
          ) : null}
        </div>
      ) : (
        <DetailEmpty>
          Cancelled reservations cannot be reopened. Taking the guest back means creating a new
          booking.
        </DetailEmpty>
      )}
    </DetailSection>
  );
}
