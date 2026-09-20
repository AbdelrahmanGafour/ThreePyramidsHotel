import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminReservationDetailView } from "@/features/admin/components/AdminReservationDetail";
import { fetchAdminReservation } from "@/features/admin/server/adminReservationsApi";

// One reservation in full.
//
// A server component: the booking is read on the server from Express, so guest
// contact details and the allocated room never travel to the browser except as
// rendered HTML, and the browser never learns the API's address.
//
// The session guard lives in the admin layout; this page only forwards the
// caller's own Cookie header so the API can answer as that administrator.
//
// The booking reference is passed through exactly as the URL gave it. The API
// decides whether it is a reference at all — validating it here as well would
// be a second opinion that could disagree with the first.

export const metadata: Metadata = { title: "Reservation" };

type PageProps = {
  params: Promise<{ bookingReference: string }>;
};

export default async function AdminReservationDetailPage({ params }: PageProps) {
  const { bookingReference } = await params;

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await fetchAdminReservation(bookingReference, cookie);

  // The layout confirmed a session before this page ran, so a refusal here
  // means it ended in between. Deliberately outside any try/catch.
  if (result.state === "unauthenticated") {
    redirect("/admin/login");
  }

  // A reference the API refused and one nobody booked are different facts, kept
  // apart in the client and reported to staff the same way: either there is no
  // such reservation. Which of the two it was is not theirs to debug.
  if (result.state === "invalid" || result.state === "not-found") {
    notFound();
  }

  if (result.state === "unavailable") {
    return (
      <>
        <PageHeader />
        {/* Not a missing reservation: nothing is known about this booking. */}
        <section className="adm-panel" aria-labelledby="detail-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="detail-unavailable-title" className="adm-panel-title">
              This reservation is unavailable
            </h2>
            <p className="adm-panel-note">
              {result.reason} Reload the page in a moment; if it keeps failing, contact the hotel’s
              system administrator.
            </p>
          </div>
        </section>
      </>
    );
  }

  const { data } = result;

  return (
    <>
      <PageHeader reference={data.bookingReference} guestName={`${data.guest.firstName} ${data.guest.lastName}`} />
      <AdminReservationDetailView reservation={data} />
    </>
  );
}

function PageHeader({ reference, guestName }: { reference?: string; guestName?: string }) {
  return (
    <header className="adm-page-head">
      <p className="adm-detail-back">
        <Link className="adm-topbar-link" href="/admin/reservations">
          Back to reservations
        </Link>
      </p>
      <h1 className="adm-page-title">{reference ?? "Reservation"}</h1>
      {guestName ? <p className="adm-page-lede">Booked by {guestName}.</p> : null}
    </header>
  );
}
