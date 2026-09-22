import { PHYSICAL_ROOM_RENAME_HINT, roomNumberDomKey } from "../lib/physicalRooms";
import { physicalRoomStatus } from "../lib/status";
import {
  addAdminPhysicalRoomAction,
  renameAdminPhysicalRoomAction,
  setAdminPhysicalRoomActiveAction,
} from "../server/adminRoomActions";
import type { AdminPhysicalRoom } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import { PanelHeader } from "./PanelHeader";
import { StatusBadge } from "./StatusBadge";

// The hotel's physical rooms of one room type — what the backend actually
// allocates, as against the room type a guest books.
//
// A server component throughout. The only client code is the shared submit
// button, which disables itself while its own form is in flight. There is no
// client state, no client fetch, no optimistic update and no retry: each
// Server Action owns its refusal, classification, revalidation and redirect.
//
// Every identifier is bound on the server. A form here carries one mutable
// field at most, and the status forms carry none — which room, which room
// type, and which direction a status change means are all decided by the page
// that rendered the button rather than by an editable field.
//
// Binding is not a security boundary. Next serialises bound arguments into its
// own form payload, so a caller can still alter them; the action treats every
// one as untrusted input, and the admin session, the API's own validation and
// its business rules are what actually protect the data.
//
// One row per room, rendered as `.adm-rooms` rather than the table/card pair
// the read-only lists use: that pair renders both markups at every width and
// hides one with CSS, which would mean two copies of every form and two
// elements sharing each id.
//
// Absent by design: no delete, no move between room types, and no internal
// identifier anywhere on screen.

/**
 * `null` means the inventory could not be read, which is not the same fact as
 * an empty list. A room type with no rooms yet is a real and expected state; a
 * failed read is not, and must never be shown as one.
 */
export function AdminPhysicalRoomsPanel({
  roomTypeSlug,
  rooms,
}: {
  roomTypeSlug: string;
  rooms: AdminPhysicalRoom[] | null;
}) {
  const addRoom = addAdminPhysicalRoomAction.bind(null, roomTypeSlug);

  return (
    <section className="adm-panel" aria-labelledby="room-type-rooms">
      <PanelHeader
        id="room-type-rooms"
        title="Physical rooms"
        note="The rooms the hotel has of this type. A room type with none can never be allocated to a guest."
      />

      <form className="adm-form" action={addRoom}>
        <AdminFormField
          id="room-type-add-room"
          label="Add a room number"
          hint="Room numbers identify a room across the whole hotel, not just within this room type, and two that differ only by capitalisation count as the same number. A room added here is in service straight away. Adding a room does not publish the room type."
        >
          <input
            id="room-type-add-room"
            name="roomNumber"
            type="text"
            className="field-control"
            // Matches the API's own limit exactly.
            maxLength={20}
            required
            // Case and internal spaces are part of the number, so nothing
            // here rewrites what is typed.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="room-type-add-room-hint"
          />
        </AdminFormField>

        <div className="adm-actions">
          <AdminActionButton tone="confirm" pendingLabel="Adding…">
            Add room
          </AdminActionButton>
        </div>
      </form>

      {rooms === null ? (
        <p className="adm-detail-note">
          {/* Deliberately not "no rooms yet": nothing is known about this room
              type's inventory, and an empty list would be a different claim. */}
          The list of rooms could not be loaded just now. The room type details above are
          unaffected. Reload the page in a moment; if it keeps failing, contact the hotel’s system
          administrator.
        </p>
      ) : rooms.length === 0 ? (
        <p className="adm-detail-note">
          <span className="adm-detail-empty">
            No rooms have been added to this room type yet, so it cannot be booked. Add one above.
          </span>
        </p>
      ) : (
        <ul className="adm-rooms">
          {rooms.map((room) => (
            <PhysicalRoomRow key={room.roomNumber} roomTypeSlug={roomTypeSlug} room={room} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One room, with its two operations kept apart.
 *
 * A rename and a status change fail in different ways — a number already in
 * use against a room with guests booked into it — so they are separate forms
 * with separate buttons rather than one save. A status form carries no field
 * at all.
 */
function PhysicalRoomRow({
  roomTypeSlug,
  room,
}: {
  roomTypeSlug: string;
  room: AdminPhysicalRoom;
}) {
  // The room's CURRENT number is bound server-side. It is what the request
  // names; the replacement comes from the form.
  const rename = renameAdminPhysicalRoomAction.bind(null, roomTypeSlug, room.roomNumber);

  // The direction is a bound server boolean, never a submitted field.
  const setActive = setAdminPhysicalRoomActiveAction.bind(
    null,
    roomTypeSlug,
    room.roomNumber,
    !room.isActive,
  );

  // For the element id only. A room number may contain internal spaces, which
  // an HTML id may not, so it is percent-escaped here — and nowhere else. The
  // displayed number, the submitted value and the bound argument all stay the
  // exact original string.
  const fieldId = `room-rename-${roomNumberDomKey(room.roomNumber)}`;

  return (
    <li>
      <div className="adm-list-top">
        <span className="adm-strong">{room.roomNumber}</span>
        <StatusBadge meta={physicalRoomStatus[room.isActive ? "active" : "inactive"]} />
      </div>

      <form className="adm-form" action={rename}>
        <AdminFormField
          id={fieldId}
          label={`Room number for ${room.roomNumber}`}
          hint={PHYSICAL_ROOM_RENAME_HINT}
        >
          <input
            id={fieldId}
            name="roomNumber"
            type="text"
            className="field-control"
            defaultValue={room.roomNumber}
            maxLength={20}
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={`${fieldId}-hint`}
          />
        </AdminFormField>

        <div className="adm-actions">
          <AdminActionButton tone="confirm" pendingLabel="Renaming…">
            Rename
          </AdminActionButton>
        </div>
      </form>

      {/* A separate form with no fields at all: everything it needs is bound. */}
      <form action={setActive}>
        <div className="adm-actions">
          {room.isActive ? (
            <AdminActionButton tone="cancel" pendingLabel="Taking out of service…">
              Take out of service
            </AdminActionButton>
          ) : (
            <AdminActionButton tone="confirm" pendingLabel="Returning to service…">
              Return to service
            </AdminActionButton>
          )}
        </div>
      </form>
    </li>
  );
}
