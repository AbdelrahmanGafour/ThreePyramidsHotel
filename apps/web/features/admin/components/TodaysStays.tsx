import { demoReservations, demoToday, getRoomName } from "../data/adminDemoData";
import { daysBetween, formatDayMonth } from "../lib/format";
import { reservationStatus } from "../lib/status";
import type { AdminReservation } from "../types";
import { PanelHeader } from "./PanelHeader";
import { StatusBadge } from "./StatusBadge";

function stayContext(r: AdminReservation) {
  if (r.arrival === demoToday) return "Arrives today";
  if (r.departure === demoToday) return "Departs today";
  const night = daysBetween(r.arrival, demoToday) + 1;
  return `In house, night ${night} of ${daysBetween(r.arrival, r.departure)}`;
}

// Arrivals first, then departures, then guests already in house.
const rank = (r: AdminReservation) => (r.arrival === demoToday ? 0 : r.departure === demoToday ? 1 : 2);

const stays = [...demoReservations].sort((a, b) => rank(a) - rank(b));

const dates = (r: AdminReservation) => `${formatDayMonth(r.arrival)} to ${formatDayMonth(r.departure)}`;
const guests = (r: AdminReservation) => `${r.guestCount} ${r.guestCount === 1 ? "guest" : "guests"}`;

export function TodaysStays() {
  return (
    <section className="adm-panel" aria-labelledby="stays-title">
      <PanelHeader
        id="stays-title"
        title="Today’s stays"
        note="Arrivals, departures and guests in house."
      />

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Guest</th>
              <th scope="col">Room</th>
              <th scope="col">Stay</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {stays.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="adm-cell-primary">
                  <span className="adm-strong">{r.guestName}</span>
                  <span className="adm-sub">
                    {guests(r)}, {r.id}
                  </span>
                </th>
                <td>{getRoomName(r.roomSlug)}</td>
                <td>
                  <span className="adm-strong">{stayContext(r)}</span>
                  <span className="adm-sub">{dates(r)}</span>
                </td>
                <td>
                  <StatusBadge meta={reservationStatus[r.status]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="adm-list">
        {stays.map((r) => (
          <li key={r.id}>
            <div className="adm-list-top">
              <span className="adm-strong">{r.guestName}</span>
              <StatusBadge meta={reservationStatus[r.status]} />
            </div>
            <p className="adm-sub">
              {getRoomName(r.roomSlug)}, {guests(r)}
            </p>
            <p className="adm-sub">
              {stayContext(r)}, {dates(r)}
            </p>
          </li>
        ))}
      </ul>

      <p className="adm-panel-foot">Full reservation records arrive with the Reservations area.</p>
    </section>
  );
}
