import { demoRoomInventory, getRoomName } from "../data/adminDemoData";
import { roomStatus } from "../lib/status";
import type { AdminRoomInventory, RoomAvailability } from "../types";
import { PanelHeader } from "./PanelHeader";
import { StatusBadge } from "./StatusBadge";

function typeStatus(r: AdminRoomInventory): RoomAvailability {
  if (r.blockedUnits === r.totalUnits) return "blocked";
  return r.totalUnits - r.occupiedUnits - r.blockedUnits > 0 ? "available" : "occupied";
}

function UnitBar({ inventory: r }: { inventory: AdminRoomInventory }) {
  const units = Array.from({ length: r.totalUnits }, (_, i) =>
    i < r.occupiedUnits ? "occupied" : i < r.occupiedUnits + r.blockedUnits ? "blocked" : "available",
  );
  return (
    <span className="adm-units" aria-hidden="true">
      {units.map((state, i) => (
        <span key={i} className="adm-unit" data-state={state} />
      ))}
    </span>
  );
}

export function RoomStatusPanel() {
  return (
    <section className="adm-panel" aria-labelledby="rooms-title">
      <PanelHeader id="rooms-title" title="Room status" note="Each room type, right now." />

      <ul className="adm-rooms">
        {demoRoomInventory.map((r) => {
          const available = r.totalUnits - r.occupiedUnits - r.blockedUnits;
          return (
            <li key={r.roomSlug}>
              <div className="adm-list-top">
                <span className="adm-strong">{getRoomName(r.roomSlug)}</span>
                <StatusBadge meta={roomStatus[typeStatus(r)]} />
              </div>
              <div className="adm-room-meter">
                <UnitBar inventory={r} />
                <p className="adm-sub">
                  {available} of {r.totalUnits} available
                  {r.blockedUnits ? `, ${r.blockedUnits} blocked` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="adm-panel-foot adm-legend">
        <span>
          <span className="adm-unit" data-state="occupied" aria-hidden="true" /> Occupied
        </span>
        <span>
          <span className="adm-unit" data-state="available" aria-hidden="true" /> Available
        </span>
        <span>
          <span className="adm-unit" data-state="blocked" aria-hidden="true" /> Blocked
        </span>
      </p>
    </section>
  );
}
