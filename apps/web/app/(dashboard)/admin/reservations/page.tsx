import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminReservationsTable } from "@/features/admin/components/AdminReservationsTable";
import {
  RESERVATIONS_PAGE_SIZE,
  parseReservationsOffset,
} from "@/features/admin/lib/reservationsWindow";
import { fetchAdminReservations } from "@/features/admin/server/adminReservationsApi";

// Every reservation the hotel has taken, newest first.
//
// A server component: the data is read on the server from Express, so no
// reservation ever travels to the browser except as rendered HTML, and the
// browser never learns the API's address. Paging is plain links, so there is
// nothing to hydrate and each page is a real URL.
//
// Page size is fixed here rather than taken from the URL — the API accepts a
// limit, but this page offers no page-size control, so the address bar carries
// only the position in the list.
//
// The session guard lives in the admin layout; this page only forwards the
// caller's own Cookie header so the API can answer as that administrator.

export const metadata: Metadata = { title: "Reservations" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminReservationsPage({ searchParams }: { searchParams: SearchParams }) {
  const offset = parseReservationsOffset(await searchParams);

  // Every paging link this app builds is valid, so an unusable offset was typed
  // or tampered with. Sent back to the canonical first page rather than read as
  // zero, so the address bar and the page being shown always agree.
  // Deliberately outside any try/catch: redirect() works by throwing.
  if (offset === null) {
    redirect("/admin/reservations");
  }

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await fetchAdminReservations({ limit: RESERVATIONS_PAGE_SIZE, offset }, cookie);

  // The layout confirmed a session before this page ran, so a refusal here
  // means it ended in between.
  if (result.state === "unauthenticated") {
    redirect("/admin/login");
  }

  if (result.state === "unavailable") {
    return (
      <>
        <PageHeader />
        {/* Not an empty list: nothing is known about what the hotel has booked. */}
        <section className="adm-panel" aria-labelledby="reservations-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="reservations-unavailable-title" className="adm-panel-title">
              Reservations are unavailable
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

  return (
    <>
      <PageHeader />
      <AdminReservationsTable data={result.data} />
    </>
  );
}

function PageHeader() {
  return (
    <header className="adm-page-head">
      <h1 className="adm-page-title">Reservations</h1>
      <p className="adm-page-lede">Every booking taken on the website, with its guest and stay.</p>
    </header>
  );
}
