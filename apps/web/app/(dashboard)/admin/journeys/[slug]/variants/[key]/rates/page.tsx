import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPackageRatesForm } from "@/features/admin/components/AdminPackageRatesForm";
import { packageDetailHref } from "@/features/admin/lib/packages";
import { fetchAdminPackage } from "@/features/admin/server/adminPackagesApi";

// Replacing one variant's rate tiers.
//
// A server component: the journey is read on the server so the editor shows
// the tiers that actually exist, and the variant is located within it by key.
// The form posts to a Server Action, so the browser never calls the API.

export const metadata: Metadata = { title: "Rate tiers" };

type PageProps = {
  params: Promise<{ slug: string; key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Why the last attempt did not save, as a fixed token. */
const SAVE_NOTICES = {
  invalid: {
    tone: "warn",
    text:
      "Those tiers could not be saved. Every row needs a smallest party and a rate; leave the "
      + "largest party empty for an open-ended tier, or clear the whole row to remove it.",
  },
  overlapping: {
    tone: "warn",
    text:
      "Two tiers cover the same party size, so nothing was saved. Each party size may fall in "
      + "one tier only.",
  },
  "rates-required": {
    tone: "warn",
    text:
      "This journey is active and priced from its rate tiers, so it must keep at least one. "
      + "Deactivate it, or mark it quoted on request, before removing them all. Nothing was saved.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that save could not be confirmed. The tiers below have been re-read — "
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

export default async function AdminJourneyRatesPage({ params, searchParams }: PageProps) {
  const { slug, key } = await params;
  const { saved } = await searchParams;

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await fetchAdminPackage(slug, cookie);

  if (result.state === "unauthenticated") {
    redirect("/admin/login");
  }

  if (result.state === "invalid" || result.state === "not-found") {
    notFound();
  }

  if (result.state === "unavailable") {
    return (
      <>
        <PageHeader />
        {/* No editor is offered when the current tiers are unknown: saving
            would replace a set nobody has seen. */}
        <section className="adm-panel" aria-labelledby="rates-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="rates-unavailable-title" className="adm-panel-title">
              These rate tiers are unavailable
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
  const variant = journey.variants.find((candidate) => candidate.key === key);

  if (!variant) {
    notFound();
  }

  return (
    <>
      <PageHeader slug={journey.slug} label={variant.label} />
      <SaveNotice notice={saved} />
      <AdminPackageRatesForm journey={journey} variant={variant} />
    </>
  );
}

function PageHeader({ slug, label }: { slug?: string; label?: string }) {
  return (
    <header className="adm-page-head">
      <p className="adm-detail-back">
        <Link className="adm-topbar-link" href={slug ? packageDetailHref(slug) : "/admin/journeys"}>
          {slug ? "Back to the journey" : "Back to journeys"}
        </Link>
      </p>
      <h1 className="adm-page-title">{label ? `Rates for ${label}` : "Rate tiers"}</h1>
      <p className="adm-page-lede">
        What each adult pays, by party size. Saving replaces the whole set.
      </p>
    </header>
  );
}
