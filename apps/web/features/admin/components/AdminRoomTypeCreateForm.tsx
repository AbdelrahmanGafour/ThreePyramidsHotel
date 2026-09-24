import { createAdminRoomTypeAction } from "../server/adminRoomTypeActions";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import { PanelHeader } from "./PanelHeader";

// The form that creates a room type.
//
// A server component rendering a plain form. The only client code involved is
// the shared submit button, which disables itself while its own form is in
// flight; there is no client state, no optimistic creation, no auto-save, and
// the browser never sends a request to the API itself. Submitting posts to the
// Server Action, which owns the refusal, the classification, the revalidation
// and the redirect — none of that is repeated here.
//
// Only the eleven fields the create contract accepts have inputs. There is no
// hidden field anywhere in this form: `isActive`, `id`, `roomCount`,
// `currency` and the timestamps are the server's own, and the action does not
// read them even if a crafted submission adds them.

export function AdminRoomTypeCreateForm() {
  return (
    <div className="adm-detail-grid">
      <section className="adm-panel" aria-labelledby="room-type-new-boundary">
        <PanelHeader id="room-type-new-boundary" title="What creating a room type does" />
        <p className="adm-detail-note">
          The room type is created as a draft. It is not shown to guests, does not appear in
          availability, and cannot be booked. No physical rooms are created with it — a room type
          with no rooms can never be allocated to anyone, so adding rooms is the next step.
          Publishing a room type is not available in this admin area yet, and the content the
          website shows for one is configured separately.
        </p>
      </section>

      <section className="adm-panel" aria-labelledby="room-type-new-form">
        <PanelHeader
          id="room-type-new-form"
          title="New room type"
          note="Everything except the reference can be changed afterwards."
        />

        <form className="adm-form" action={createAdminRoomTypeAction}>
          <AdminFormField
            id="room-type-new-slug"
            label="Reference"
            // The one field that cannot be corrected later, so the warning is
            // part of the label's own help rather than a note elsewhere.
            hint="Lower-case letters, numbers and hyphens, like garden-suite. This becomes the room type's permanent reference and part of its address on the website. It cannot be changed after the room type is created."
          >
            <input
              id="room-type-new-slug"
              name="slug"
              type="text"
              className="field-control"
              maxLength={120}
              required
              // Stops a phone keyboard capitalising the first letter. What is
              // typed is what is submitted — nothing here rewrites the value.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="room-type-new-slug-hint"
            />
          </AdminFormField>

          <AdminFormField
            id="room-type-new-name"
            label="Name"
            hint="Shown to guests, and against reservations in this admin area. It can be changed later."
          >
            <input
              id="room-type-new-name"
              name="name"
              type="text"
              className="field-control"
              maxLength={120}
              required
              aria-describedby="room-type-new-name-hint"
            />
          </AdminFormField>

          <div className="adm-field-row">
            <AdminFormField
              id="room-type-new-capacity"
              label="Sleeps"
              hint="The most guests one room of this type takes. Availability searches and new bookings are held to it, and it has its own guarded control afterwards."
            >
              <input
                id="room-type-new-capacity"
                name="capacity"
                type="number"
                className="field-control"
                min={1}
                step={1}
                // The room_types.capacity column is a PostgreSQL integer; this
                // is its exact ceiling, not an invented limit.
                max={2147483647}
                required
                aria-describedby="room-type-new-capacity-hint"
              />
            </AdminFormField>

            <AdminFormField
              id="room-type-new-baseNightlyRate"
              label="Base nightly rate (EGP)"
              hint="Egyptian pounds per night, with up to two decimal places. Zero is allowed for a room type priced on request."
            >
              <input
                id="room-type-new-baseNightlyRate"
                name="baseNightlyRate"
                type="text"
                className="field-control"
                inputMode="decimal"
                // Exactly the API's own pattern, so the browser never refuses
                // something the API would accept or the other way round.
                pattern="\d{1,10}(\.\d{1,2})?"
                maxLength={13}
                required
                aria-describedby="room-type-new-baseNightlyRate-hint"
              />
            </AdminFormField>
          </div>

          <AdminFormField
            id="room-type-new-shortDescription"
            label="Short description"
            hint="One line, used where the room type is listed. Optional."
          >
            <input
              id="room-type-new-shortDescription"
              name="shortDescription"
              type="text"
              className="field-control"
              maxLength={300}
              aria-describedby="room-type-new-shortDescription-hint"
            />
          </AdminFormField>

          <AdminFormField
            id="room-type-new-description"
            label="Description"
            hint="The full description. Optional."
          >
            <textarea
              id="room-type-new-description"
              name="description"
              className="field-control"
              maxLength={2000}
              rows={6}
              aria-describedby="room-type-new-description-hint"
            />
          </AdminFormField>

          <div className="adm-field-row">
            <AdminFormField id="room-type-new-bedType" label="Bed type" hint="For example, King. Optional.">
              <input
                id="room-type-new-bedType"
                name="bedType"
                type="text"
                className="field-control"
                maxLength={60}
                aria-describedby="room-type-new-bedType-hint"
              />
            </AdminFormField>

            <AdminFormField id="room-type-new-bedCount" label="Number of beds" hint="Optional.">
              <input
                id="room-type-new-bedCount"
                name="bedCount"
                type="number"
                className="field-control"
                min={1}
                step={1}
                max={2147483647}
                aria-describedby="room-type-new-bedCount-hint"
              />
            </AdminFormField>
          </div>

          <div className="adm-field-row">
            <AdminFormField
              id="room-type-new-sizeSqm"
              label="Room size in square metres"
              hint="Optional, with up to two decimal places."
            >
              <input
                id="room-type-new-sizeSqm"
                name="sizeSqm"
                type="text"
                className="field-control"
                inputMode="decimal"
                pattern="\d{1,4}(\.\d{1,2})?"
                maxLength={7}
                aria-describedby="room-type-new-sizeSqm-hint"
              />
            </AdminFormField>

            <AdminFormField id="room-type-new-view" label="View" hint="For example, Garden. Optional.">
              <input
                id="room-type-new-view"
                name="view"
                type="text"
                className="field-control"
                maxLength={120}
                aria-describedby="room-type-new-view-hint"
              />
            </AdminFormField>
          </div>

          <AdminFormField
            id="room-type-new-sortOrder"
            label="Order"
            hint="Where this room type appears in lists. Lower numbers come first. Left empty, it is 0."
          >
            <input
              id="room-type-new-sortOrder"
              name="sortOrder"
              type="number"
              className="field-control"
              min={0}
              step={1}
              max={2147483647}
              aria-describedby="room-type-new-sortOrder-hint"
            />
          </AdminFormField>

          <div className="adm-actions">
            {/* Disables itself while the form is in flight, so an impatient
                second click cannot create a second room type. */}
            <AdminActionButton tone="confirm" pendingLabel="Creating…">
              Create room type
            </AdminActionButton>
          </div>
        </form>
      </section>
    </div>
  );
}
