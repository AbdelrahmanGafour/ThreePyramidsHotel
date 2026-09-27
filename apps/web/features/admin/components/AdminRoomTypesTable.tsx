import Link from "next/link";
import { formatEgp } from "../lib/format";
import { roomTypeDetailHref } from "../lib/roomTypes";
import { roomTypeStatus } from "../lib/status";
import type { AdminRoomTypeListItem } from "../types";
import { StatusBadge } from "./StatusBadge";

// The room-type catalogue: a desktop table and a mobile card list of the same
// rows, following the pattern the reservations list already uses.
//
// A server component with no interactivity — the only thing to do from here is
// open a room type, which is a plain link.
//
// The order is the API's. Rows are rendered exactly as they arrive, so what an
// administrator sees is the catalogue's own order rather than one this
// component invented; `sortOrder` is shown as a column so that order is
// readable rather than merely implied.

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * How many physical rooms are assigned to this type — inventory, not
 * availability. Spelled out because "rooms: 0" next to an active room type
 * reads as a mistake until you know it means nothing has been assigned to it.
 */
const rooms = (count: number) => (count === 0 ? "None assigned" : plural(count, "room"));

export function AdminRoomTypesTable({ roomTypes }: { roomTypes: AdminRoomTypeListItem[] }) {
  if (roomTypes.length === 0) {
    return (
      <section className="adm-panel" aria-labelledby="room-types-empty-title">
        <div className="adm-panel-head">
          <h2 id="room-types-empty-title" className="adm-panel-title">
            No room types yet
          </h2>
          <p className="adm-panel-note">
            The hotel has no room types set up, so there is nothing for guests to book. Room types
            are created directly in the hotel system.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="adm-panel" aria-labelledby="room-types-title">
      <div className="adm-panel-head">
        <h2 id="room-types-title" className="adm-panel-title">
          All room types
        </h2>
        <p className="adm-panel-note">
          In the order guests see them. Archived types stay here but are not offered for booking.
        </p>
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Room type</th>
              <th scope="col">Sleeps</th>
              <th scope="col">Nightly rate</th>
              {/* Not "available rooms": this counts the rooms assigned to the
                  type, whether or not any of them is free tonight. */}
              <th scope="col">Physical rooms</th>
              <th scope="col">Status</th>
              <th scope="col">Order</th>
            </tr>
          </thead>
          <tbody>
            {roomTypes.map((roomType) => (
              <tr key={roomType.slug}>
                <th scope="row" className="adm-cell-primary">
                  {/* The name is the way in: one link per row, no click
                      handler, and the whole row stays selectable text. */}
                  <Link className="adm-strong adm-ref-link" href={roomTypeDetailHref(roomType.slug)}>
                    {roomType.name}
                  </Link>
                  <span className="adm-sub">{roomType.slug}</span>
                </th>
                <td>{plural(roomType.capacity, "guest")}</td>
                <td className="adm-cell-money">{formatEgp(roomType.baseNightlyRate)}</td>
                <td>{rooms(roomType.roomCount)}</td>
                <td>
                  <StatusBadge meta={roomTypeStatus[roomType.isActive ? "active" : "inactive"]} />
                </td>
                <td>{roomType.sortOrder}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="adm-list">
        {roomTypes.map((roomType) => (
          <li key={roomType.slug}>
            <div className="adm-list-top">
              <Link className="adm-strong adm-ref-link" href={roomTypeDetailHref(roomType.slug)}>
                {roomType.name}
              </Link>
              <StatusBadge meta={roomTypeStatus[roomType.isActive ? "active" : "inactive"]} />
            </div>
            <p className="adm-sub">{roomType.slug}</p>
            <p className="adm-sub">Sleeps {plural(roomType.capacity, "guest")}</p>
            <p className="adm-sub">Physical rooms: {rooms(roomType.roomCount)}</p>
            <p className="adm-sub">Order: {roomType.sortOrder}</p>
            <p className="adm-strong">{formatEgp(roomType.baseNightlyRate)} per night</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
