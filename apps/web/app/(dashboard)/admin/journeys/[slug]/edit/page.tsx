import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPackageEditForm } from "@/features/admin/components/AdminPackageEditForm";
import { packageDetailHref } from "@/features/admin/lib/packages";
import { fetchAdminPackage } from "@/features/admin/server/adminPackagesApi";

// Editing a journey.
//
// A server component: the journey is read on the server so the form can be
// pre-filled with what is actually stored, and the form posts to a Server
// Action, so the browser never learns the API's address.
//
// The session guard lives in the admin layout; this page only forwards the
// caller's own Cookie header for the read. The action forwards it again for
// the write.

export const metadata: Metadata = { title: "Edit journey" };

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Why the last attempt did not save, as a fixed token.
 *
 * Allowlisted, and only ever used to pick one of these prepared messages: the
 * value in the URL is never rendered.
 */
const SAVE_NOTICES = {
  invalid: {
    tone: "warn",
    text: "Those details could not be saved. Check the title, the days and the position, then try again.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that save could not be confirmed. The journey below has been re-read — " +
      "check it before trying again.",
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

export default async function AdminJourneyEditPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { saved } = await searchParams;

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await fetchAdminPackage(slug, cookie);

  // The layout confirmed a session before this page ran, so a refusal here
  // means it ended in between. Deliberately outside any try/catch.
  if (result.state === "unauthenticated") {
    redirect("/admin/login");
  }

  // A slug the API refused and one nothing matches are reported the same way:
  // either there is no such journey to edit.
  if (result.state === "invalid" || result.state === "not-found") {
    notFound();
  }

  if (result.state === "unavailable") {
    return (
      <>
        <PageHeader />
        {/* Nothing is editable when nothing is known: no form is offered, so
            there is no way to submit changes over an unread journey. */}
        <section className="adm-panel" aria-labelledby="journey-edit-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="journey-edit-unavailable-title" className="adm-panel-title">
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

  const { data } = result;

  return (
    <>
      <PageHeader slug={data.slug} title={data.title} />
      <SaveNotice notice={saved} />
      <AdminPackageEditForm journey={data} />
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
      <h1 className="adm-page-title">{title ? `Edit ${title}` : "Edit journey"}</h1>
      <p className="adm-page-lede">
        Change what the journey says. Its variants, rates, itinerary and content are managed
        separately.
      </p>
    </header>
  );
}
