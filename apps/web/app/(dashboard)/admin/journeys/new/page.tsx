import type { Metadata } from "next";
import Link from "next/link";
import { AdminPackageCreateForm } from "@/features/admin/components/AdminPackageCreateForm";
import { PACKAGES_PATH } from "@/features/admin/lib/packages";

// Creating a journey.
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
// before a dynamic one, so `/admin/journeys/new` reaches this page and is
// never treated as a journey whose address is "new".

export const metadata: Metadata = { title: "New journey" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Why the last attempt did not create a journey, as a fixed token.
 *
 * Allowlisted, and only ever used to pick one of these prepared messages: the
 * value in the URL is never rendered, so the code or address that was refused
 * is never echoed back.
 */
const CREATE_NOTICES = {
  invalid: {
    tone: "warn",
    text: "Those details could not be used. Check the code, the address and the position, then try again.",
  },
  reserved: {
    tone: "warn",
    text:
      "That code or address belongs to the brochure catalogue, which the hotel's own listings " +
      "own. Choose a different one — no journey was created.",
  },
  "code-in-use": {
    tone: "warn",
    text: "Another journey already uses that code. Choose a different one — no journey was created.",
  },
  "slug-in-use": {
    tone: "warn",
    text: "Another journey already uses that address. Choose a different one — no journey was created.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that attempt could not be confirmed. Check the catalogue before trying " +
      "again, in case the journey was created.",
  },
} as const;

function CreateNotice({ notice }: { notice: string | string[] | undefined }) {
  const known =
    typeof notice === "string" && Object.hasOwn(CREATE_NOTICES, notice)
      ? CREATE_NOTICES[notice as keyof typeof CREATE_NOTICES]
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

export default async function AdminJourneyNewPage({ searchParams }: PageProps) {
  const { created } = await searchParams;

  return (
    <>
      {/* Just the way back. The form's masthead carries the <h1> and the
          lede, so the page opens inside a panel rather than on the bare
          workspace — the same shape the detail pages use. */}
      <header className="adm-page-head">
        <p className="adm-detail-back">
          <Link className="adm-topbar-link" href={PACKAGES_PATH}>
            Back to journeys
          </Link>
        </p>
      </header>

      <CreateNotice notice={created} />
      <AdminPackageCreateForm />
    </>
  );
}
