import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  DetailChip,
  DetailMasthead,
  DetailPage,
} from "@/features/admin/components/AdminDetail";
import { AdminPhysicalRoomsPanel } from "@/features/admin/components/AdminPhysicalRoomsPanel";
import { AdminRoomTypeCapacityPanel } from "@/features/admin/components/AdminRoomTypeCapacityPanel";
import { AdminRoomTypeForm } from "@/features/admin/components/AdminRoomTypeForm";
import { AdminRoomTypeImagesPanel } from "@/features/admin/components/AdminRoomTypeImagesPanel";
import { ROOM_TYPE_IMAGE_NOTICES, parseRoomTypeImageNotice } from "@/features/admin/lib/imageOutcomes";
import { PHYSICAL_ROOM_NOTICES } from "@/features/admin/lib/physicalRooms";
import {
  ROOM_TYPES_PATH,
  ROOM_TYPE_NOTICES,
  parseNoticeToken,
  parseRoomTypeNotice,
} from "@/features/admin/lib/roomTypes";
import { fetchAdminPhysicalRooms } from "@/features/admin/server/adminRoomsApi";
import { fetchAdminRoomTypeImages } from "@/features/admin/server/adminRoomTypeImagesApi";
import { StatusBadge } from "@/features/admin/components/StatusBadge";
import { formatEgp } from "@/features/admin/lib/format";
import { roomTypeStatus } from "@/features/admin/lib/status";
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
  // Three allowlists, because this page shows three kinds of thing: what
  // happened to the room type, what happened to one of its rooms, and what
  // happened to one of its images. They are checked in that order and a
  // token can only be in one of them.
  const query = await searchParams;
  const roomTypeNotice = parseRoomTypeNotice(query);
  const roomNotice = roomTypeNotice ? null : parseNoticeToken(query, PHYSICAL_ROOM_NOTICES);
  const imageNotice = roomTypeNotice || roomNotice ? null : parseRoomTypeImageNotice(query);

  const notice: { tone: string; message: string } | null = roomTypeNotice
    ? ROOM_TYPE_NOTICES[roomTypeNotice]
    : roomNotice
      ? PHYSICAL_ROOM_NOTICES[roomNotice]
      : imageNotice
        ? ROOM_TYPE_IMAGE_NOTICES[imageNotice]
        : null;

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;

  // Three independent reads, in parallel: the room type, its inventory, and
  // its images. They fail independently too — a failed inventory or image
  // read must not take the rest of the page with it.
  const [result, roomsResult, imagesResult] = await Promise.all([
    fetchAdminRoomType(slug, cookie),
    fetchAdminPhysicalRooms(slug, cookie),
    fetchAdminRoomTypeImages(slug, cookie),
  ]);

  // The layout confirmed a session before this page ran, so a refusal here
  // means it ended in between. Deliberately outside any try/catch.
  if (
    result.state === "unauthenticated" ||
    roomsResult.state === "unauthenticated" ||
    imagesResult.state === "unauthenticated"
  ) {
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
        <PageHeader title="Room type" />
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
      <PageHeader />
      {notice ? (
        <p className="adm-notice" data-tone={notice.tone} role="status">
          {notice.message}
        </p>
      ) : null}
      {/* One stack, so the capacity panel sits beside the T01 panels with the
          same spacing. Order: masthead, archived note, fixed details, general
          edit, then capacity — the operation that can be refused comes last
          and stands on its own. */}
      <DetailPage>
        {/* The same masthead the other detail pages open with: what this
            record is called, how it is identified, and the state it is in. */}
        <DetailMasthead
          title={data.name}
          meta={[<span className="adm-ref" key="slug">{data.slug}</span>]}
          badges={
            <>
              <StatusBadge meta={roomTypeStatus[data.isActive ? "active" : "archived"]} />
              <DetailChip>Sleeps {data.capacity}</DetailChip>
              <DetailChip>{formatEgp(data.baseNightlyRate)} per night</DetailChip>
            </>
          }
        />
        <AdminRoomTypeForm roomType={data} />
        <AdminRoomTypeCapacityPanel slug={data.slug} capacity={data.capacity} />
        {/* `null` when the inventory read failed, which the panel reports as
            unavailable rather than as an empty room type. */}
        <AdminPhysicalRoomsPanel
          roomTypeSlug={data.slug}
          rooms={roomsResult.state === "ok" ? roomsResult.data : null}
        />
        {/* `null` for every non-`ok` state, deliberately including
            `invalid-reference` and `not-found`: the room-type read above
            already succeeded, so those two states from the image read can
            only mean a race or an inconsistent answer, never that the room
            type this page is showing is actually gone. Inventing an empty
            gallery for them would be a different, false claim, so they are
            folded into the same unavailable state as a genuine outage rather
            than sent to `notFound()`. */}
        <AdminRoomTypeImagesPanel
          slug={data.slug}
          images={imagesResult.state === "ok" ? imagesResult.data : null}
        />
      </DetailPage>
    </>
  );
}

/**
 * The way back, and a heading only where nothing else provides one.
 *
 * On a room type that loaded, the detail view's masthead carries the <h1>
 * — the room type's name — along with its reference, its status, what it
 * sleeps and its stored rate. The fallback branches have no masthead and
 * keep a heading here, so every state of this route still has exactly one.
 */
function PageHeader({ title }: { title?: string }) {
  return (
    <header className="adm-page-head">
      <p className="adm-detail-back">
        <Link className="adm-topbar-link" href={ROOM_TYPES_PATH}>
          Back to room types
        </Link>
      </p>
      {title ? <h1 className="adm-page-title">{title}</h1> : null}
    </header>
  );
}
