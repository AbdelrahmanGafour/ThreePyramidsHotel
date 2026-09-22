import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPhysicalRoomsPanel } from "@/features/admin/components/AdminPhysicalRoomsPanel";
import { AdminRoomTypeCapacityPanel } from "@/features/admin/components/AdminRoomTypeCapacityPanel";
import { AdminRoomTypeForm } from "@/features/admin/components/AdminRoomTypeForm";
import { PHYSICAL_ROOM_NOTICES } from "@/features/admin/lib/physicalRooms";
import {
  ROOM_TYPES_PATH,
  ROOM_TYPE_NOTICES,
  parseNoticeToken,
  parseRoomTypeNotice,
} from "@/features/admin/lib/roomTypes";
import { fetchAdminPhysicalRooms } from "@/features/admin/server/adminRoomsApi";
import { fetchAdminRoomType } from "@/features/admin/server/adminRoomTypesApi";

// One room type, with the fields an administrator may change.
//
// A server component: the room type is read on the server from Express and the
// edit posts to a Server Action, so no request to the API is ever made from the
// browser and the API's address never reaches it.
//
// The session guard lives in the admin layout; this page only forwards the
// caller's own Cookie header so the API can answer as that administrator.
//
// The slug is passed through exactly as the URL gave it — never trimmed, never
// lower-cased. The API decides whether it is a slug at all; normalising it here
// would mean asking about a room type nobody named.

export const metadata: Metadata = { title: "Room type" };

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminRoomTypePage({ params, searchParams }: PageProps) {
  const { slug } = await params;

  // A fixed token from a closed set, used only to pick one prepared message.
  // Nothing from the URL is ever rendered as text, so no submitted reference
  // or room number can reach the page through a query parameter.
  //
  // Two allowlists, because this page shows two kinds of thing: what happened
  // to the room type, and what happened to one of its rooms. They are checked
  // in that order and a token can only be in one of them.
  const query = await searchParams;
  const roomTypeNotice = parseRoomTypeNotice(query);
  const roomNotice = roomTypeNotice ? null : parseNoticeToken(query, PHYSICAL_ROOM_NOTICES);

  const notice: { tone: string; message: string } | null = roomTypeNotice
    ? ROOM_TYPE_NOTICES[roomTypeNotice]
    : roomNotice
      ? PHYSICAL_ROOM_NOTICES[roomNotice]
      : null;

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;

  // Two independent reads, in parallel: the room type and its inventory. They
  // fail independently too — a failed inventory read must not take the rest of
  // the page with it.
  const [result, roomsResult] = await Promise.all([
    fetchAdminRoomType(slug, cookie),
    fetchAdminPhysicalRooms(slug, cookie),
  ]);

  // The layout confirmed a session before this page ran, so a refusal here
  // means it ended in between. Deliberately outside any try/catch.
  if (result.state === "unauthenticated" || roomsResult.state === "unauthenticated") {
    redirect("/admin/login");
  }

  // A slug the API refused and one nobody has used are different facts, kept
  // apart in the client and reported here the same way: either there is no such
  // room type. Which of the two it was is not an administrator's to debug.
  if (result.state === "invalid-reference" || result.state === "not-found") {
    notFound();
  }

  // The same answer from the inventory read means the same thing: the room
  // type this page is about is not there.
  if (roomsResult.state === "invalid-reference" || roomsResult.state === "not-found") {
    notFound();
  }

  if (result.state === "unavailable") {
    return (
      <>
        <PageHeader />
        {/* Not a missing room type: nothing is known about this one. An outage
            is never turned into a 404 — that would say the room type had been
            removed. */}
        <section className="adm-panel" aria-labelledby="room-type-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="room-type-unavailable-title" className="adm-panel-title">
              This room type is unavailable
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
      <PageHeader name={data.name} />
      {notice ? (
        <p className="adm-notice" data-tone={notice.tone} role="status">
          {notice.message}
        </p>
      ) : null}
      {/* One stack, so the capacity panel sits beside the T01 panels with the
          same spacing. Order: archived note, fixed details, general edit, then
          capacity — the operation that can be refused comes last and stands
          on its own. */}
      <div className="adm-detail-grid">
        <AdminRoomTypeForm roomType={data} />
        <AdminRoomTypeCapacityPanel slug={data.slug} capacity={data.capacity} />
        {/* `null` when the inventory read failed, which the panel reports as
            unavailable rather than as an empty room type. */}
        <AdminPhysicalRoomsPanel
          roomTypeSlug={data.slug}
          rooms={roomsResult.state === "ok" ? roomsResult.data : null}
        />
      </div>
    </>
  );
}

function PageHeader({ name }: { name?: string }) {
  return (
    <header className="adm-page-head">
      <p className="adm-detail-back">
        <Link className="adm-topbar-link" href={ROOM_TYPES_PATH}>
          Back to room types
        </Link>
      </p>
      <h1 className="adm-page-title">{name ?? "Room type"}</h1>
    </header>
  );
}
