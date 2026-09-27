import { Fragment } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPackageActions } from "@/features/admin/components/AdminPackageActions";
import { DetailPage } from "@/features/admin/components/AdminDetail";
import { AdminPackageDeleteAction } from "@/features/admin/components/AdminPackageDeleteAction";
import { AdminPackageImagePanel } from "@/features/admin/components/AdminPackageImagePanel";
import {
  PACKAGE_IMAGE_NOTICES,
  parsePackageImageNotice,
} from "@/features/admin/lib/packageImageOutcomes";
import { AdminPackageDefaultVariantAction } from "@/features/admin/components/AdminPackageDefaultVariantAction";
import { AdminPackageDetailView } from "@/features/admin/components/AdminPackageDetail";
import { AdminPackageVariantDeleteAction } from "@/features/admin/components/AdminPackageVariantDeleteAction";
import { AdminPackageVariantOrderActions } from "@/features/admin/components/AdminPackageVariantOrderActions";
import { fetchAdminPackage } from "@/features/admin/server/adminPackagesApi";

// One journey in full.
//
// A server component: the catalogue is read on the server from Express, so the
// browser never learns the API's address, and a journey withdrawn from sale
// never reaches it as anything but rendered HTML.
//
// The session guard lives in the admin layout; this page only forwards the
// caller's own Cookie header so the API can answer as that administrator.
//
// The slug is passed through exactly as the URL gave it; the client encodes it
// into one path segment. Whether it is a slug at all is the API's decision.

export const metadata: Metadata = { title: "Journey" };

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Feedback the availability action left behind, as a fixed token.
 *
 * Allowlisted, and only ever used to choose one of the messages below: the
 * value in the URL is never rendered, and the journey's own state always comes
 * from the API, never from here. Anything unrecognised shows nothing.
 */
const STATUS_NOTICES = {
  updated: {
    tone: "done",
    text: "This journey's availability has been updated.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that change could not be confirmed. Check the availability shown below " +
      "before trying again.",
  },
  invalid: {
    tone: "warn",
    text: "That change could not be applied. The availability below has been refreshed.",
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

/**
 * Feedback the default-variant action left behind, as a fixed token.
 *
 * Allowlisted the same way the availability notices are: the value in the URL
 * is never rendered, and which variant actually leads always comes from the
 * API below.
 */
const DEFAULT_VARIANT_NOTICES = {
  updated: {
    tone: "done",
    text: "The variant this journey leads with has been updated.",
  },
  "must-be-inactive": {
    tone: "warn",
    text:
      "This journey became active before that could be saved, so the default was not changed. "
      + "Moving it changes what a booking without a named variant resolves to, which is not "
      + "something to do while guests can see the journey.",
  },
  gone: {
    tone: "warn",
    text:
      "That variant could not be found, so the default was not changed. The journey below has "
      + "been re-read.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that change could not be confirmed. Check which variant is marked as the "
      + "default below before trying again.",
  },
} as const;

function DefaultVariantNotice({ notice }: { notice: string | string[] | undefined }) {
  const known =
    typeof notice === "string" && Object.hasOwn(DEFAULT_VARIANT_NOTICES, notice)
      ? DEFAULT_VARIANT_NOTICES[notice as keyof typeof DEFAULT_VARIANT_NOTICES]
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

/**
 * Feedback the reorder action left behind, as a fixed token.
 *
 * Allowlisted like its siblings: the value in the URL is never rendered, and
 * the order shown below always comes from the API.
 */
const VARIANT_ORDER_NOTICES = {
  updated: {
    tone: "done",
    text: "The order these variants are listed in has been updated.",
  },
  stale: {
    tone: "warn",
    text:
      "This journey's variants changed since the page was opened, so the order was not saved. "
      + "Nothing was rearranged and no variant was added or removed on your behalf — review the "
      + "refreshed order below before trying again.",
  },
  "order-exhausted": {
    tone: "warn",
    text:
      "This journey has no ordering range left, so the order was not changed. Nothing was "
      + "rearranged.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that change could not be confirmed. The order below has been re-read — "
      + "check it before trying again.",
  },
} as const;

function VariantOrderNotice({ notice }: { notice: string | string[] | undefined }) {
  const known =
    typeof notice === "string" && Object.hasOwn(VARIANT_ORDER_NOTICES, notice)
      ? VARIANT_ORDER_NOTICES[notice as keyof typeof VARIANT_ORDER_NOTICES]
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

/**
 * Feedback the variant-delete action left behind, as a fixed token.
 *
 * Allowlisted like its siblings: the value in the URL is never rendered, and
 * which variants remain always comes from the API.
 */
const VARIANT_DELETE_NOTICES = {
  deleted: {
    tone: "done",
    text: "That variant and its rates have been deleted.",
  },
  "must-be-inactive": {
    tone: "warn",
    text:
      "This journey became active before that could be saved, so nothing was deleted. Removing a "
      + "variant changes what a booking resolves to, which is not something to do while guests "
      + "can see the journey.",
  },
  "is-default": {
    tone: "warn",
    text:
      "That variant leads the journey and others now remain, so nothing was deleted. Make "
      + "another variant the default first.",
  },
  "has-reservations": {
    tone: "warn",
    text:
      "That variant has been booked, so it cannot be deleted. Bookings are kept as a record of "
      + "what was sold, and this journey has no way to remove them — the variant will stay.",
  },
  gone: {
    tone: "warn",
    text: "That variant was already gone. The journey below has been re-read.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that deletion could not be confirmed. Check the variants below to see "
      + "whether it is still there before trying again.",
  },
} as const;

function VariantDeleteNotice({ notice }: { notice: string | string[] | undefined }) {
  const known =
    typeof notice === "string" && Object.hasOwn(VARIANT_DELETE_NOTICES, notice)
      ? VARIANT_DELETE_NOTICES[notice as keyof typeof VARIANT_DELETE_NOTICES]
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

/** Feedback the content editor left behind, as a fixed token. */
const CONTENT_NOTICES = {
  updated: {
    tone: "done",
    text: "This journey's included, excluded and notes lists have been updated.",
  },
} as const;

/** Feedback the itinerary editor left behind, as a fixed token. */
const ITINERARY_NOTICES = {
  updated: {
    tone: "done",
    text: "This journey's itinerary has been updated.",
  },
} as const;

function ItineraryNotice({ notice }: { notice: string | string[] | undefined }) {
  const known =
    typeof notice === "string" && Object.hasOwn(ITINERARY_NOTICES, notice)
      ? ITINERARY_NOTICES[notice as keyof typeof ITINERARY_NOTICES]
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

function ContentNotice({ notice }: { notice: string | string[] | undefined }) {
  const known =
    typeof notice === "string" && Object.hasOwn(CONTENT_NOTICES, notice)
      ? CONTENT_NOTICES[notice as keyof typeof CONTENT_NOTICES]
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

/** Feedback the journey delete action left behind, as a fixed token. */
const PACKAGE_DELETE_NOTICES = {
  "must-be-inactive": {
    tone: "warn",
    text:
      "This journey became active before that could be saved, so nothing was deleted. "
      + "Deactivate it, check that it is gone from the website, then delete it.",
  },
  "brochure-managed": {
    tone: "warn",
    text:
      "This journey comes from the brochure catalogue, so it cannot be deleted - the catalogue "
      + "seed would simply recreate it under a new record. Deactivating it is the durable way to "
      + "keep it off the public site.",
  },
  "has-reservations": {
    tone: "warn",
    text:
      "This journey has bookings, so it cannot be deleted. Bookings are kept as a record of what "
      + "was sold, and this system has no way to remove them - the journey will stay. It can "
      + "remain deactivated instead.",
  },
  invalid: {
    tone: "warn",
    text: "That address is not a journey address, so nothing was deleted.",
  },
  uncertain: {
    tone: "warn",
    text:
      "The result of that deletion could not be confirmed. Check the catalogue to see whether "
      + "this journey still exists before trying anything else.",
  },
} as const;

function PackageDeleteNotice({ notice }: { notice: string | string[] | undefined }) {
  const known =
    typeof notice === "string" && Object.hasOwn(PACKAGE_DELETE_NOTICES, notice)
      ? PACKAGE_DELETE_NOTICES[notice as keyof typeof PACKAGE_DELETE_NOTICES]
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

/**
 * Feedback the image actions left behind.
 *
 * Unlike the six blocks above, the tokens and their wording are not restated
 * here: they live in `lib/packageImageOutcomes.ts` beside the planner that
 * chooses them, so a notice and the decision to show it cannot drift apart.
 * The value in the URL is still never rendered — it only picks an entry from
 * that closed map, and anything unrecognised shows nothing.
 */
function ImageNotice({ notice }: { notice: string | string[] | undefined }) {
  const token = parsePackageImageNotice(notice);

  if (token === null) {
    return null;
  }

  const known = PACKAGE_IMAGE_NOTICES[token];

  return (
    <p className="adm-notice" data-tone={known.tone} role="status">
      {known.message}
    </p>
  );
}

export default async function AdminJourneyDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const {
    statusAction, defaultVariant, variantOrder, variantDelete, content, itinerary,
    packageDelete, image,
  } = await searchParams;

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await fetchAdminPackage(slug, cookie);

  // The layout confirmed a session before this page ran, so a refusal here
  // means it ended in between. Deliberately outside any try/catch.
  if (result.state === "unauthenticated") {
    redirect("/admin/login");
  }

  // A slug the API refused and one nothing matches are different facts, kept
  // apart in the client and reported to staff the same way: either there is no
  // such journey. Which of the two it was is not theirs to debug.
  if (result.state === "invalid" || result.state === "not-found") {
    notFound();
  }

  if (result.state === "unavailable") {
    return (
      <>
        <PageHeader title="Journey" />
        {/* Not a missing journey: nothing is known about this one. */}
        <section className="adm-panel" aria-labelledby="journey-unavailable-title">
          <div className="adm-panel-head">
            <h2 id="journey-unavailable-title" className="adm-panel-title">
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

  // Composed here rather than inside the view: each one reaches a Server
  // Action, which can only be loaded under the react-server condition, while
  // the submit button inside it is a Client Component that cannot. The
  // component returns null for a variant that may not be promoted, so the
  // map carries an entry only where a control actually belongs.
  // The order the API returned, which is the order the view renders. Every
  // move button is built from this exact list, so a button submits the
  // arrangement this page actually showed.
  const orderedKeys = data.variants.map((variant) => variant.key);

  const variantActions = new Map(
    data.variants.map((variant, index) => [
      variant.key,
      <Fragment key={variant.key}>
        <AdminPackageDefaultVariantAction slug={data.slug} journey={data} variant={variant} />
        <AdminPackageVariantOrderActions
          slug={data.slug}
          orderedKeys={orderedKeys}
          index={index}
        />
        <AdminPackageVariantDeleteAction slug={data.slug} journey={data} variant={variant} />
      </Fragment>,
    ]),
  );

  return (
    <>
      <PageHeader />
      <StatusNotice notice={statusAction} />
      <DefaultVariantNotice notice={defaultVariant} />
      <VariantOrderNotice notice={variantOrder} />
      <VariantDeleteNotice notice={variantDelete} />
      <ContentNotice notice={content} />
      <ItineraryNotice notice={itinerary} />
      <PackageDeleteNotice notice={packageDelete} />
      <ImageNotice notice={image} />
      {/* The page owns the stack, so the danger zone below shares its
          spacing and its detail-page styling rather than trailing after it. */}
      <DetailPage>
        <AdminPackageDetailView
          journey={data}
          actions={<AdminPackageActions slug={data.slug} isActive={data.isActive} />}
          imagePanel={<AdminPackageImagePanel slug={data.slug} image={data.image} />}
          variantActions={variantActions}
        />
        {/* Last on the page, below everything it would destroy. */}
        <AdminPackageDeleteAction journey={data} />
      </DetailPage>
    </>
  );
}

/**
 * The way back, and a heading only where nothing else provides one.
 *
 * On a journey that loaded, the detail view's masthead panel carries the
 * <h1> along with the code, the slug, the badges and the journey-level
 * actions — so the name sits inside the first panel instead of floating
 * above it. The fallback branches have no such panel and keep a heading
 * here, so every state of this route still has exactly one.
 */
function PageHeader({ title }: { title?: string }) {
  return (
    <header className="adm-page-head">
      <p className="adm-detail-back">
        <Link className="adm-topbar-link" href="/admin/journeys">
          Back to journeys
        </Link>
      </p>
      {title ? <h1 className="adm-page-title">{title}</h1> : null}
    </header>
  );
}
