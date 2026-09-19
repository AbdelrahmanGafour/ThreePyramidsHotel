// PRESENTATION DATA ONLY. Every guest, reservation and inquiry below is
// invented for design review; nothing here is real. Room and journey identity
// come from the public site's own data so the admin never disagrees with it.

import { packages } from "@/features/packages/data/packagesDemoData";
import { rooms } from "@/features/rooms/data/roomsData";
import type { AdminInquiry, AdminReservation, AdminRoomInventory } from "../types";

/** The "current day" for all demo data — fixed so server and client always agree. */
export const demoToday = "2026-09-18";

export const demoAdministrator = {
  name: "Hotel manager",
  role: "Administrator",
  initials: "HM",
};

export const demoReservations: AdminReservation[] = [
  { id: "RSV-2418", guestName: "Amelia Hartwell", guestCount: 2, roomSlug: "room-concept-02", arrival: "2026-09-18", departure: "2026-09-21", status: "confirmed" },
  { id: "RSV-2419", guestName: "Karim & Layla Mansour", guestCount: 2, roomSlug: "room-concept-01", arrival: "2026-09-18", departure: "2026-09-20", status: "checked-in" },
  { id: "RSV-2420", guestName: "Jonas Weber", guestCount: 1, roomSlug: "room-concept-01", arrival: "2026-09-18", departure: "2026-09-19", status: "pending" },
  { id: "RSV-2421", guestName: "Priya Raman", guestCount: 3, roomSlug: "room-concept-03", arrival: "2026-09-18", departure: "2026-09-22", status: "confirmed" },
  { id: "RSV-2417", guestName: "Lucas Moreau", guestCount: 2, roomSlug: "room-concept-02", arrival: "2026-09-18", departure: "2026-09-19", status: "cancelled" },
  { id: "RSV-2412", guestName: "Sofia Marchetti", guestCount: 3, roomSlug: "room-concept-03", arrival: "2026-09-15", departure: "2026-09-18", status: "checked-in" },
  { id: "RSV-2409", guestName: "Daniel Okafor", guestCount: 2, roomSlug: "room-concept-02", arrival: "2026-09-14", departure: "2026-09-18", status: "checked-out" },
  { id: "RSV-2415", guestName: "Hana Yoshida", guestCount: 2, roomSlug: "room-concept-03", arrival: "2026-09-16", departure: "2026-09-20", status: "checked-in" },
];

// One entry per room type in `rooms`; unit counts are demo values.
const demoUnits: Record<string, Omit<AdminRoomInventory, "roomSlug">> = {
  "room-concept-01": { totalUnits: 6, occupiedUnits: 4, blockedUnits: 0 },
  "room-concept-02": { totalUnits: 4, occupiedUnits: 3, blockedUnits: 1 },
  "room-concept-03": { totalUnits: 5, occupiedUnits: 2, blockedUnits: 0 },
};

export const demoRoomInventory: AdminRoomInventory[] = rooms.map((room) => ({
  roomSlug: room.slug,
  ...(demoUnits[room.slug] ?? { totalUnits: 0, occupiedUnits: 0, blockedUnits: 0 }),
}));

export const demoInquiries: AdminInquiry[] = [
  { id: "INQ-318", guestName: "Rania Fouad", kind: "journey", journeySlug: packages[0]?.slug, receivedAt: "2026-09-18T09:12", status: "new" },
  { id: "INQ-317", guestName: "Thomas Lindqvist", kind: "general", receivedAt: "2026-09-18T07:40", status: "new" },
  { id: "INQ-316", guestName: "Emma Castellano", kind: "journey", journeySlug: packages[1]?.slug, receivedAt: "2026-09-17T16:25", status: "in-progress" },
  { id: "INQ-315", guestName: "Ahmed Zaki", kind: "stay", receivedAt: "2026-09-17T11:05", status: "in-progress" },
  { id: "INQ-314", guestName: "Mei-Ling Chen", kind: "journey", journeySlug: packages[2]?.slug, receivedAt: "2026-09-16T18:30", status: "replied" },
  { id: "INQ-313", guestName: "Oliver Grant", kind: "general", receivedAt: "2026-09-16T10:15", status: "replied" },
];

const roomNameBySlug = new Map(rooms.map((room) => [room.slug, room.name]));
const journeyTitleBySlug = new Map(packages.map((pkg) => [pkg.slug, pkg.title]));

export const getRoomName = (slug: string) => roomNameBySlug.get(slug) ?? "Unassigned room";
export const getJourneyTitle = (slug?: string) => (slug ? journeyTitleBySlug.get(slug) : undefined);
