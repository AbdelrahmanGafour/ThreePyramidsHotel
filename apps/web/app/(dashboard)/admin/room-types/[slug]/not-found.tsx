import Link from "next/link";
import { ROOM_TYPES_PATH } from "@/features/admin/lib/roomTypes";

// Route-local, so a missing room type stays inside the admin shell with the
// navigation and the breadcrumb intact, rather than dropping staff onto the
// public 404.
//
// It covers both ways a room type can fail to resolve — a reference the API
// refused as malformed, and a well-formed one nobody has used. The page keeps
// that distinction internally; saying which it was here tells an administrator
// nothing they can act on.

export default function RoomTypeNotFound() {
  return (
    <>
      <header className="adm-page-head">
        <p className="adm-detail-back">
          <Link className="adm-topbar-link" href={ROOM_TYPES_PATH}>
            Back to room types
          </Link>
        </p>
        <h1 className="adm-page-title">Room type not found</h1>
        <p className="adm-page-lede">No room type matches that reference.</p>
      </header>

      <section className="adm-panel" aria-labelledby="room-type-missing-title">
        <div className="adm-panel-head">
          <h2 id="room-type-missing-title" className="adm-panel-title">
            What to check
          </h2>
          <p className="adm-panel-note">
            References are lower-case and hyphenated, like <code>garden-suite</code>, and they are
            case-sensitive. Open the room type from the list rather than typing its reference.
          </p>
        </div>
        <p className="adm-panel-foot">
          <Link className="adm-topbar-link" href={ROOM_TYPES_PATH}>
            Browse all room types
          </Link>
        </p>
      </section>
    </>
  );
}
