import { formatDateWithYear, formatEgp, formatInstant } from "../lib/format";
import { adminReservationStatus } from "../lib/status";
import type { AdminReservationDetail as Reservation } from "../types";
import { AdminReservationActions } from "./AdminReservationActions";
import { PanelHeader } from "./PanelHeader";
import { StatusBadge } from "./StatusBadge";

// One reservation, read-only, in the panels the rest of the admin already uses.
//
// A server component with no interactivity: nothing here is editable in V1, and
// a page that only reads needs no JavaScript to do it.

/** One labelled fact. `<div>` inside `<dl>` keeps each pair together. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({ id, title, note, children }: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="adm-panel" aria-labelledby={id}>
      <PanelHeader id={id} title={title} note={note} />
      <dl className="adm-facts">{children}</dl>
    </section>
  );
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function AdminReservationDetailView({ reservation }: { reservation: Reservation }) {
  const { guest, stay, roomType, room, pricing } = reservation;

  return (
    <div className="adm-detail-grid">
      <AdminReservationActions
        bookingReference={reservation.bookingReference}
        status={reservation.status}
      />

      <Section id="detail-booking" title="Booking">
        <Fact label="Booking reference">{reservation.bookingReference}</Fact>
        <Fact label="Status">
          <StatusBadge meta={adminReservationStatus[reservation.status]} />
        </Fact>
        <Fact label="Booked">{formatInstant(reservation.createdAt)}</Fact>
      </Section>

      <Section id="detail-guest" title="Guest">
        <Fact label="First name">{guest.firstName}</Fact>
        <Fact label="Last name">{guest.lastName}</Fact>
        <Fact label="Email">
          <a className="adm-detail-link" href={`mailto:${guest.email}`}>
            {guest.email}
          </a>
        </Fact>
        <Fact label="Phone">
          <a className="adm-detail-link" href={`tel:${guest.phone}`}>
            {guest.phone}
          </a>
        </Fact>
        <Fact label="Country">{guest.country}</Fact>
      </Section>

      <Section id="detail-stay" title="Stay" note="Check-out is the morning the guest leaves.">
        <Fact label="Check-in">{formatDateWithYear(stay.checkIn)}</Fact>
        <Fact label="Check-out">{formatDateWithYear(stay.checkOut)}</Fact>
        <Fact label="Nights">{plural(stay.nights, "night")}</Fact>
        <Fact label="Adults">{stay.adults}</Fact>
        <Fact label="Children">{stay.children}</Fact>
      </Section>

      <Section id="detail-room" title="Room">
        <Fact label="Room type">{roomType.name}</Fact>
        <Fact label="Room type reference">{roomType.slug}</Fact>
        {/* The allocated room, shown nowhere else in the system. */}
        <Fact label="Room number">{room.number}</Fact>
      </Section>

      <Section
        id="detail-pricing"
        title="Pricing"
        note="The rate accepted when the booking was taken, not today’s rate."
      >
        <Fact label="Nightly rate">{formatEgp(pricing.nightlyRate)}</Fact>
        <Fact label="Total">{formatEgp(pricing.totalAmount)}</Fact>
        <Fact label="Currency">{pricing.currency}</Fact>
      </Section>

      <section className="adm-panel" aria-labelledby="detail-requests">
        <PanelHeader id="detail-requests" title="Special requests" />
        <p className="adm-detail-note">
          {reservation.specialRequests ?? (
            // Said plainly, so an empty panel is never mistaken for a loading
            // one or for a request that failed to arrive.
            <span className="adm-detail-empty">None left with this booking.</span>
          )}
        </p>
      </section>
    </div>
  );
}
