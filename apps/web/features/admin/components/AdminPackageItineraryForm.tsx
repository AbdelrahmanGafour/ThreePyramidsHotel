import {
  MAX_ITINERARY_BODY_LENGTH,
  MAX_ITINERARY_DAY_NUMBER,
  MAX_ITINERARY_HEADING_LENGTH,
  MAX_ITINERARY_SECTIONS,
  packageItineraryOwnershipWarning,
  packageItineraryRowCount,
} from "../lib/packages";
import { replacePackageItineraryAction } from "../server/adminPackageActions";
import type { AdminPackageDetail, AdminPackageItinerarySection } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import { PanelHeader } from "./PanelHeader";

// The editor that replaces a journey's whole itinerary.
//
// A server component rendering one plain form, pre-filled from the sections
// the page already read, in the order the API returned them. The only client
// code involved is the shared submit button; there is no client state, no
// drag-and-drop, and the browser never calls the API.
//
// Rows are fixed slots rather than anything dynamic: the sections a journey
// already has, plus a few blanks to add to, capped so the form cannot offer
// more rows than the API would accept. Clearing all three boxes of a row
// removes that section and filling a blank row adds one — which is the whole
// of "add and remove" without a line of client JavaScript. The three fields
// are named identically on every row, so they arrive as parallel arrays and a
// row is one index across all three.
//
// Order on the form is the itinerary's order. Nothing carries a position or
// an id: those are the server's, derived from where a row sits.
//
// Nothing here is gated on publication. The itinerary is prose on the detail
// page, and no part of a booking reads it.

function ItinerarySection({
  index,
  section,
}: {
  index: number;
  section?: AdminPackageItinerarySection;
}) {
  const rowId = `itinerary-${index}`;
  const position = index + 1;

  return (
    <li className="adm-panel">
      <PanelHeader
        id={`${rowId}-title`}
        title={`Section ${position}`}
        note="Clear all three boxes to remove this section."
      />

      <AdminFormField
        id={`${rowId}-day`}
        label="Day number"
        hint="Which day this section covers. Leave it empty for a section about the whole journey."
      >
        <input
          id={`${rowId}-day`}
          name="dayNumber"
          type="number"
          className="field-control"
          min={1}
          max={MAX_ITINERARY_DAY_NUMBER}
          step={1}
          inputMode="numeric"
          defaultValue={section?.dayNumber ?? ""}
          aria-describedby={`${rowId}-day-hint`}
        />
      </AdminFormField>

      <AdminFormField
        id={`${rowId}-heading`}
        label="Heading"
        hint="An optional title for this section, like Arrival. Leave it empty for an unheaded passage."
      >
        <input
          id={`${rowId}-heading`}
          name="heading"
          type="text"
          className="field-control"
          maxLength={MAX_ITINERARY_HEADING_LENGTH}
          defaultValue={section?.heading ?? ""}
          aria-describedby={`${rowId}-heading-hint`}
        />
      </AdminFormField>

      <AdminFormField
        id={`${rowId}-body`}
        label="Body"
        hint="What happens. Required for any section you are using."
      >
        <textarea
          id={`${rowId}-body`}
          name="body"
          className="field-control"
          rows={3}
          maxLength={MAX_ITINERARY_BODY_LENGTH}
          defaultValue={section?.body ?? ""}
          aria-describedby={`${rowId}-body-hint`}
        />
      </AdminFormField>
    </li>
  );
}

export function AdminPackageItineraryForm({ journey }: { journey: AdminPackageDetail }) {
  // Bound server-side: the form posts no slug.
  const submit = replacePackageItineraryAction.bind(null, journey.slug);
  const ownershipWarning = packageItineraryOwnershipWarning(journey.managementSource);
  const rows = packageItineraryRowCount(journey.itinerary.length);

  return (
    <form className="adm-form" action={submit}>
      <div className="adm-detail-grid">
        {ownershipWarning ? (
          <section className="adm-panel" aria-labelledby="itinerary-ownership">
            <PanelHeader id="itinerary-ownership" title="Before you save" />
            <p className="adm-notice" data-tone="warn" role="status">
              {ownershipWarning}
            </p>
          </section>
        ) : null}

        <section className="adm-panel" aria-labelledby="itinerary-context">
          <PanelHeader
            id="itinerary-context"
            title="This journey"
            note={`Saving replaces the whole itinerary with exactly what is below, in this order. A journey may have up to ${MAX_ITINERARY_SECTIONS} sections.`}
          />
          <dl className="adm-facts">
            <div>
              <dt>Journey</dt>
              <dd>{journey.title}</dd>
            </div>
            <div>
              <dt>Sections</dt>
              <dd>{journey.itinerary.length}</dd>
            </div>
          </dl>

          <p className="adm-detail-note">
            Leaving every box empty clears the itinerary, which is allowed. Text is stored exactly
            as typed, so a stray space at the start or end is reported rather than removed for you.
          </p>
        </section>

        <ul className="adm-form-list">
          {Array.from({ length: rows }, (_unused, index) => (
            <ItinerarySection key={index} index={index} section={journey.itinerary[index]} />
          ))}
        </ul>

        <div className="adm-actions">
          <AdminActionButton tone="confirm" pendingLabel="Saving…">
            Save itinerary
          </AdminActionButton>
        </div>
      </div>
    </form>
  );
}
