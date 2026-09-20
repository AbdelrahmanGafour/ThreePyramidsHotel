// Shown while the booking room-selection page's getRooms() call is in
// flight. No room data, price, or availability is fabricated here.
export default function BookingRoomsLoading() {
  return (
    <div className="mx-auto max-w-[760px] px-[var(--page-x)] py-[clamp(2rem,5vw,3.5rem)] text-center">
      <p className="section-title">Loading rooms…</p>
    </div>
  );
}
