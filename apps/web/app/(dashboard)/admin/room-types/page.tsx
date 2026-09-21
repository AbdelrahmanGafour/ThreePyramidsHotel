import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminRoomTypesTable } from "@/features/admin/components/AdminRoomTypesTable";
import { fetchAdminRoomTypes } from "@/features/admin/server/adminRoomTypesApi";

// Every room type the hotel offers, archived ones included.
//
// A server component: the catalogue is read on the server from Express, so the
// browser never learns the API's address and there is deliberately no
// same-origin proxy for room types. Opening one is a plain link, so there is
// nothing to hydrate.
//
// The whole catalogue is a short list, so there is no paging here — and the
// order is the API's, rendered exactly as it arrives.
//
// The session guard lives in the admin layout; this page only forwards the
// caller's own Cookie header so the API can answer as that administrator.

export const metadata: Metadata = { title: "Room types" };

export default async function AdminRoomTypesPage() {
  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await fetchAdminRoomTypes(cookie);

  // The layout confirmed a session before this page ran, so a refusal here
  // means it ended in between. Deliberately outside any try/catch: redirect()
  // works by throwing.
  if (result.state === "unauthenticated") {
    redirect("/admin/login");
  }

  if (result.state === "unavailable") {
    return (
      <>
        <PageHeader />
        {/* Not an empty catalogue: nothing is known about what the hotel
            offers. Showing "no room types" here would read as a hotel with
            nothing to sell. */}
        <section className="adm-panel" aria-labelledby="room-types-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="room-types-unavailable-title" className="adm-panel-title">
              Room types are unavailable
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
      <AdminRoomTypesTable roomTypes={result.data} />
    </>
  );
}

function PageHeader() {
  return (
    <header className="adm-page-head">
      <h1 className="adm-page-title">Room types</h1>
      <p className="adm-page-lede">
        The rooms guests can book, what each one costs, and how many rooms the hotel has of each.
      </p>
    </header>
  );
}
