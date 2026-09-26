import {
  DELETE_PACKAGE_LABEL,
  PACKAGE_DELETE_BLOCKED_NOTE,
  packageDeleteBrochureAdvisory,
  packageDeleteConfirmation,
  packageDeleteState,
} from "../lib/packages";
import { deletePackageAction } from "../server/adminPackageActions";
import type { AdminPackageDetail } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { PanelHeader } from "./PanelHeader";

// Deleting a whole journey, permanently.
//
// The most destructive control in this admin, so it takes two deliberate
// steps: the button that actually deletes is behind a disclosure, and opening
// it names the journey by title, code and slug, says what else goes with it,
// and says that a journey which has ever been booked cannot be deleted at all.
//
// The disclosure is a plain <details>, not a modal. It needs no client state,
// no focus trap and no JavaScript, so the whole control works before
// hydration exactly as the other admin actions do. There is no dialog
// framework here and this slice does not add one.
//
// Only publication is judged locally. The backend also refuses a journey
// whose code or slug belongs to the brochure catalogue, and a journey that
// has ever been booked — neither of which this app can answer: the first
// needs a catalogue it does not hold, the second needs a lock it cannot take.
// So the control is offered and the refusal, when it comes, is reported.

export function AdminPackageDeleteAction({ journey }: { journey: AdminPackageDetail }) {
  const state = packageDeleteState(journey);
  const brochureAdvisory = packageDeleteBrochureAdvisory(journey.managementSource);

  if (state === "hidden") {
    return (
      <section className="adm-panel" aria-labelledby="journey-delete">
        <PanelHeader id="journey-delete" title="Delete this journey" />
        <p className="adm-detail-note">
          <span className="adm-detail-empty">{PACKAGE_DELETE_BLOCKED_NOTE}</span>
        </p>
      </section>
    );
  }

  // Bound server-side: the form posts no slug and no body.
  const submit = deletePackageAction.bind(null, journey.slug);

  return (
    // Toned apart from every other panel: removing a journey for good must
    // not read as one more management task alongside editing its wording.
    <section className="adm-panel" data-tone="danger" aria-labelledby="journey-delete">
      <PanelHeader
        id="journey-delete"
        title="Delete this journey"
        note="Permanent, and not the same as deactivating. Deactivation keeps the record and takes it off the website."
      />

      {brochureAdvisory ? (
        <p className="adm-notice" data-tone="warn" role="status">
          {brochureAdvisory}
        </p>
      ) : null}

      <details className="adm-confirm">
        <summary className="adm-ref-link">{DELETE_PACKAGE_LABEL}</summary>

        <p className="adm-sub">{packageDeleteConfirmation(journey)}</p>

        <form action={submit}>
          <AdminActionButton tone="cancel" pendingLabel="Deleting…">
            {`Delete ${journey.title}`}
          </AdminActionButton>
        </form>
      </details>
    </section>
  );
}
