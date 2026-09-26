import Link from "next/link";
import { PACKAGES_PATH } from "../lib/packages";
import { ROOM_TYPES_PATH } from "../lib/roomTypes";

// The admin landing page.
//
// Deliberately almost empty. It used to carry a metrics strip, a stays panel,
// a room-status meter, an inquiries table and a grid of management areas —
// all of it computed from a demo fixture, none of it from the hotel's own
// data. Numbers nobody could act on are worse than no numbers, so the page
// now says who is signed in and offers the four ways on.
//
// Everything it needs is already in hand: the display name comes from the
// session the admin layout has already read, so this page makes no request of
// its own.
//
// The greeting is "Welcome", not "Good evening". A time-of-day greeting needs
// a clock in the hotel's own timezone, and this app has none — every date it
// shows is formatted in UTC, with the real zone recorded in lib/format as a
// later decision. Guessing from UTC would greet a Cairo morning as evening.

/** Where the four links go. The routes exist; none is created here. */
const QUICK_LINKS = [
  { href: ROOM_TYPES_PATH, label: "Rooms" },
  { href: "/admin/reservations", label: "Room Reservations" },
  { href: PACKAGES_PATH, label: "Journeys" },
  { href: "/admin/package-reservations", label: "Journey Reservations" },
] as const;

/**
 * `displayName` is null when the session could not be read.
 *
 * The layout above has already handled that case, so in practice a name is
 * always there — but a greeting is not worth an exception, and "Welcome back"
 * on its own reads perfectly well.
 */
export function AdminOverview({ displayName }: { displayName: string | null }) {
  return (
    <div className="adm-overview">
      <header className="adm-overview-head">
        <h1 className="adm-overview-greeting">
          {displayName === null ? "Welcome back" : `Welcome, ${displayName}`}
        </h1>
        <p className="adm-overview-lede">Welcome back to the hotel admin.</p>
      </header>

      <nav className="adm-quicklinks" aria-label="Go to">
        {QUICK_LINKS.map((link) => (
          <Link className="adm-quicklink" key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
