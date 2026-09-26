import Link from "next/link";
import { formatDateWithYear, formatInstant } from "../lib/format";
import {
  packagePartyLabel,
  packageReservationDetailHref,
  packageTotalLabel,
} from "../lib/packageReservations";
import { adminPackagePricingStatus, adminPackageReservationStatus } from "../lib/status";
import type { AdminPackageReservationList, AdminPackageReservationListItem } from "../types";
import { StatusBadge } from "./StatusBadge";

// The package reservations list: a desktop table and a mobile card list of the
// same rows, following the pattern AdminReservationsTable already uses.
//
// A server component with no interactivity of its own. There is no pager yet —
// the API returns every reservation.
//
// The labels and the detail href come from lib/packageReservations, shared with
// the detail view, so the same reservation can never be described one way here
// and another way on the page this links to.

const totalOf = (reservation: AdminPackageReservationListItem) =>
  packageTotalLabel(reservation.totalAmountSnapshot);

const partyOf = (reservation: AdminPackageReservationListItem) =>
  packagePartyLabel(reservation.adults, reservation.children);

export function AdminPackageReservationsTable({ data }: { data: AdminPackageReservationList }) {
  const { reservations } = data;

  if (reservations.length === 0) {
    return (
      <section className="adm-panel" aria-labelledby="package-reservations-empty-title">
        <div className="adm-panel-head">
          <h2 id="package-reservations-empty-title" className="adm-panel-title">
            No package reservations yet
          </h2>
          <p className="adm-panel-note">
            Requests made on the website will appear here as soon as they are taken.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="adm-panel" aria-labelledby="package-reservations-title">
      <div className="adm-panel-head">
        <h2 id="package-reservations-title" className="adm-panel-title">
          All package reservations
        </h2>
        <p className="adm-panel-note">Newest request first.</p>
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Guest</th>
              <th scope="col">Package</th>
              <th scope="col">Tour</th>
              <th scope="col">Total</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((reservation) => (
              <tr key={reservation.bookingReference}>
                <th scope="row" className="adm-cell-primary">
                  <span className="adm-strong">{reservation.guestName}</span>
                  <span className="adm-sub">{reservation.guestEmail}</span>
                  <span className="adm-sub">{reservation.guestPhone}</span>
                  {/* The reference is the way in: one link per row, no click
                      handler, and the whole row stays selectable text. */}
                  <Link
                    className="adm-sub adm-ref-link"
                    href={packageReservationDetailHref(reservation.bookingReference)}
                  >
                    {reservation.bookingReference}
                  </Link>
                </th>
                <td>
                  <span className="adm-strong">{reservation.package.title}</span>
                  <span className="adm-sub">{reservation.package.code}</span>
                  <span className="adm-sub">{reservation.variant.label}</span>
                </td>
                <td>
                  <span className="adm-strong">{formatDateWithYear(reservation.tourDate)}</span>
                  <span className="adm-sub">{partyOf(reservation)}</span>
                  <span className="adm-sub">Requested {formatInstant(reservation.createdAt)}</span>
                </td>
                <td className="adm-cell-money">
                  <span className="adm-strong">{totalOf(reservation)}</span>
                  <span className="adm-sub">
                    <StatusBadge meta={adminPackagePricingStatus[reservation.pricingStatus]} />
                  </span>
                </td>
                <td>
                  <StatusBadge meta={adminPackageReservationStatus[reservation.status]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="adm-list">
        {reservations.map((reservation) => (
          <li key={reservation.bookingReference}>
            <div className="adm-list-top">
              <span className="adm-strong">{reservation.guestName}</span>
              <StatusBadge meta={adminPackageReservationStatus[reservation.status]} />
            </div>
            <p className="adm-sub">{reservation.guestEmail}</p>
            <p className="adm-sub">{reservation.guestPhone}</p>
            <p className="adm-sub">
              {reservation.package.title} ({reservation.package.code}), {reservation.variant.label}
            </p>
            <p className="adm-sub">
              {formatDateWithYear(reservation.tourDate)} · {partyOf(reservation)}
            </p>
            <p className="adm-sub">
              <Link
                className="adm-ref-link"
                href={packageReservationDetailHref(reservation.bookingReference)}
              >
                {reservation.bookingReference}
              </Link>
            </p>
            <p className="adm-sub">Requested {formatInstant(reservation.createdAt)}</p>
            <p className="adm-strong">{totalOf(reservation)}</p>
            <p>
              <StatusBadge meta={adminPackagePricingStatus[reservation.pricingStatus]} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
