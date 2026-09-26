import { formatDateWithYear, formatInstant, formatUsd } from "../lib/format";
import {
  NONE,
  packageChildAgesLabel,
  packageChildRateLabel,
  packagePartyLabel,
  packageTotalLabel,
} from "../lib/packageReservations";
import { adminPackagePricingStatus, adminPackageReservationStatus } from "../lib/status";
import type { AdminPackageReservationDetail as Reservation } from "../types";
import { DetailFacts, DetailMasthead, DetailSection } from "./AdminDetail";
import { StatusBadge } from "./StatusBadge";

// One journey reservation, in the shared admin detail-page shape: a masthead
// carrying the booking reference and the two statuses, then one panel per
// thing a member of staff reads — who, what, how many, how much.
//
// The same primitives as the room reservation screen, so the two look like
// one product. What differs is only what the two domains actually hold: a
// journey has a variant, a tour date and a party with child ages; a stay has
// nights, a room and a check-out. Neither is bent to match the other.
//
// A server component. Everything it reads is read-only; the one thing that
// can change is the status, and that lives in AdminPackageReservationActions
// as plain forms, so the page needs no JavaScript to work.
//
// Every figure shown here is a stored snapshot. Nothing is derived: the total
// was settled when the reservation was taken, and recomputing it from the unit
// rates would invent a second opinion about a price the guest already has.

/**
 * `actions` is passed in rather than rendered here.
 *
 * The actions panel reaches a Server Action, which imports `next/headers` and
 * can only be loaded under the react-server condition — while the submit
 * button inside it is a Client Component that cannot. Composing it at the page
 * keeps this view free of that pincer, so it stays renderable on its own; the
 * decision about which controls to show is pure and tested in
 * lib/packageReservations.
 */
export function AdminPackageReservationDetailView({
  reservation,
  actions,
}: {
  reservation: Reservation;
  actions?: React.ReactNode;
}) {
  const { package: offering, variant } = reservation;

  return (
    <>
      <DetailMasthead
        title={reservation.bookingReference}
        meta={[
          <span key="guest">{reservation.guestName}</span>,
          <span key="requested">Requested {formatInstant(reservation.createdAt)}</span>,
        ]}
        badges={
          <>
            <StatusBadge meta={adminPackageReservationStatus[reservation.status]} />
            <StatusBadge meta={adminPackagePricingStatus[reservation.pricingStatus]} />
          </>
        }
      />

      {/* Directly under the masthead: the only thing on this page that
          changes anything, where it is found without hunting and without
          standing over the record it acts on. */}
      {actions}

      <DetailSection id="package-detail-guest" title="Guest">
        <DetailFacts
          rows={[
            { label: "Name", value: reservation.guestName },
            {
              label: "Email",
              value: (
                <a className="adm-detail-link" href={`mailto:${reservation.guestEmail}`}>
                  {reservation.guestEmail}
                </a>
              ),
            },
            {
              label: "Phone",
              value: (
                <a className="adm-detail-link" href={`tel:${reservation.guestPhone}`}>
                  {reservation.guestPhone}
                </a>
              ),
            },
            { label: "Country", value: reservation.guestCountry },
          ]}
        />
      </DetailSection>

      {/* The journey as it was when the request was taken, not as the
          catalogue reads today. */}
      <DetailSection
        id="package-detail-journey"
        title="Journey"
        note="Recorded with the request. Later changes to the catalogue do not reach it."
      >
        <DetailFacts
          rows={[
            { label: "Package", value: offering.title },
            { label: "Package code", value: <span className="adm-ref">{offering.code}</span> },
            { label: "Variant", value: variant.label },
            { label: "Tour date", value: formatDateWithYear(reservation.tourDate) },
          ]}
        />
      </DetailSection>

      <DetailSection id="package-detail-party" title="Party">
        <DetailFacts
          rows={[
            {
              label: "Travellers",
              value: packagePartyLabel(reservation.adults, reservation.children),
            },
            { label: "Adults", value: reservation.adults },
            { label: "Children", value: reservation.children },
            {
              label: "Child ages",
              value: packageChildAgesLabel(reservation.childAges, reservation.children),
            },
          ]}
        />
      </DetailSection>

      <DetailSection
        id="package-detail-pricing"
        title="Pricing"
        note="The rates this request was quoted at, exactly as stored."
      >
        <DetailFacts
          rows={[
            {
              label: "Pricing status",
              value: <StatusBadge meta={adminPackagePricingStatus[reservation.pricingStatus]} />,
            },
            { label: "Currency", value: reservation.currency },
            {
              label: "Adult rate",
              value: (
                <span className="adm-cell-money">
                  {formatUsd(reservation.adultUnitRateSnapshot)}
                </span>
              ),
            },
            {
              label: "Child rate",
              value: (
                <span className="adm-cell-money">
                  {packageChildRateLabel(reservation.childUnitRateSnapshot, reservation.children)}
                </span>
              ),
            },
            {
              label: "Total",
              value: (
                <span className="adm-cell-money adm-cell-strong">
                  {packageTotalLabel(reservation.totalAmountSnapshot)}
                </span>
              ),
            },
          ]}
        />
      </DetailSection>

      <DetailSection id="package-detail-requests" title="Special requests">
        <DetailFacts
          rows={[{ label: "From the guest", value: reservation.specialRequests ?? NONE }]}
        />
      </DetailSection>
    </>
  );
}
