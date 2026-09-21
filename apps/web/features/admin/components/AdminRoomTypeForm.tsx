import { formatEgp, formatInstant } from "../lib/format";
import { roomTypeStatus } from "../lib/status";
import { updateRoomTypeAction } from "../server/adminRoomTypeActions";
import type { AdminRoomTypeDetail } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { PanelHeader } from "./PanelHeader";
import { StatusBadge } from "./StatusBadge";

// One room type: what cannot be changed here, and what can.
//
// A server component rendering a plain form. The only client code involved is
// the shared submit button, which disables itself while its own form is in
// flight; there is no client state, no optimistic update, no auto-save, and
// the browser never sends a request to the API itself. Submitting posts to the
// Server Action, which re-reads the page afterwards, so what appears on screen
// is always what is stored rather than what was typed.
//
// Only the nine editable fields have inputs. The read-only facts are rendered
// as text, not as disabled inputs carrying values — and there is no hidden
// field anywhere in this form. The slug is bound to the action on the server
// from the route, so nothing the browser sends decides which room type is
// written.

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** One labelled fact. `<div>` inside `<dl>` keeps each pair together. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Field({
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

export function AdminRoomTypeForm({ roomType }: { roomType: AdminRoomTypeDetail }) {
  // Bound server-side from the route, so the form posts no slug and a crafted
  // submission has nothing to substitute.
  const save = updateRoomTypeAction.bind(null, roomType.slug);

  return (
    <div className="adm-detail-grid">
      {roomType.isActive ? null : (
        <section className="adm-panel" aria-labelledby="room-type-archived">
          <PanelHeader id="room-type-archived" title="This room type is archived" />
          <p className="adm-detail-note">
            It is hidden from the website, from availability searches and from new bookings, so no
            guest can book it. Reservations already taken for it are unaffected. You can still edit
            the details below and they will be ready if it is offered again — bringing a room type
            back is not something this page can do yet.
          </p>
        </section>
      )}

      <section className="adm-panel" aria-labelledby="room-type-fixed">
        <PanelHeader
          id="room-type-fixed"
          title="Fixed details"
          note="These are set when the room type is created and cannot be changed here."
        />
        <dl className="adm-facts">
          <Fact label="Reference">{roomType.slug}</Fact>
          <Fact label="Sleeps">{plural(roomType.capacity, "guest")}</Fact>
          {/* Inventory, not availability: how many rooms belong to this type. */}
          <Fact label="Physical rooms assigned">
            {roomType.roomCount === 0 ? "None" : plural(roomType.roomCount, "room")}
          </Fact>
          <Fact label="Status">
            <StatusBadge meta={roomTypeStatus[roomType.isActive ? "active" : "archived"]} />
          </Fact>
          <Fact label="Created">{formatInstant(roomType.createdAt)}</Fact>
          <Fact label="Last changed">{formatInstant(roomType.updatedAt)}</Fact>
        </dl>
        <p className="adm-detail-note">
          <span className="adm-detail-empty">
            Stored base nightly rate: {formatEgp(roomType.baseNightlyRate)}.
          </span>
        </p>
      </section>

      <section className="adm-panel" aria-labelledby="room-type-edit">
        <PanelHeader
          id="room-type-edit"
          title="Edit room type"
          note="Changes are saved together and take effect immediately."
        />

        <form className="adm-form" action={save}>
          <Field
            id="room-type-name"
            label="Name"
            // Names are read live wherever a reservation is shown, not copied
            // at booking time, so this is not only a forward-looking change.
            // Said plainly, because it is easy to assume otherwise.
            hint="Shown to guests. Renaming also changes the name shown against existing reservations in this admin area, because the name is not recorded separately on each booking."
          >
            <input
              id="room-type-name"
              name="name"
              type="text"
              className="field-control"
              defaultValue={roomType.name}
              maxLength={120}
              required
              aria-describedby="room-type-name-hint"
            />
          </Field>

          <Field
            id="room-type-baseNightlyRate"
            label="Base nightly rate (EGP)"
            // The one thing an administrator is most likely to assume wrong.
            hint="Existing reservations keep the nightly rate and total they were booked at; nothing already booked is recalculated. This rate applies to quotes and bookings made from now on. Up to two decimal places."
          >
            <input
              id="room-type-baseNightlyRate"
              name="baseNightlyRate"
              type="text"
              className="field-control"
              // The exact decimal string the API gave, placed back unchanged:
              // it is never parsed into a number on the way in or out.
              defaultValue={roomType.baseNightlyRate}
              inputMode="decimal"
              pattern="\d{1,10}(\.\d{1,2})?"
              maxLength={13}
              required
              aria-describedby="room-type-baseNightlyRate-hint"
            />
          </Field>

          <Field
            id="room-type-shortDescription"
            label="Short description"
            hint="One line, used where the room type is listed. Leave empty for none."
          >
            <input
              id="room-type-shortDescription"
              name="shortDescription"
              type="text"
              className="field-control"
              defaultValue={roomType.shortDescription ?? ""}
              maxLength={300}
              aria-describedby="room-type-shortDescription-hint"
            />
          </Field>

          <Field
            id="room-type-description"
            label="Description"
            hint="The full description. Leave empty for none."
          >
            <textarea
              id="room-type-description"
              name="description"
              className="field-control"
              defaultValue={roomType.description ?? ""}
              maxLength={2000}
              rows={6}
              aria-describedby="room-type-description-hint"
            />
          </Field>

          <div className="adm-field-row">
            <Field id="room-type-bedType" label="Bed type" hint="For example, King. Optional.">
              <input
                id="room-type-bedType"
                name="bedType"
                type="text"
                className="field-control"
                defaultValue={roomType.bedType ?? ""}
                maxLength={60}
                aria-describedby="room-type-bedType-hint"
              />
            </Field>

            <Field id="room-type-bedCount" label="Number of beds" hint="Optional.">
              <input
                id="room-type-bedCount"
                name="bedCount"
                type="number"
                className="field-control"
                defaultValue={roomType.bedCount ?? ""}
                min={1}
                step={1}
                aria-describedby="room-type-bedCount-hint"
              />
            </Field>
          </div>

          <div className="adm-field-row">
            <Field id="room-type-sizeSqm" label="Room size in square metres" hint="Optional.">
              <input
                id="room-type-sizeSqm"
                name="sizeSqm"
                type="text"
                className="field-control"
                defaultValue={roomType.sizeSqm ?? ""}
                inputMode="decimal"
                pattern="\d{1,4}(\.\d{1,2})?"
                maxLength={7}
                aria-describedby="room-type-sizeSqm-hint"
              />
            </Field>

            <Field id="room-type-view" label="View" hint="For example, Garden. Optional.">
              <input
                id="room-type-view"
                name="view"
                type="text"
                className="field-control"
                defaultValue={roomType.view ?? ""}
                maxLength={120}
                aria-describedby="room-type-view-hint"
              />
            </Field>
          </div>

          <Field
            id="room-type-sortOrder"
            label="Order"
            hint="Where this room type appears in lists. Lower numbers come first."
          >
            <input
              id="room-type-sortOrder"
              name="sortOrder"
              type="number"
              className="field-control"
              defaultValue={roomType.sortOrder}
              min={0}
              step={1}
              required
              aria-describedby="room-type-sortOrder-hint"
            />
          </Field>

          <div className="adm-actions">
            {/* Disables itself while its own form is in flight, so an
                impatient second click cannot send a second save. */}
            <AdminActionButton tone="confirm" pendingLabel="Saving…">
              Save changes
            </AdminActionButton>
          </div>
        </form>
      </section>
    </div>
  );
}
