import { demoStayPolicies } from "@/features/rooms/data/roomsData";
import type { PolicyOverviewItem, PolicySection } from "@/features/policies/types";

// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION CONTENT — for client review of the finished layout.
//
// Check-in, check-out, and the room cancellation window are read directly
// from `demoStayPolicies` (already used by the Rooms feature's
// `RoomStayDetails`) so this page can never drift out of sync with what a
// guest already sees on a room's own page. Values with no existing source in
// the repo (occupancy, smoking, pets, incidentals, conduct) are ordinary,
// standard boutique-hotel practice rather than invented figures, and are
// intentionally conservative — nothing here is a certification or a legal
// guarantee. Swapping this file for the hotel's confirmed policies is the
// only change needed before launch.
// ═══════════════════════════════════════════════════════════════════════════

export const policyOverview: PolicyOverviewItem[] = [
  {
    id: "arrival",
    title: "Arrival",
    summary: "Check-in from 3:00 PM, with an airport transfer arranged ahead of your stay if you'd like one.",
  },
  {
    id: "your-stay",
    title: "During your stay",
    summary: "Room capacity, children, extra bedding, and the house rules that keep a shared stay comfortable for everyone.",
  },
  {
    id: "changes-cancellation",
    title: "Changes & cancellation",
    summary: "How to adjust a reservation or curated journey, and the notice each one asks for.",
  },
  {
    id: "payments",
    title: "Payments",
    summary: "How your stay is paid for, and what may be requested at check-in.",
  },
];

export const policySections: PolicySection[] = [
  {
    id: "arrival",
    title: "Arrival",
    rows: [
      { label: "Check-in", value: demoStayPolicies.checkIn },
      { label: "Check-out", value: demoStayPolicies.checkOut },
      {
        label: "Early check-in / late check-out",
        value: "Available on request, subject to availability — note it as a special request when you book.",
      },
      {
        label: "Airport transfer",
        value: "Arranged on request through the Contact page; the hotel sits around 15 minutes from Cairo International Airport.",
      },
    ],
  },
  {
    id: "your-stay",
    title: "During your stay",
    rows: [
      {
        label: "Room occupancy",
        value: "Capacity varies by room and is listed on each room's page; a room is flagged if your party is larger than it can hold.",
      },
      { label: "Children", value: "Welcome at any age. Children ages 0–12 are counted separately from adults when you book." },
      { label: "Extra bedding", value: "Available on request for select rooms, noted on the room's own page." },
      { label: "Smoking", value: "All rooms are non-smoking." },
      { label: "Pets", value: "Pets are not generally accommodated; service animals are always welcome." },
      {
        label: "Guest conduct",
        value: "Guests are asked to keep noise considerate of neighboring rooms, particularly overnight.",
      },
    ],
  },
  {
    id: "changes-cancellation",
    title: "Changes & cancellation",
    rows: [
      { label: "Room reservations", value: demoStayPolicies.cancellation },
      {
        label: "Curated journeys",
        value: "Each journey lists its own cancellation window on its detail page, since the notice period varies by journey.",
      },
      {
        label: "Making a change",
        value: "Reach out through the Contact page with your reservation details and the change you'd like — we'll confirm from there.",
      },
    ],
  },
  {
    id: "payments",
    title: "Payments",
    rows: [
      { label: "How you pay", value: "Payment is arranged directly with the hotel; no card details are collected when you reserve online." },
      { label: "Currency", value: "Room and journey rates are shown in US dollars." },
      { label: "Incidentals", value: "A card or deposit may be requested at check-in to cover incidentals during your stay." },
    ],
  },
];
