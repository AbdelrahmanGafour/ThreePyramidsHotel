"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { reservationDetailHref, RESERVATIONS_PATH } from "../lib/reservationsWindow";
import type { AdminReservationStatusTarget } from "../types";
import { updateAdminReservationStatus } from "./adminReservationsApi";

// The one way the administration UI changes a reservation's status.
//
// It runs on the server and calls Express directly through the server-only
// mutation client, so the browser never learns the API's address and never
// holds a session token. The form that triggers it posts to Next, not to the
// API.
//
// It decides nothing about whether a transition is allowed: the backend holds
// that policy, and this action reports what it answered. The buttons a page
// renders are hints from a status that may already be seconds out of date.

/** Display hints this action may hand back to the page. Never anything else. */
export type ReservationStatusNotice = "updated" | "conflict" | "uncertain" | "invalid";

const STATUS_TARGETS: readonly AdminReservationStatusTarget[] = ["confirmed", "cancelled"];

function noticeHref(bookingReference: string, notice: ReservationStatusNotice): string {
  // The reference stays one encoded path segment; the notice is a fixed token
  // from the union above, never caller text.
  return `${reservationDetailHref(bookingReference)}?statusAction=${notice}`;
}

/**
 * Re-reads both places this reservation appears, so whatever the page shows
 * next comes from the database rather than from a cached copy taken before the
 * change.
 */
function revalidateReservation(bookingReference: string): void {
  revalidatePath(reservationDetailHref(bookingReference));
  revalidatePath(RESERVATIONS_PATH);
}

/**
 * Confirms or cancels one reservation.
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
 */
export async function updateReservationStatusAction(
  bookingReference: string,
  status: AdminReservationStatusTarget,
): Promise<void> {
  // Treated as untrusted despite the types above.
  if (typeof bookingReference !== "string" || bookingReference.length === 0) {
    redirect(RESERVATIONS_PATH);
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
  const result = await updateAdminReservationStatus(bookingReference, target, cookie);

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
      // The stale-page case: someone else moved this reservation first. Both
      // views are re-read so the page that comes back shows what is true now,
      // and the notice explains why the button did nothing.
      revalidateReservation(bookingReference);
      redirect(noticeHref(bookingReference, "conflict"));

    case "invalid-reference":
    case "not-found":
      // Either there is no such reservation or its reference is not one. The
      // detail page decides how that reads — it renders the route-local
      // not-found — rather than this action inventing a state for it.
      revalidatePath(RESERVATIONS_PATH);
      redirect(reservationDetailHref(bookingReference));

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
