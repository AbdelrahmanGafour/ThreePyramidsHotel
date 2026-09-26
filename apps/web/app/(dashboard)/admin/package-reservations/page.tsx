import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPackageReservationsTable } from "@/features/admin/components/AdminPackageReservationsTable";
import { fetchAdminPackageReservations } from "@/features/admin/server/adminPackageReservationsApi";

// Every package reservation the hotel has taken, newest first.
//
// A server component: the data is read on the server from Express, so no
// reservation ever travels to the browser except as rendered HTML, and the
// browser never learns the API's address.
//
// No paging yet — the API returns the whole list — so this route takes no
// search parameters and the address bar carries nothing but the path.
//
// The session guard lives in the admin layout; this page only forwards the
// caller's own Cookie header so the API can answer as that administrator.

export const metadata: Metadata = { title: "Package reservations" };

export default async function AdminPackageReservationsPage() {
  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await fetchAdminPackageReservations(cookie);

  // The layout confirmed a session before this page ran, so a refusal here
  // means it ended in between.
  if (result.state === "unauthenticated") {
    redirect("/admin/login");
  }

  if (result.state === "unavailable") {
    return (
      <>
        <PageHeader />
        {/* Not an empty list: nothing is known about what the hotel has taken. */}
        <section className="adm-panel" aria-labelledby="package-reservations-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="package-reservations-unavailable-title" className="adm-panel-title">
              Package reservations are unavailable
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
      <AdminPackageReservationsTable data={result.data} />
    </>
  );
}

function PageHeader() {
  return (
    <header className="adm-page-head">
      <h1 className="adm-page-title">Package reservations</h1>
      <p className="adm-page-lede">
        Every journey request taken on the website, with its guest and tour.
      </p>
    </header>
  );
}
