import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPackageItineraryForm } from "@/features/admin/components/AdminPackageItineraryForm";
import {
  MAX_ITINERARY_SECTIONS,
  packageDetailHref,
} from "@/features/admin/lib/packages";
import { fetchAdminPackage } from "@/features/admin/server/adminPackagesApi";

// Rewriting a journey's day-by-day plan.
//
// A server component: the journey is read on the server so the form is
// pre-filled with what is actually stored, in the order a guest reads it. The
// form posts to a Server Action, so the browser never learns the API's
// address.
//
// The session guard lives in the admin layout; this page forwards the
// caller's own Cookie header for the read, and the action forwards it again
// for the write.

export const metadata: Metadata = { title: "Journey itinerary" };

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Why the last attempt did not save, as a fixed token. */
const SAVE_NOTICES = {
  invalid: {
    tone: "warn",
    text:
      "That itinerary could not be saved, and nothing was changed. Every section you are using "
      + "needs a body; a day number must be a whole number above zero; and text must have no "
      + "space at the start or end. Clear all three boxes of a section to remove it.",
  },
  "too-many": {
    tone: "warn",
    text:
      `Nothing was saved: a journey may have at most ${MAX_ITINERARY_SECTIONS} sections. Remove `
      + "some before saving again.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that save could not be confirmed. The itinerary below has been re-read — "
      + "check it before trying again.",
  },
} as const;

function SaveNotice({ notice }: { notice: string | string[] | undefined }) {
  const known =
    typeof notice === "string" && Object.hasOwn(SAVE_NOTICES, notice)
      ? SAVE_NOTICES[notice as keyof typeof SAVE_NOTICES]
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

export default async function AdminJourneyItineraryPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { saved } = await searchParams;

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await fetchAdminPackage(slug, cookie);

  if (result.state === "unauthenticated") {
    redirect("/admin/login");
  }

  // A journey that does not exist and one whose address is not an address are
  // reported the same way: there is nothing here to edit.
  if (result.state === "invalid" || result.state === "not-found") {
    notFound();
  }

  if (result.state === "unavailable") {
    return (
      <>
        <PageHeader />
        {/* No form is offered when the current itinerary is unknown: saving
            would replace sections nobody has seen. */}
        <section className="adm-panel" aria-labelledby="itinerary-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="itinerary-unavailable-title" className="adm-panel-title">
              This journey is unavailable
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

  const journey = result.data;

  return (
    <>
      <PageHeader slug={journey.slug} title={journey.title} />
      <SaveNotice notice={saved} />
      <AdminPackageItineraryForm journey={journey} />
    </>
  );
}

function PageHeader({ slug, title }: { slug?: string; title?: string }) {
  return (
    <header className="adm-page-head">
      <p className="adm-detail-back">
        <Link className="adm-topbar-link" href={slug ? packageDetailHref(slug) : "/admin/journeys"}>
          {slug ? "Back to the journey" : "Back to journeys"}
        </Link>
      </p>
      <h1 className="adm-page-title">{title ? `Itinerary for ${title}` : "Journey itinerary"}</h1>
      <p className="adm-page-lede">
        What happens, day by day. This appears on the journey’s page and changes nothing about
        pricing or availability.
      </p>
    </header>
  );
}
