import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPackageContentForm } from "@/features/admin/components/AdminPackageContentForm";
import {
  MAX_CONTENT_ENTRIES,
  packageDetailHref,
} from "@/features/admin/lib/packages";
import { fetchAdminPackage } from "@/features/admin/server/adminPackagesApi";

// Rewriting what a journey says it includes, excludes and notes.
//
// A server component: the journey is read on the server so the form is
// pre-filled with what is actually stored, in the order a guest reads it. The
// form posts to a Server Action, so the browser never learns the API's
// address.
//
// The session guard lives in the admin layout; this page forwards the
// caller's own Cookie header for the read, and the action forwards it again
// for the write.

export const metadata: Metadata = { title: "Journey content" };

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Why the last attempt did not save, as a fixed token. */
const SAVE_NOTICES = {
  invalid: {
    tone: "warn",
    text:
      "Those lists could not be saved, and nothing was changed. Every line must have text with "
      + "no space at the start or end — clear a box entirely to remove that line.",
  },
  "too-many": {
    tone: "warn",
    text:
      `Nothing was saved: a list may hold at most ${MAX_CONTENT_ENTRIES} lines. Remove some `
      + "before saving again.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that save could not be confirmed. The lists below have been re-read — "
      + "check them before trying again.",
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

export default async function AdminJourneyContentPage({ params, searchParams }: PageProps) {
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
        {/* No form is offered when the current lists are unknown: saving
            would replace content nobody has seen. */}
        <section className="adm-panel" aria-labelledby="content-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="content-unavailable-title" className="adm-panel-title">
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
      <AdminPackageContentForm journey={journey} />
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
      <h1 className="adm-page-title">{title ? `Content for ${title}` : "Journey content"}</h1>
      <p className="adm-page-lede">
        What this journey includes, what it excludes, and anything a guest should know. These
        lists appear on the journey’s page and change nothing about pricing or availability.
      </p>
    </header>
  );
}
