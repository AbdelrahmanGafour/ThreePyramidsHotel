// The admin status language. Every status has a text label AND a distinct mark
// shape, so meaning never depends on colour alone.

import type { AdminReservationStatus, InquiryStatus, ReservationStatus, RoomAvailability } from "../types";

export type StatusTone = "lapis" | "moss" | "brass" | "danger" | "terracotta" | "muted";
export type StatusShape = "filled" | "ring" | "square";

export type StatusMeta = { label: string; tone: StatusTone; shape: StatusShape };

export const reservationStatus: Record<ReservationStatus, StatusMeta> = {
  confirmed: { label: "Confirmed", tone: "lapis", shape: "filled" },
  pending: { label: "Pending", tone: "brass", shape: "ring" },
  cancelled: { label: "Cancelled", tone: "danger", shape: "square" },
  "checked-in": { label: "Checked in", tone: "moss", shape: "filled" },
  "checked-out": { label: "Checked out", tone: "muted", shape: "ring" },
};

/**
 * The three statuses a real reservation can hold. Separate from the demo map
 * above, which carries an operational vocabulary (checked in, checked out) the
 * database does not model yet.
 */
export const adminReservationStatus: Record<AdminReservationStatus, StatusMeta> = {
  pending: { label: "Pending", tone: "brass", shape: "ring" },
  confirmed: { label: "Confirmed", tone: "lapis", shape: "filled" },
  cancelled: { label: "Cancelled", tone: "danger", shape: "square" },
};

/**
 * A room type is either offered or it is not. Archived types stay visible to
 * an administrator but are hidden from the public site, availability and new
 * bookings.
 */
export const roomTypeStatus = {
  active: { label: "Active", tone: "moss", shape: "filled" },
  archived: { label: "Archived", tone: "muted", shape: "ring" },
} satisfies Record<string, StatusMeta>;

/**
 * A physical room is in service or it is not.
 *
 * Deliberately separate from `roomTypeStatus`, and deliberately not labelled
 * "Archived": a room type is published or archived, a room is available to
 * allocate or taken out of service. The two are different facts about
 * different rows, and one label for both would suggest otherwise.
 */
export const physicalRoomStatus = {
  active: { label: "Active", tone: "moss", shape: "filled" },
  inactive: { label: "Out of service", tone: "brass", shape: "ring" },
} satisfies Record<string, StatusMeta>;

export const roomStatus: Record<RoomAvailability, StatusMeta> = {
  available: { label: "Available", tone: "moss", shape: "ring" },
  occupied: { label: "Occupied", tone: "lapis", shape: "filled" },
  blocked: { label: "Blocked", tone: "danger", shape: "square" },
};

export const inquiryStatus: Record<InquiryStatus, StatusMeta> = {
  new: { label: "New", tone: "terracotta", shape: "filled" },
  "in-progress": { label: "In progress", tone: "brass", shape: "ring" },
  replied: { label: "Replied", tone: "muted", shape: "filled" },
};
