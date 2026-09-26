import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DetailPage } from "@/features/admin/components/AdminDetail";
import { AdminPackageReservationActions } from "@/features/admin/components/AdminPackageReservationActions";
import { AdminPackageReservationDetailView } from "@/features/admin/components/AdminPackageReservationDetail";
import { fetchAdminPackageReservation } from "@/features/admin/server/adminPackageReservationsApi";

// One package reservation in full.
//
// A server component: the request is read on the server from Express, so guest
// contact details never travel to the browser except as rendered HTML, and the
// browser never learns the API's address.
//
// The session guard lives in the admin layout; this page only forwards the
// caller's own Cookie header so the API can answer as that administrator.
//
// The booking reference is passed through exactly as the URL gave it; the
// client encodes it into one path segment. Whether it is a reference at all is
// the API's decision — validating it here as well would be a second opinion
// that could disagree with the first.

export const metadata: Metadata = { title: "Package reservation" };

type PageProps = {
  params: Promise<{ bookingReference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Feedback the status action left behind, as a fixed token.
 *
 * Allowlisted, and only ever used to choose one of the messages below: the
 * value in the URL is never rendered, and the reservation's status always
 * comes from the API, never from here. Anything unrecognised shows nothing.
 */
const STATUS_NOTICES = {
  updated: {
    tone: "done",
    text: "The request status has been updated.",
  },
  conflict: {
    tone: "warn",
    text:
      "This request changed before that action was applied, so nothing was altered. " +
      "The status below has been refreshed.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of the status change could not be confirmed. Review the current status " +
      "below before trying again.",
  },
  invalid: {
    tone: "warn",
    text: "That action could not be applied. The status below has been refreshed.",
  },
} as const;

function StatusNotice({ notice }: { notice: string | string[] | undefined }) {
  const known =
    typeof notice === "string" && Object.hasOwn(STATUS_NOTICES, notice)
      ? STATUS_NOTICES[notice as keyof typeof STATUS_NOTICES]
      : null;

  if (!known) {
    return null;
  }

  return (
    <p className="adm-notice" data-tone={known.tone} role="status">
      {known.text}
    </p>
  );
}

export default async function AdminPackageReservationDetailPage({ params, searchParams }: PageProps) {
  const { bookingReference } = await params;
  const { statusAction } = await searchParams;

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await fetchAdminPackageReservation(bookingReference, cookie);

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
        <PageHeader title="Package reservation" />
        {/* Not a missing reservation: nothing is known about this request. */}
        <section className="adm-panel" aria-labelledby="package-detail-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="package-detail-unavailable-title" className="adm-panel-title">
              This package reservation is unavailable
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
      <StatusNotice notice={statusAction} />
      <DetailPage>
        <AdminPackageReservationDetailView
          reservation={data}
          actions={
            <AdminPackageReservationActions
              bookingReference={data.bookingReference}
              status={data.status}
            />
          }
        />
      </DetailPage>
    </>
  );
}

/**
 * The way back, and a heading only where nothing else provides one.
 *
 * On a reservation that loaded, the detail view's masthead carries the <h1>
 * — the booking reference — along with the guest's name, when the request
 * arrived and the two statuses. The fallback branches have no masthead and
 * keep a heading here, so every state of this route still has exactly one.
 */
function PageHeader({ title }: { title?: string }) {
  return (
    <header className="adm-page-head">
      <p className="adm-detail-back">
        <Link className="adm-topbar-link" href="/admin/package-reservations">
          Back to package reservations
        </Link>
      </p>
      {title ? <h1 className="adm-page-title">{title}</h1> : null}
    </header>
  );
}
