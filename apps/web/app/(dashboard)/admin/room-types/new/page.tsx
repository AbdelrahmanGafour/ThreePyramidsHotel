import type { Metadata } from "next";
import Link from "next/link";
import { AdminRoomTypeCreateForm } from "@/features/admin/components/AdminRoomTypeCreateForm";
import {
  ROOM_TYPES_PATH,
  ROOM_TYPE_CREATE_NOTICES,
  parseNoticeToken,
} from "@/features/admin/lib/roomTypes";

// Creating a room type.
//
// A server component: the form posts to a Server Action, so the browser never
// learns the API's address and there is no client fetch anywhere on this page.
//
// The session guard lives in the admin layout, so this page does not check one
// — and, unlike the read pages, it makes no API call of its own. Nothing is
// read here; the Server Action forwards the caller's own Cookie when the form
// is submitted.
//
// A static segment beside `[slug]`. Next's App Router matches a static route
// before a dynamic one, so `/admin/room-types/new` reaches this page and is
// never treated as a room type whose reference is "new".

export const metadata: Metadata = { title: "New room type" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminRoomTypeNewPage({ searchParams }: PageProps) {
  // A fixed token from a closed set, used only to pick one of two prepared
  // messages. Nothing from the URL is ever rendered as text, so the reference
  // that was refused is never echoed back.
  //
  // `create-uncertain` is deliberately not in this map: a creation whose
  // outcome is unknown belongs on the list, which is the only place that can
  // show whether the room type exists.
  const notice = parseNoticeToken(await searchParams, ROOM_TYPE_CREATE_NOTICES);

  return (
    <>
      {/* Just the way back. The form's masthead carries the <h1> and the
          lede, so the page opens inside a panel rather than on the bare
          workspace — the same shape the detail pages use. */}
      <header className="adm-page-head">
        <p className="adm-detail-back">
          <Link className="adm-topbar-link" href={ROOM_TYPES_PATH}>
            Back to room types
          </Link>
        </p>
      </header>

      {notice ? (
        <p className="adm-notice" data-tone={ROOM_TYPE_CREATE_NOTICES[notice].tone} role="status">
          {ROOM_TYPE_CREATE_NOTICES[notice].message}
        </p>
      ) : null}

      <AdminRoomTypeCreateForm />
    </>
  );
}
