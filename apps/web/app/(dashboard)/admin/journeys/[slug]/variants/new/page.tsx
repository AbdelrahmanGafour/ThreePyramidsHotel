import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPackageVariantCreateForm } from "@/features/admin/components/AdminPackageVariantCreateForm";
import {
  VARIANT_CREATE_BLOCKED_MESSAGE,
  packageAllowsVariantCreate,
  packageDetailHref,
} from "@/features/admin/lib/packages";
import { fetchAdminPackage } from "@/features/admin/server/adminPackagesApi";

// Adding one variant to a journey.
//
// A server component: the journey is read on the server so the page can say
// whether a variant may be added at all, and what the server will decide
// about this one. The form posts to a Server Action, so the browser never
// learns the API's address.
//
// The session guard lives in the admin layout; this page forwards the
// caller's own Cookie header for the read, and the action forwards it again
// for the write.

export const metadata: Metadata = { title: "Add variant" };

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Why the last attempt did not create the variant, as a fixed token. */
const SAVE_NOTICES = {
  invalid: {
    tone: "warn",
    text:
      "That variant could not be added. The key must be lower-case letters, numbers and hyphens, "
      + "and a child rate needs a youngest age, an oldest age and a discount — or untick it "
      + "entirely. Nothing was created.",
  },
  "key-in-use": {
    tone: "warn",
    text:
      "This journey already has a variant with that key, so nothing was created. Keys are unique "
      + "within a journey; choose another.",
  },
  "must-be-inactive": {
    tone: "warn",
    text:
      "This journey became active before that could be saved, so nothing was created. A variant "
      + "starts with no rates and cannot be added to a journey guests can see.",
  },
  "default-unsafe": {
    tone: "warn",
    text:
      "This journey has one variant that is not marked as the default, so adding a second would "
      + "change which variant a booking resolves to when a guest names none. Nothing was created; "
      + "mark the existing variant as the default first.",
  },
  "order-exhausted": {
    tone: "warn",
    text:
      "This journey has no ordering position left for another variant, so nothing was created.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that request could not be confirmed. Check the journey's variants below "
      + "before trying again — sending it a second time could add the variant twice.",
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

export default async function AdminJourneyVariantNewPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { saved } = await searchParams;

  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await fetchAdminPackage(slug, cookie);

  if (result.state === "unauthenticated") {
    redirect("/admin/login");
  }

  // A journey that does not exist and one whose address is not an address are
  // reported the same way: there is nothing here to add a variant to.
  if (result.state === "invalid" || result.state === "not-found") {
    notFound();
  }

  if (result.state === "unavailable") {
    return (
      <>
        <PageHeader />
        {/* No form is offered when the journey is unknown: whether a variant
            may be added at all depends on state this page could not read. */}
        <section className="adm-panel" aria-labelledby="variant-new-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="variant-new-unavailable-title" className="adm-panel-title">
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

  // A live journey gets an explanation instead of a form. Nothing here
  // withdraws it — that is the administrator's decision, made on the
  // journey's own page.
  if (!packageAllowsVariantCreate(journey)) {
    return (
      <>
        <PageHeader slug={journey.slug} title={journey.title} />
        <section className="adm-panel" aria-labelledby="variant-new-blocked-title">
          <div className="adm-panel-head">
            <h2 id="variant-new-blocked-title" className="adm-panel-title">
              Deactivate this journey first
            </h2>
            <p className="adm-panel-note">{VARIANT_CREATE_BLOCKED_MESSAGE}</p>
          </div>
          <p className="adm-panel-foot">
            <Link className="adm-topbar-link" href={packageDetailHref(journey.slug)}>
              Go to the journey to deactivate it
            </Link>
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader slug={journey.slug} title={journey.title} />
      <SaveNotice notice={saved} />
      <AdminPackageVariantCreateForm journey={journey} />
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
      <h1 className="adm-page-title">{title ? `Add a variant to ${title}` : "Add variant"}</h1>
      <p className="adm-page-lede">
        A variant is one way to take this journey — a service level or a cabin class. It arrives
        with no rates, which are set separately.
      </p>
    </header>
  );
}
