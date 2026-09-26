import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPackageVariantEditForm } from "@/features/admin/components/AdminPackageVariantEditForm";
import { packageDetailHref } from "@/features/admin/lib/packages";
import { fetchAdminPackage } from "@/features/admin/server/adminPackagesApi";

// Editing one variant's metadata.
//
// A server component: the journey is read on the server so the form can be
// pre-filled with what is actually stored, and the variant is located within
// it by key. The form posts to a Server Action, so the browser never learns
// the API's address.
//
// The session guard lives in the admin layout; this page forwards the
// caller's own Cookie header for the read, and the action forwards it again
// for the write.

export const metadata: Metadata = { title: "Edit variant" };

type PageProps = {
  params: Promise<{ slug: string; key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Why the last attempt did not save, as a fixed token. */
const SAVE_NOTICES = {
  invalid: {
    tone: "warn",
    text:
      "Those details could not be saved. A child rate needs a youngest age, an oldest age and a " +
      "discount — or untick it entirely.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that save could not be confirmed. The variant below has been re-read — " +
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

export default async function AdminJourneyVariantEditPage({ params, searchParams }: PageProps) {
  const { slug, key } = await params;
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
        {/* Nothing is editable when nothing is known, so no form is offered. */}
        <section className="adm-panel" aria-labelledby="variant-edit-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="variant-edit-unavailable-title" className="adm-panel-title">
              This variant is unavailable
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

  // The journey exists but has no such variant. Same route-local not-found:
  // either way there is nothing at this address to edit.
  if (!variant) {
    notFound();
  }

  return (
    <>
      <PageHeader slug={journey.slug} label={variant.label} />
      <SaveNotice notice={saved} />
      <AdminPackageVariantEditForm journey={journey} variant={variant} />
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
      <h1 className="adm-page-title">{label ? `Edit ${label}` : "Edit variant"}</h1>
      <p className="adm-page-lede">
        Change what this variant is called and how children are priced. Its rates are managed
        separately.
      </p>
    </header>
  );
}
