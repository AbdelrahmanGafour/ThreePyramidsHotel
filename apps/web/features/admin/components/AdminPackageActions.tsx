import { packageStatusAction, packageStatusNote } from "../lib/packages";
import { updatePackageStatusAction } from "../server/adminPackageActions";
import { AdminActionButton } from "./AdminActionButton";
import { DetailSection } from "./AdminDetail";

// Whether guests can see this journey.
//
// A server component with one plain form, so the button works before any
// JavaScript arrives. The form is bound on the server to this journey and one
// fixed target — nothing about which journey or which state is taken from the
// browser.
//
// Exactly one control is ever offered: a journey is either on sale or it is
// not, so the only useful action is the opposite of where it stands. Which
// one that is comes from lib/packages, which is pure and tested.
//
// The button is a hint, not a rule. The state it was rendered from may already
// be out of date, and the backend decides what actually happens.

export function AdminPackageActions({
  slug,
  isActive,
}: {
  slug: string;
  isActive: boolean;
}) {
  const action = packageStatusAction(isActive);

  // Bound server-side: the form posts no slug and no state, so a crafted
  // submission has nothing to substitute.
  const submit = updatePackageStatusAction.bind(null, slug, action.target);

  return (
    <DetailSection
      id="journey-detail-actions"
      title="Availability"
      note={packageStatusNote(isActive)}
    >
      <div className="adm-actions">
        <form action={submit}>
          <AdminActionButton tone={action.tone} pendingLabel={action.pendingLabel}>
            {action.label}
          </AdminActionButton>
        </form>
      </div>
    </DetailSection>
  );
}
