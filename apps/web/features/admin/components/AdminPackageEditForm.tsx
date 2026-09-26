import { PACKAGE_WEEKDAYS, packageOwnershipWarning } from "../lib/packages";
import { editPackageAction } from "../server/adminPackageActions";
import type { AdminPackageDetail } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import { PanelHeader } from "./PanelHeader";

// The form that edits a journey's package-level fields.
//
// A server component rendering a plain form, pre-filled from the journey the
// page already read. The only client code involved is the shared submit
// button; there is no client state and the browser never calls the API.
//
// Only the eight fields the edit contract accepts have inputs. The code and
// the address appear as read-only context, not as controls: they are the
// journey's identity, the API refuses a body that offers them, and this form
// does not disagree. Publication has its own control on the detail page, and
// ownership is a consequence of saving rather than a field.

const WEEKDAY_LABELS: Record<(typeof PACKAGE_WEEKDAYS)[number], string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export function AdminPackageEditForm({ journey }: { journey: AdminPackageDetail }) {
  // Bound server-side: the form posts no slug, so a crafted submission has
  // nothing to substitute.
  const submit = editPackageAction.bind(null, journey.slug);
  const ownershipWarning = packageOwnershipWarning(journey.managementSource);
  const selectedDays = new Set(journey.operatingDays ?? []);

  return (
    <div className="adm-detail-grid">
      {ownershipWarning ? (
        <section className="adm-panel" aria-labelledby="journey-edit-ownership">
          <PanelHeader id="journey-edit-ownership" title="Before you save" />
          <p className="adm-notice" data-tone="warn" role="status">
            {ownershipWarning}
          </p>
        </section>
      ) : null}

      <section className="adm-panel" aria-labelledby="journey-edit-identity">
        <PanelHeader
          id="journey-edit-identity"
          title="Identity"
          note="The code and the address were fixed when the journey was created and cannot be changed."
        />
        <dl className="adm-facts">
          <div>
            <dt>Code</dt>
            <dd>{journey.code}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{journey.slug}</dd>
          </div>
        </dl>
      </section>

      <section className="adm-panel" aria-labelledby="journey-edit-form">
        <PanelHeader
          id="journey-edit-form"
          title="Journey details"
          note="Whether guests can see this journey is changed from its own page, not here."
        />

        <form className="adm-form" action={submit}>
          <AdminFormField
            id="journey-edit-title"
            label="Title"
            hint="What guests will see this journey called."
          >
            <input
              id="journey-edit-title"
              name="title"
              type="text"
              className="field-control"
              maxLength={200}
              required
              defaultValue={journey.title}
              aria-describedby="journey-edit-title-hint"
            />
          </AdminFormField>

          <AdminFormField
            id="journey-edit-summary"
            label="Summary"
            hint="One line for the catalogue listing. Clear the box to remove it."
          >
            <input
              id="journey-edit-summary"
              name="summary"
              type="text"
              className="field-control"
              maxLength={500}
              defaultValue={journey.summary ?? ""}
              aria-describedby="journey-edit-summary-hint"
            />
          </AdminFormField>

          <AdminFormField
            id="journey-edit-description"
            label="Description"
            hint="The longer passage shown on the journey's own page. Clear the box to remove it."
          >
            <textarea
              id="journey-edit-description"
              name="description"
              className="field-control"
              rows={5}
              maxLength={5000}
              defaultValue={journey.description ?? ""}
              aria-describedby="journey-edit-description-hint"
            />
          </AdminFormField>

          <AdminFormField
            id="journey-edit-duration"
            label="Duration"
            hint="How long it takes, in words — Half day, Two days. Clear the box to remove it."
          >
            <input
              id="journey-edit-duration"
              name="durationLabel"
              type="text"
              className="field-control"
              maxLength={120}
              defaultValue={journey.durationLabel ?? ""}
              aria-describedby="journey-edit-duration-hint"
            />
          </AdminFormField>

          <AdminFormField
            id="journey-edit-schedule"
            label="Schedule"
            hint="When it runs, in words — Daily, On request. Clear the box to remove it."
          >
            <input
              id="journey-edit-schedule"
              name="scheduleLabel"
              type="text"
              className="field-control"
              maxLength={120}
              defaultValue={journey.scheduleLabel ?? ""}
              aria-describedby="journey-edit-schedule-hint"
            />
          </AdminFormField>

          <fieldset className="adm-field">
            <legend className="field-label">Operating days</legend>
            <div className="adm-checkboxes">
              {PACKAGE_WEEKDAYS.map((day) => (
                <label className="adm-checkbox" key={day} htmlFor={`journey-edit-day-${day}`}>
                  <input
                    id={`journey-edit-day-${day}`}
                    name="operatingDays"
                    type="checkbox"
                    value={day}
                    defaultChecked={selectedDays.has(day)}
                  />
                  <span>{WEEKDAY_LABELS[day]}</span>
                </label>
              ))}
            </div>
            <p className="field-hint" id="journey-edit-days-hint">
              The days this journey runs on. Untick them all if it has no fixed days.
            </p>
          </fieldset>

          <div className="adm-field">
            <label className="adm-checkbox" htmlFor="journey-edit-confirmation">
              <input
                id="journey-edit-confirmation"
                name="requiresPriceConfirmation"
                type="checkbox"
                value="yes"
                defaultChecked={journey.requiresPriceConfirmation}
                aria-describedby="journey-edit-confirmation-hint"
              />
              <span>Price is quoted on request</span>
            </label>
            <p className="field-hint" id="journey-edit-confirmation-hint">
              Tick this when the journey is priced case by case rather than from its rate tiers.
            </p>
          </div>

          <AdminFormField
            id="journey-edit-sort-order"
            label="Position"
            hint="Where the journey sits in the catalogue order. A whole number, lowest first."
          >
            <input
              id="journey-edit-sort-order"
              name="sortOrder"
              type="number"
              className="field-control"
              min={0}
              step={1}
              defaultValue={journey.sortOrder}
              inputMode="numeric"
              aria-describedby="journey-edit-sort-order-hint"
            />
          </AdminFormField>

          <div className="adm-actions">
            <AdminActionButton tone="confirm" pendingLabel="Saving…">
              Save changes
            </AdminActionButton>
          </div>
        </form>
      </section>
    </div>
  );
}
