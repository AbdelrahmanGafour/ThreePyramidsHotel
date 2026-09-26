"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  PACKAGE_RESERVATIONS_PATH,
  packageReservationDetailHref,
} from "../lib/packageReservations";
import type { AdminPackageReservationStatusTarget } from "../types";
import { updateAdminPackageReservationStatus } from "./adminPackageReservationsApi";

// The one way the administration UI changes a package reservation's status.
//
// It runs on the server and calls Express directly through the server-only
// mutation client, so the browser never learns the API's address and never
// holds a session token. The form that triggers it posts to Next, not to the
// API.
//
// It decides nothing about whether a transition is allowed: the backend holds
// that policy and enforces it under a row lock. The buttons a page renders are
// hints from a status that may already be seconds out of date.

/** Display hints this action may hand back to the page. Never anything else. */
export type PackageReservationStatusNotice = "updated" | "conflict" | "uncertain" | "invalid";

const STATUS_TARGETS: readonly AdminPackageReservationStatusTarget[] = ["confirmed", "cancelled"];

function noticeHref(bookingReference: string, notice: PackageReservationStatusNotice): string {
  // The reference stays one encoded path segment; the notice is a fixed token
  // from the union above, never caller text.
  return `${packageReservationDetailHref(bookingReference)}?statusAction=${notice}`;
}

/**
 * Re-reads both places this reservation appears, so whatever the page shows
 * next comes from the database rather than from a cached copy taken before the
 * change.
 */
function revalidateReservation(bookingReference: string): void {
  revalidatePath(packageReservationDetailHref(bookingReference));
  revalidatePath(PACKAGE_RESERVATIONS_PATH);
}

/**
 * Confirms or cancels one package reservation.
 *
 * Bound per form to a reference and a target the server itself rendered, but
 * both arguments are still checked here: a Server Action is a public endpoint,
 * and a narrow TypeScript type is a compile-time promise that says nothing
 * about what actually arrives over the wire.
 *
 * Neither value is normalised. The target must be exactly one of the two the
 * API accepts, and the reference is passed through untouched — the API owns
 * what a booking reference is.
 *
 * Every path ends in a redirect back to the reservation, so the status on
 * screen is always freshly read rather than assumed from what was asked for.
 * The updated reservation the API returns is deliberately not rendered from
 * here: re-reading is one code path instead of two, and it cannot show a
 * status that disagrees with what the next reader would see.
 *
 * Nothing about pricing is sent, returned or touched. This action changes one
 * column and knows about no other.
 */
export async function updatePackageReservationStatusAction(
  bookingReference: string,
  status: AdminPackageReservationStatusTarget,
): Promise<void> {
  // Treated as untrusted despite the types above.
  if (typeof bookingReference !== "string" || bookingReference.length === 0) {
    redirect(PACKAGE_RESERVATIONS_PATH);
  }

  // find(), not includes(): it returns the matched literal, so the value handed
  // on is narrowed rather than asserted.
  const target = STATUS_TARGETS.find((candidate) => candidate === status);

  if (!target) {
    redirect(noticeHref(bookingReference, "invalid"));
  }

  // The browser's own Cookie header, forwarded verbatim: this app never parses
  // it and never decides whether the session is valid.
  const cookie = (await headers()).get("cookie") ?? undefined;
  const result = await updateAdminPackageReservationStatus(bookingReference, target, cookie);

  // redirect() works by throwing, so every branch below is deliberately outside
  // any try/catch.
  switch (result.state) {
    case "ok":
      revalidateReservation(bookingReference);
      redirect(noticeHref(bookingReference, "updated"));

    case "unauthenticated":
      // The session ended between the page rendering and the button being
      // pressed. Nothing changed.
      redirect("/admin/login");

    case "invalid-transition":
      // The stale-page case: this reservation is already terminal, or someone
      // else moved it first. Both views are re-read so the page that comes
      // back shows what is true now, and the notice explains why the button
      // did nothing. Nothing was altered.
      revalidateReservation(bookingReference);
      redirect(noticeHref(bookingReference, "conflict"));

    case "invalid-reference":
    case "not-found":
      // Either there is no such reservation or its reference is not one. The
      // detail page decides how that reads — it renders the route-local
      // not-found — rather than this action inventing a state for it.
      revalidatePath(PACKAGE_RESERVATIONS_PATH);
      redirect(packageReservationDetailHref(bookingReference));

    case "invalid-status":
      // Unreachable from this app's own fixed forms, since the target was
      // checked above. Treated as a failed action, never as a success.
      redirect(noticeHref(bookingReference, "invalid"));

    case "unavailable":
      // Deliberately not reported as a failure. A mutation whose connection
      // dropped may well have committed first, so the only honest answer is
      // that the outcome is unknown — and the refreshed page is the place to
      // find out. Never retried automatically.
      revalidateReservation(bookingReference);
      redirect(noticeHref(bookingReference, "uncertain"));
  }
}
