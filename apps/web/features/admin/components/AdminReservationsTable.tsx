import Link from "next/link";
import { formatDateWithYear, formatEgp, formatInstant } from "../lib/format";
import { reservationDetailHref, reservationsOffsetHref } from "../lib/reservationsWindow";
import { adminReservationStatus } from "../lib/status";
import type { AdminReservationList, AdminReservationListItem } from "../types";
import { StatusBadge } from "./StatusBadge";

// The real reservations list: a desktop table and a mobile card list of the
// same rows, following the pattern the overview panels already use.
//
// A server component with no interactivity of its own — paging is plain links,
// so the list works before any JavaScript arrives and each window is a real,
// shareable URL.

const stay = (reservation: AdminReservationListItem) =>
  `${formatDateWithYear(reservation.checkIn)} to ${formatDateWithYear(reservation.checkOut)}`;

/**
 * `count` is how many rows this page actually returned, which is not always
 * derivable from the window: a valid offset past the end has a window but no
 * rows, and a range computed from it alone reads as nonsense ("99925–1 of 1").
 */
function Pager({ pagination, count }: { pagination: AdminReservationList["pagination"]; count: number }) {
  const { limit, offset, total } = pagination;
  const first = offset + 1;
  const last = Math.min(offset + limit, total);
  const hasPrevious = offset > 0;
  const hasNext = offset + limit < total;

  // A valid offset past the end steps back to the last page that has rows, not
  // one page back: from a far-off offset, stepping would mean thousands of
  // clicks through empty pages to reach the data again.
  const pastEnd = total > 0 && count === 0;
  const previousOffset = pastEnd
    ? Math.floor((total - 1) / limit) * limit
    : Math.max(0, offset - limit);

  return (
    <nav className="adm-pager" aria-label="Reservations pages">
      <p className="adm-pager-count">
        {total === 0
          ? "No reservations"
          : count === 0
            ? // Past the end: there is no range to describe, only a total.
              `${total} reservation${total === 1 ? "" : "s"} in total`
            : `Showing ${first}–${last} of ${total}`}
      </p>

      <div className="adm-pager-links">
        {hasPrevious ? (
          <Link className="adm-pager-link" href={reservationsOffsetHref(previousOffset)}>
            Previous
          </Link>
        ) : (
          // A non-link rather than a disabled link: there is nowhere to go.
          <span className="adm-pager-link" data-state="unavailable" aria-disabled="true">
            Previous
          </span>
        )}

        {hasNext ? (
          <Link className="adm-pager-link" href={reservationsOffsetHref(offset + limit)}>
            Next
          </Link>
        ) : (
          <span className="adm-pager-link" data-state="unavailable" aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}

export function AdminReservationsTable({ data }: { data: AdminReservationList }) {
  const { reservations, pagination } = data;

  if (reservations.length === 0) {
    return (
      <section className="adm-panel" aria-labelledby="reservations-empty-title">
        <div className="adm-panel-head">
          <h2 id="reservations-empty-title" className="adm-panel-title">
            {pagination.total === 0 ? "No reservations yet" : "Nothing on this page"}
          </h2>
          <p className="adm-panel-note">
            {pagination.total === 0
              ? "Bookings made on the website will appear here as soon as they are taken."
              : "This page is past the end of the list."}
          </p>
        </div>
        {pagination.total > 0 ? <Pager pagination={pagination} count={0} /> : null}
      </section>
    );
  }

  return (
    <section className="adm-panel" aria-labelledby="reservations-title">
      <div className="adm-panel-head">
        <h2 id="reservations-title" className="adm-panel-title">
          All reservations
        </h2>
        <p className="adm-panel-note">Newest booking first.</p>
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Guest</th>
              <th scope="col">Room</th>
              <th scope="col">Stay</th>
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
                  {/* The reference is the way in: one link per row, no click
                      handler, and the whole row stays selectable text. */}
                  <Link className="adm-sub adm-ref-link" href={reservationDetailHref(reservation.bookingReference)}>
                    {reservation.bookingReference}
                  </Link>
                </th>
                <td>{reservation.roomType.name}</td>
                <td>
                  <span className="adm-strong">{stay(reservation)}</span>
                  <span className="adm-sub">Booked {formatInstant(reservation.createdAt)}</span>
                </td>
                <td className="adm-cell-money">{formatEgp(reservation.totalAmount)}</td>
                <td>
                  <StatusBadge meta={adminReservationStatus[reservation.status]} />
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
              <StatusBadge meta={adminReservationStatus[reservation.status]} />
            </div>
            <p className="adm-sub">{reservation.guestEmail}</p>
            <p className="adm-sub">
              {reservation.roomType.name},{" "}
              <Link className="adm-ref-link" href={reservationDetailHref(reservation.bookingReference)}>
                {reservation.bookingReference}
              </Link>
            </p>
            <p className="adm-sub">{stay(reservation)}</p>
            <p className="adm-sub">Booked {formatInstant(reservation.createdAt)}</p>
            <p className="adm-strong">{formatEgp(reservation.totalAmount)}</p>
          </li>
        ))}
      </ul>

      <Pager pagination={pagination} count={reservations.length} />
    </section>
  );
}
