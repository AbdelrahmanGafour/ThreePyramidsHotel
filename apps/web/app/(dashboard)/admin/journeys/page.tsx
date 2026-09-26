import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AdminPackagesTable } from "@/features/admin/components/AdminPackagesTable";
import { PACKAGES_NEW_PATH } from "@/features/admin/lib/packages";
import { fetchAdminPackages } from "@/features/admin/server/adminPackagesApi";

// The journey catalogue, in the order guests see it.
//
// A server component: the catalogue is read on the server from Express, so the
// browser never learns the API's address, and an offering withdrawn from sale
// never reaches it as anything but rendered HTML.
//
// No paging yet — the API returns the whole catalogue — so the only search
// parameter this route reads is the notice a deletion leaves behind, which is
// an allowlisted token and never rendered as text.
//
// The session guard lives in the admin layout; this page only forwards the
// caller's own Cookie header so the API can answer as that administrator.

export const metadata: Metadata = { title: "Journeys" };

/**
 * Feedback the journey delete action left behind, as a fixed token.
 *
 * `gone` is deliberately neutral rather than triumphant: the administrator
 * who pressed the button may not be the one who removed the journey.
 */
const CATALOGUE_NOTICES = {
  "1": {
    tone: "done",
    text: "That journey and everything it held have been deleted.",
  },
  gone: {
    tone: "warn",
    text: "That journey was already gone. The catalogue below has been re-read.",
  },
} as const;

function CatalogueNotice({ notice }: { notice: string | string[] | undefined }) {
  const known =
    typeof notice === "string" && Object.hasOwn(CATALOGUE_NOTICES, notice)
      ? CATALOGUE_NOTICES[notice as keyof typeof CATALOGUE_NOTICES]
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

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminJourneysPage({ searchParams }: PageProps) {
  const { deleted } = await searchParams;

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await fetchAdminPackages(cookie);

  // The layout confirmed a session before this page ran, so a refusal here
  // means it ended in between.
  if (result.state === "unauthenticated") {
    redirect("/admin/login");
  }

  if (result.state === "unavailable") {
    return (
      <>
        <PageHeader />
        {/* Not an empty catalogue: nothing is known about what the hotel offers. */}
        <section className="adm-panel" aria-labelledby="journeys-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="journeys-unavailable-title" className="adm-panel-title">
              Journeys are unavailable
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
      <CatalogueNotice notice={deleted} />
      <AdminPackagesTable data={result.data} />
    </>
  );
}

function PageHeader() {
  return (
    <header className="adm-page-head">
      <h1 className="adm-page-title">Journeys</h1>
      <p className="adm-page-lede">
        The curated journeys guests can enquire about, and what each one offers.
      </p>
      <p className="adm-page-actions">
        <Link className="adm-action-btn" data-tone="confirm" href={PACKAGES_NEW_PATH}>
          New journey
        </Link>
      </p>
    </header>
  );
}
