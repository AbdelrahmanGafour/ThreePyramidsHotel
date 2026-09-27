import type { AdminNavKey } from "../types";

export type AdminIconName = AdminNavKey | "menu" | "close" | "external";

// One inline set: 20px grid, 1.5 stroke, square joins — matches the brand mark's
// precise line weight. No icon package is installed, so none is added.
const paths: Record<AdminIconName, string> = {
  overview: "M3.5 3.5h5.5v5.5H3.5zM11 3.5h5.5v5.5H11zM3.5 11H9v5.5H3.5zM11 11h5.5v5.5H11z",
  reservations: "M3.5 5h13v11.5h-13zM3.5 8.5h13M7 3v3.5M13 3v3.5",
  // A ticket stub rather than the calendar above: a journey booking is a
  // sold seat, and the two reservation areas must not read alike.
  packageReservations:
    "M2.5 6h15v3a1.5 1.5 0 0 0 0 2v3h-15v-3a1.5 1.5 0 0 0 0-2zM12.5 6v8",
  rooms: "M2.5 15.5v-8M2.5 12h15v3.5M17.5 12V9.5a2 2 0 0 0-2-2H9.5V12M5.5 10h.01",
  journeys: "M4 16.5c0-3 3-2.5 3-5.5s-3-2.5-3-5.5M16 3.5c0 3-3 2.5-3 5.5s3 2.5 3 5.5M6.5 16.5h.01M13.5 3.5h.01",
  inquiries: "M2.5 4.5h15v11h-15zM2.5 5l7.5 6 7.5-6",
  content: "M5 2.5h7.5L16 6v11.5H5zM12.5 2.5V6H16M7.5 9.5h6M7.5 12.5h6",
  media: "M2.5 4h15v12h-15zM2.5 14l4.5-4.5 3.5 3.5 2.5-2.5 5 4.5M13 8h.01",
  settings: "M3 6h8M14 6h3M3 14h3M9 14h8M12.5 4v4M7.5 12v4",
  // The person, not the hotel: a head over shoulders, so `My account` cannot
  // be mistaken for the `settings` sliders above it. Two strokes on the same
  // 20px grid, the head left clear of the shoulder line as every other glyph
  // here keeps its parts separate.
  account: "M10 3.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6M3.5 16.5a6.5 6.5 0 0 1 13 0",
  menu: "M3 5.5h14M3 10h14M3 14.5h14",
  close: "M4.5 4.5l11 11M15.5 4.5l-11 11",
  external: "M7 4.5h8.5V13M15.5 4.5 5 15",
};

export function AdminIcon({ name, className = "" }: { name: AdminIconName; className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
