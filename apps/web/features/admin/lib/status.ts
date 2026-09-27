// The admin status language. Every status has a text label AND a distinct mark
// shape, so meaning never depends on colour alone.

import type {
  AdminPackageManagementSource,
  AdminPackageReservationPricingStatus,
  AdminPackageReservationStatus,
  AdminReservationStatus,
  InquiryStatus,
  ReservationStatus,
  RoomAvailability,
} from "../types";

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
 * The three statuses a package reservation can hold.
 *
 * Deliberately its own map rather than a reuse of `adminReservationStatus`:
 * the two vocabularies happen to coincide today, and sharing one object would
 * mean a later change to room reservations silently restyling package ones.
 */
export const adminPackageReservationStatus: Record<AdminPackageReservationStatus, StatusMeta> = {
  pending: { label: "Pending", tone: "brass", shape: "ring" },
  confirmed: { label: "Confirmed", tone: "lapis", shape: "filled" },
  cancelled: { label: "Cancelled", tone: "danger", shape: "square" },
};

/**
 * Whether a package reservation carries a real quote yet.
 *
 * "Awaiting quote" rather than "To be confirmed": the total cell already says
 * that, and two identical phrases side by side would read as one fact
 * repeated rather than two related ones. This is about the reservation's
 * pricing state; the total cell is about the figure itself.
 */
export const adminPackagePricingStatus: Record<AdminPackageReservationPricingStatus, StatusMeta> = {
  quoted: { label: "Quoted", tone: "moss", shape: "filled" },
  requires_confirmation: { label: "Awaiting quote", tone: "terracotta", shape: "ring" },
};

/**
 * Whether guests can see a journey.
 *
 * Its own map rather than a reuse of `roomTypeStatus`: "published" is the
 * wrong word for a journey that is simply not being sold this season, and a
 * shared object would mean a later change to room types silently restyling
 * the catalogue.
 */
export const adminPackageStatus = {
  active: { label: "Active", tone: "moss", shape: "filled" },
  inactive: { label: "Inactive", tone: "muted", shape: "ring" },
} satisfies Record<string, StatusMeta>;

/**
 * Who may edit a journey, in words an administrator can act on.
 *
 * "Brochure-managed" is a warning as much as a label: the catalogue seed still
 * owns that row, so an edit to it would be undone on the next run until
 * ownership moves. "Admin-managed" means the seed leaves it alone.
 */
export const adminPackageManagementSource: Record<AdminPackageManagementSource, StatusMeta> = {
  brochure: { label: "Brochure-managed", tone: "lapis", shape: "ring" },
  admin: { label: "Admin-managed", tone: "brass", shape: "filled" },
};

/**
 * A room type is either published or it is not.
 *
 * One boolean, two words. "Unpublished" covers both a room type that has
 * never been offered and one that has been withdrawn, because the database
 * does not distinguish them and neither should this: inventing a
 * draft-versus-archived split in the labels would describe a state that has
 * nowhere to live. An unpublished room type stays visible to an
 * administrator and is hidden from the public site, from availability and
 * from new bookings.
 *
 * "Published" rather than "Active", so the badge and the control that changes
 * it use the same verb.
 */
export const roomTypeStatus = {
  active: { label: "Published", tone: "moss", shape: "filled" },
  inactive: { label: "Unpublished", tone: "muted", shape: "ring" },
} satisfies Record<string, StatusMeta>;

/**
 * A physical room is in service or it is not.
 *
 * Deliberately separate from `roomTypeStatus`, and deliberately not labelled
 * "Unpublished": a room type is published or not, a room is available to
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
