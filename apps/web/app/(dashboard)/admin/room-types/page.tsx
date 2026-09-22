import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminRoomTypesTable } from "@/features/admin/components/AdminRoomTypesTable";
import {
  ROOM_TYPES_NEW_PATH,
  ROOM_TYPE_LIST_NOTICES,
  parseNoticeToken,
} from "@/features/admin/lib/roomTypes";
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

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminRoomTypesPage({ searchParams }: PageProps) {
  // A fixed token from a closed set. Only one thing lands here: a creation
  // whose outcome is unknown, because this list is the only place that can
  // show whether the room type exists. Nothing from the URL is rendered as
  // text, so the reference that was submitted is never echoed back.
  const notice = parseNoticeToken(await searchParams, ROOM_TYPE_LIST_NOTICES);

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
        <ListNotice notice={notice} />
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
      {/* Above the catalogue, which is still rendered from freshly read data —
          the notice reports on a request, not on what the list shows. */}
      <ListNotice notice={notice} />
      <AdminRoomTypesTable roomTypes={result.data} />
    </>
  );
}

function ListNotice({ notice }: { notice: keyof typeof ROOM_TYPE_LIST_NOTICES | null }) {
  if (!notice) {
    return null;
  }

  return (
    <p className="adm-notice" data-tone={ROOM_TYPE_LIST_NOTICES[notice].tone} role="status">
      {ROOM_TYPE_LIST_NOTICES[notice].message}
    </p>
  );
}

function PageHeader() {
  return (
    <header className="adm-page-head">
      <h1 className="adm-page-title">Room types</h1>
      <p className="adm-page-lede">
        The rooms guests can book, what each one costs, and how many rooms the hotel has of each.
      </p>
      {/* A plain link to a real page, not a modal: creating a room type is a
          form worth its own address. */}
      <p>
        <Link className="adm-topbar-link" href={ROOM_TYPES_NEW_PATH}>
          Create room type
        </Link>
      </p>
    </header>
  );
}
