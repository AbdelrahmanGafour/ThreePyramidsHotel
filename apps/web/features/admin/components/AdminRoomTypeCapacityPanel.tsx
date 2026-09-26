import { updateAdminRoomTypeCapacityAction } from "../server/adminRoomTypeActions";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import { DetailSection } from "./AdminDetail";

// How many guests one room of this type takes.
//
// Its own panel rather than a field of the general edit form, because it is
// the one value that can be *refused*: availability searches filter on it and
// reservation creation enforces it, so lowering it can contradict a stay that
// is already booked. An operation that can be refused does not belong in a
// form that never can.
//
// A server component rendering a plain form. The only client code involved is
// the shared submit button, which disables itself while its own form is in
// flight; there is no client state, no optimistic update, and the browser
// never sends a request to the API itself.
//
// The Server Action owns everything that decides: the local refusal, the API
// classification, the revalidation and the redirect. None of it is repeated
// here, and nothing here retries.

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function AdminRoomTypeCapacityPanel({
  slug,
  capacity,
}: {
  slug: string;
  capacity: number;
}) {
  // Bound server-side from the route, so the form posts no slug as an editable
  // field. Binding is not a security boundary — the action re-checks the value
  // and the admin session plus the API's validation are what protect the data.
  const save = updateAdminRoomTypeCapacityAction.bind(null, slug);

  return (
    <DetailSection
      id="room-type-capacity"
      title="Capacity"
      note={`This room type currently sleeps ${plural(capacity, "guest")}.`}
    >
      <form className="adm-form" action={save}>
        <AdminFormField
          id="room-type-capacity-value"
          label="Sleeps"
          hint="The most guests who may book one room of this type. Raising it is always allowed. Lowering it can be refused: if a reservation that has not yet ended is booked for more guests than the new capacity, nothing is changed. The number of guests on a booking already taken is never altered by this."
        >
          <input
            id="room-type-capacity-value"
            name="capacity"
            type="number"
            className="field-control"
            defaultValue={capacity}
            min={1}
            step={1}
            // The room_types.capacity column is a PostgreSQL integer; this is
            // its exact ceiling, not an invented limit.
            max={2147483647}
            required
            aria-describedby="room-type-capacity-value-hint"
          />
        </AdminFormField>

        <div className="adm-actions">
          {/* Disables itself while the form is in flight, so an impatient
              second click cannot send a second change. */}
          <AdminActionButton tone="confirm" pendingLabel="Saving…">
            Save capacity
          </AdminActionButton>
        </div>
      </form>
    </DetailSection>
  );
}
