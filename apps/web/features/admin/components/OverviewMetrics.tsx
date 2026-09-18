import {
  demoInquiries,
  demoReservations,
  demoRoomInventory,
  demoToday,
} from "../data/adminDemoData";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function OverviewMetrics() {
  const arrivals = demoReservations.filter((r) => r.arrival === demoToday && r.status !== "cancelled");
  const awaitingCheckIn = arrivals.filter((r) => r.status === "confirmed" || r.status === "pending");
  const departures = demoReservations.filter((r) => r.departure === demoToday && r.status !== "cancelled");
  const stillInRoom = departures.filter((r) => r.status === "checked-in");

  const totalRooms = demoRoomInventory.reduce((sum, r) => sum + r.totalUnits, 0);
  const occupied = demoRoomInventory.reduce((sum, r) => sum + r.occupiedUnits, 0);
  const blocked = demoRoomInventory.reduce((sum, r) => sum + r.blockedUnits, 0);

  const newInquiries = demoInquiries.filter((i) => i.status === "new").length;
  const inProgress = demoInquiries.filter((i) => i.status === "in-progress").length;

  const metrics = [
    {
      label: "Today’s arrivals",
      value: arrivals.length,
      detail: awaitingCheckIn.length ? `${awaitingCheckIn.length} awaiting check-in` : "All checked in",
    },
    {
      label: "Today’s departures",
      value: departures.length,
      detail: stillInRoom.length ? `${stillInRoom.length} yet to check out` : "All checked out",
    },
    {
      label: "Occupied rooms",
      value: occupied,
      detail: `of ${totalRooms}${blocked ? `, ${plural(blocked, "room")} blocked` : ""}`,
    },
    {
      label: "Open inquiries",
      value: newInquiries + inProgress,
      detail: `${newInquiries} new, ${inProgress} in progress`,
    },
  ];

  return (
    <section aria-label="Today at a glance" className="adm-metrics">
      <dl>
        {metrics.map((metric) => (
          <div key={metric.label} className="adm-metric">
            <dt>{metric.label}</dt>
            <dd className="adm-metric-value">{metric.value}</dd>
            <dd className="adm-metric-detail">{metric.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
