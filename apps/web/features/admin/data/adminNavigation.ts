import type { AdminNavItem } from "../types";

// Only routes that exist are `available`. The rest are shown as clearly
// unavailable entries so nothing in the shell is a dead link.
export const adminNavigation: AdminNavItem[] = [
  {
    key: "overview",
    label: "Overview",
    href: "/admin",
    description: "What needs attention at the hotel today.",
    available: true,
  },
  {
    key: "reservations",
    label: "Reservations",
    href: "/admin/reservations",
    description: "Bookings and guest details for every stay.",
    available: true,
  },
  {
    key: "rooms",
    label: "Rooms",
    href: "/admin/rooms",
    description: "Room types, availability and blocked dates.",
    available: false,
  },
  {
    key: "journeys",
    label: "Journeys",
    href: "/admin/journeys",
    description: "The curated journeys guests can enquire about.",
    available: false,
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
];

export const primaryNavigation = adminNavigation.filter((item) => item.key !== "settings");
export const settingsNavigation = adminNavigation.find((item) => item.key === "settings")!;
