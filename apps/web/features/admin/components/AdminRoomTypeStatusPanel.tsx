import { roomTypeStatusAction, roomTypeStatusNote } from "../lib/roomTypes";
import { updateAdminRoomTypeStatusAction } from "../server/adminRoomTypeActions";
import { AdminActionButton } from "./AdminActionButton";
import { DetailSection } from "./AdminDetail";

// Whether guests can see this room type.
//
// A server component with one plain form, so the button works before any
// JavaScript arrives. The only client code involved is the shared submit
// button, which disables itself while its own form is in flight — there is no
// client state, no optimistic update, and the browser never sends a request
// to the API itself.
//
// Its own small panel rather than a field of the edit form beside it, for the
// same reason capacity has one: publishing can be refused, and an operation
// that can be refused does not belong in a body that never can. It also keeps
// the form's Save button meaning one thing.
//
// Exactly one control is ever offered: a room type is published or it is not,
// so the only useful action is the opposite of where it stands. Which one
// that is comes from `lib/roomTypes`, which is pure and tested.
//
// The button is a hint, not a rule. The state it was rendered from may already
// be out of date, and the API decides what actually happens — including
// refusing to publish a room type with no physical room in service, which
// comes back as a notice on this page.

export function AdminRoomTypeStatusPanel({
  slug,
  isActive,
}: {
  slug: string;
  isActive: boolean;
}) {
  const action = roomTypeStatusAction(isActive);

  // Both arguments bound server-side: the form posts no slug and no direction,
  // so a crafted submission has nothing to substitute.
  const submit = updateAdminRoomTypeStatusAction.bind(null, slug, action.target);

  return (
    <DetailSection
      id="room-type-status"
      title="Availability"
      note={roomTypeStatusNote(isActive)}
    >
      {/* A form with no fields at all: everything it needs is bound. */}
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
