import { formatDateWithYear, formatEgp, formatInstant } from "../lib/format";
import { adminReservationStatus } from "../lib/status";
import type { AdminReservationDetail as Reservation } from "../types";
import { DetailFacts, DetailMasthead, DetailSection } from "./AdminDetail";
import { StatusBadge } from "./StatusBadge";

// One room reservation, in the shared admin detail-page shape: a masthead
// carrying the booking reference and the status, then one panel per thing a
// member of staff reads — who, when, which room, how much.
//
// The same primitives as the journey reservation screen, so the two look like
// one product. What differs is only what the two domains actually hold: a
// stay has nights, a check-out and an allocated room; a journey request has a
// variant, a tour date and child ages. Neither is bent to match the other.
//
// A server component with no interactivity of its own: nothing here is
// editable in V1 apart from the status, whose controls are plain forms, so a
// page that only reads needs no JavaScript to do it.
//
// `actions` is passed in rather than rendered here, the same arrangement the
// journey reservation screen uses. The actions panel reaches a Server Action,
// which imports `next/headers` and can only be loaded under the react-server
// condition — while the submit button inside it is a Client Component that
// cannot. Composing it at the page keeps this view free of that pincer, so it
// stays renderable, and testable, on its own.

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function AdminReservationDetailView({
  reservation,
  actions,
}: {
  reservation: Reservation;
  actions?: React.ReactNode;
}) {
  const { guest, stay, roomType, room, pricing } = reservation;

  return (
    <>
      <DetailMasthead
        title={reservation.bookingReference}
        meta={[
          <span key="guest">{`${guest.firstName} ${guest.lastName}`}</span>,
          <span key="stay">
            {`${formatDateWithYear(stay.checkIn)} – ${formatDateWithYear(stay.checkOut)}`}
          </span>,
          <span key="booked">Booked {formatInstant(reservation.createdAt)}</span>,
        ]}
        badges={<StatusBadge meta={adminReservationStatus[reservation.status]} />}
      />

      {/* Directly under the masthead: the only thing on this page that
          changes anything, where it is found without hunting and without
          standing over the record it acts on. */}
      {actions}

      <DetailSection id="detail-guest" title="Guest">
        <DetailFacts
          rows={[
            { label: "First name", value: guest.firstName },
            { label: "Last name", value: guest.lastName },
            {
              label: "Email",
              value: (
                <a className="adm-detail-link" href={`mailto:${guest.email}`}>
                  {guest.email}
                </a>
              ),
            },
            {
              label: "Phone",
              value: (
                <a className="adm-detail-link" href={`tel:${guest.phone}`}>
                  {guest.phone}
                </a>
              ),
            },
            { label: "Country", value: guest.country },
          ]}
        />
      </DetailSection>

      <DetailSection
        id="detail-stay"
        title="Stay"
        note="Check-out is the morning the guest leaves."
      >
        <DetailFacts
          rows={[
            { label: "Check-in", value: formatDateWithYear(stay.checkIn) },
            { label: "Check-out", value: formatDateWithYear(stay.checkOut) },
            { label: "Nights", value: plural(stay.nights, "night") },
            { label: "Adults", value: stay.adults },
            { label: "Children", value: stay.children },
          ]}
        />
      </DetailSection>

      <DetailSection id="detail-room" title="Room">
        <DetailFacts
          rows={[
            { label: "Room type", value: roomType.name },
            {
              label: "Room type reference",
              value: <span className="adm-ref">{roomType.slug}</span>,
            },
            // The allocated room, shown nowhere else in the system.
            {
              label: "Room number",
              value: <span className="adm-cell-strong">{room.number}</span>,
            },
          ]}
        />
      </DetailSection>

      <DetailSection
        id="detail-pricing"
        title="Pricing"
        note="The rate accepted when the booking was taken, not today’s rate."
      >
        <DetailFacts
          rows={[
            {
              label: "Nightly rate",
              value: <span className="adm-cell-money">{formatEgp(pricing.nightlyRate)}</span>,
            },
            {
              label: "Total",
              value: (
                <span className="adm-cell-money adm-cell-strong">
                  {formatEgp(pricing.totalAmount)}
                </span>
              ),
            },
            { label: "Currency", value: pricing.currency },
          ]}
        />
      </DetailSection>

      <DetailSection id="detail-requests" title="Special requests">
        <DetailFacts
          rows={[
            {
              label: "From the guest",
              value:
                reservation.specialRequests ?? (
                  // Said plainly, so an empty panel is never mistaken for a
                  // loading one or for a request that failed to arrive.
                  <span className="adm-cell-muted">None left with this booking.</span>
                ),
            },
          ]}
        />
      </DetailSection>
    </>
  );
}
