import type { AdminNavItem, AdminNavKey } from "../types";

// Every administration area this product has named, built or not.
//
// The sidebar renders `sidebarNavigation` below — an explicit, ordered subset
// — so what staff see is a short list of places that exist. An area leaves
// the sidebar by being left out of that subset, never by being deleted from
// here: its page, route and description all survive. The overview page used
// to render the entries still marked unavailable as a statement of what was
// coming; it no longer shows anything but a greeting and four links, so the
// unavailable entries are read by nothing and simply wait here.
//
// Only routes that exist are `available`. The rest are never rendered as
// links anywhere, so nothing in the shell is a dead link.
export const adminNavigation: AdminNavItem[] = [
  {
    key: "overview",
    label: "Overview",
    href: "/admin",
    description: "What needs attention at the hotel today.",
    available: true,
  },
  {
    key: "rooms",
    // Repointed rather than duplicated: this is the entry the dashboard
    // foundation reserved for room management. `Rooms` is what staff call
    // the area; the page behind it manages room types.
    label: "Rooms",
    href: "/admin/room-types",
    description: "The rooms guests can book, and what each one costs.",
    available: true,
  },
  {
    key: "reservations",
    // Named for the thing booked, because there are now two kinds of
    // reservation in this admin and "Reservations" alone no longer says
    // which. The route is unchanged.
    label: "Room Reservations",
    href: "/admin/reservations",
    description: "Bookings and guest details for every stay.",
    available: true,
  },
  {
    key: "journeys",
    label: "Journeys",
    href: "/admin/journeys",
    description: "The curated journeys guests can enquire about.",
    available: true,
  },
  {
    key: "packageReservations",
    label: "Journey Reservations",
    href: "/admin/package-reservations",
    description: "Requests to join a journey, and what each one was quoted.",
    available: true,
  },
  {
    key: "inquiries",
    label: "Inquiries",
    href: "/admin/inquiries",
    description: "Messages from the contact and journey forms.",
    available: false,
  },
  {
    key: "content",
    label: "Website Content",
    href: "/admin/content",
    description: "The wording shown on the public website.",
    available: false,
  },
  {
    key: "media",
    label: "Media Library",
    href: "/admin/media",
    description: "Photography used across rooms and journeys.",
    available: false,
  },
  {
    key: "settings",
    label: "Settings",
    href: "/admin/settings",
    description: "Hotel details, policies and contact information.",
    available: false,
  },
  {
    // Deliberately NOT the `settings` entry above. That one is about the
    // hotel — its details, policies and contact information. This one is
    // about the person signed in, and the two would be a confusing single
    // destination: one is shared configuration, the other is a credential
    // only its owner may change.
    key: "account",
    label: "My account",
    href: "/admin/account",
    description: "The email address and password you sign in with.",
    available: true,
  },
];

/**
 * Whether one navigation entry is the area the current path belongs to.
 *
 * `/admin` is matched exactly and everything else by prefix, so a nested page
 * keeps its area highlighted — a journey's edit screen is still Journeys, a
 * booking's detail is still its own reservations area — while the overview
 * does not claim every page beneath it.
 *
 * Lifted out of the two components that each had their own copy of it. They
 * agreed, but only by coincidence, and one of them decides a page title from
 * it while the other decides a highlight; those two should never be able to
 * disagree about which area you are in.
 */
export function isAdminNavItemActive(pathname: string, item: AdminNavItem): boolean {
  return item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
}

/**
 * What the sidebar shows, in the order it shows it.
 *
 * Stated as an explicit list of keys rather than filtered out of the array
 * above, so the order is decided here and reads in one place. Adding an area
 * to the product no longer adds it to the sidebar by accident, and an entry
 * that is not ready simply is not listed.
 *
 * `View Website` is not here: it is the external link in the sidebar footer,
 * which leaves the admin rather than moving within it.
 */
const SIDEBAR_KEYS = [
  "overview",
  "rooms",
  "reservations",
  "journeys",
  "packageReservations",
  // Last: it is the one entry that is about the person rather than the hotel.
  "account",
] as const satisfies readonly AdminNavKey[];

export const sidebarNavigation: AdminNavItem[] = SIDEBAR_KEYS.map((key) => {
  const item = adminNavigation.find((entry) => entry.key === key);

  // A mistyped key would otherwise vanish from the sidebar silently.
  if (!item) {
    throw new Error(`Unknown admin navigation key: ${key}`);
  }

  return item;
});
