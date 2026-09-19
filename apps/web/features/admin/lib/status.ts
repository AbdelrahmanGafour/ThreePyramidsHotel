// The admin status language. Every status has a text label AND a distinct mark
// shape, so meaning never depends on colour alone.

import type { InquiryStatus, ReservationStatus, RoomAvailability } from "../types";

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
