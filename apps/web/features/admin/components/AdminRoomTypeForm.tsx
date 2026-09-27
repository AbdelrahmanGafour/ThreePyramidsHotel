import { formatEgp, formatInstant } from "../lib/format";
import { roomTypeStatus } from "../lib/status";
import { updateRoomTypeAction } from "../server/adminRoomTypeActions";
import type { AdminRoomTypeDetail } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import { DetailFacts, DetailSection } from "./AdminDetail";
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

export function AdminRoomTypeForm({ roomType }: { roomType: AdminRoomTypeDetail }) {
  // Bound server-side from the route, so the form posts no slug as an editable
  // field. Binding is not a security boundary — the action re-checks the value
  // and the admin session plus the API's validation are what protect the data.
  const save = updateRoomTypeAction.bind(null, roomType.slug);

  // A fragment, not a stack: the page owns the stack these panels sit in, so
  // the capacity panel beside them shares the same spacing.
  return (
    <>
      {roomType.isActive ? null : (
        <DetailSection
          id="room-type-unpublished"
          title="Unpublished"
          note="It is hidden from the website, from availability searches and from new bookings, so no guest can book it. Reservations already taken for it are unaffected. You can still edit the details below, and Availability further down publishes it once at least one of its rooms is in service."
        >
          {null}
        </DetailSection>
      )}

      <DetailSection
        id="room-type-fixed"
        title="Fixed details"
        note="These are set when the room type is created and cannot be changed here."
      >
        <DetailFacts
          rows={[
            { label: "Reference", value: <span className="adm-ref">{roomType.slug}</span> },
            // Capacity is deliberately absent: it has its own panel, because
            // it is the one value a change to can be refused. One
            // authoritative place for it beats a read-only copy that can fall
            // out of step.
            {
              label: "Status",
              value: (
                <StatusBadge meta={roomTypeStatus[roomType.isActive ? "active" : "inactive"]} />
              ),
            },
            // Inventory, not availability: how many rooms belong to this type.
            {
              label: "Physical rooms assigned",
              value: roomType.roomCount === 0 ? "None" : plural(roomType.roomCount, "room"),
            },
            {
              label: "Stored base nightly rate",
              value: <span className="adm-cell-money">{formatEgp(roomType.baseNightlyRate)}</span>,
            },
            { label: "Created", value: formatInstant(roomType.createdAt) },
            { label: "Last changed", value: formatInstant(roomType.updatedAt) },
          ]}
        />
      </DetailSection>

      <DetailSection
        id="room-type-edit"
        title="Edit room type"
        note="Changes are saved together and take effect immediately."
      >
        <form className="adm-form" action={save}>
          <AdminFormField
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
          </AdminFormField>

          <AdminFormField
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
          </AdminFormField>

          <AdminFormField
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
          </AdminFormField>

          <AdminFormField
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
          </AdminFormField>

          <div className="adm-field-row">
            <AdminFormField id="room-type-bedType" label="Bed type" hint="For example, King. Optional.">
              <input
                id="room-type-bedType"
                name="bedType"
                type="text"
                className="field-control"
                defaultValue={roomType.bedType ?? ""}
                maxLength={60}
                aria-describedby="room-type-bedType-hint"
              />
            </AdminFormField>

            <AdminFormField id="room-type-bedCount" label="Number of beds" hint="Optional.">
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
            </AdminFormField>
          </div>

          <div className="adm-field-row">
            <AdminFormField id="room-type-sizeSqm" label="Room size in square metres" hint="Optional.">
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
            </AdminFormField>

            <AdminFormField id="room-type-view" label="View" hint="For example, Garden. Optional.">
              <input
                id="room-type-view"
                name="view"
                type="text"
                className="field-control"
                defaultValue={roomType.view ?? ""}
                maxLength={120}
                aria-describedby="room-type-view-hint"
              />
            </AdminFormField>
          </div>

          <AdminFormField
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
          </AdminFormField>

          <div className="adm-actions">
            {/* Disables itself while its own form is in flight, so an
                impatient second click cannot send a second save. */}
            <AdminActionButton tone="confirm" pendingLabel="Saving…">
              Save changes
            </AdminActionButton>
          </div>
        </form>
      </DetailSection>
    </>
  );
}
