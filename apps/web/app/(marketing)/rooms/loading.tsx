// Covers both /rooms and /rooms/[slug] (this segment and its children) while
// getRooms()/getRoomBySlug() are in flight. No room data, price, or
// availability is fabricated here.
export default function RoomsLoading() {
  return (
    <main id="main-content" className="px-[var(--page-x)] py-[clamp(3.5rem,9vw,5.5rem)] text-center">
      <p className="section-title">Loading rooms…</p>
    </main>
  );
}
