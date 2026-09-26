import { formatUsd } from "./format";
import type {
  AdminPackageReservationStatus,
  AdminPackageReservationStatusTarget,
} from "../types";

// The words the package reservation screens use for things that are absent,
// and the one place the detail route is spelled.
//
// Shared by the list and the detail view so the two can never describe the
// same reservation differently — a total that reads "To be confirmed" in the
// list and something else on the page it links to would be the same fact
// told twice, inconsistently.

/** A total the hotel has not quoted yet. Never `0`, never blank. */
export const TOTAL_TO_BE_CONFIRMED = "To be confirmed";

/** A figure that does not apply to this booking at all, such as a child rate with no children. */
export const NOT_APPLICABLE = "Not applicable";

/** Something the guest did not provide, or that was never needed. */
export const NOT_RECORDED = "Not recorded";

/** An optional free-text field the guest left empty. */
export const NONE = "None";

/** The list route, re-read whenever a reservation on it changes. */
export const PACKAGE_RESERVATIONS_PATH = "/admin/package-reservations";

export const packageReservationDetailHref = (bookingReference: string) =>
  `/admin/package-reservations/${encodeURIComponent(bookingReference)}`;

/**
 * The total, or the reason there isn't one.
 *
 * `null` is a real answer from the API — a confirmation-required reservation
 * genuinely has no total yet — so it is named rather than defaulted.
 * Rendering it as "USD 0.00" would state a price the hotel never quoted.
 *
 * The stored snapshot is formatted and nothing more. No figure is derived
 * here: the total was settled when the reservation was taken, and the API
 * already guarantees it agrees with the unit rates.
 */
export function packageTotalLabel(totalAmountSnapshot: string | null): string {
  return totalAmountSnapshot === null ? TOTAL_TO_BE_CONFIRMED : formatUsd(totalAmountSnapshot);
}

/**
 * The child unit rate, or why there is none.
 *
 * Two different absences, told apart: a booking with no children has no child
 * rate to state, while one awaiting a quote has a rate that is simply not
 * settled yet. Collapsing both into one phrase would lose that.
 */
export function packageChildRateLabel(
  childUnitRateSnapshot: string | null,
  children: number,
): string {
  if (childUnitRateSnapshot !== null) {
    return formatUsd(childUnitRateSnapshot);
  }

  return children === 0 ? NOT_APPLICABLE : TOTAL_TO_BE_CONFIRMED;
}

/**
 * The children's ages, or why none are listed.
 *
 * Ages are stored only when exact child pricing needed them, so their absence
 * on a booking that does have children is "not recorded" rather than an
 * error — and is never filled in with a guess.
 */
export function packageChildAgesLabel(childAges: number[] | null, children: number): string {
  if (children === 0) {
    return NOT_APPLICABLE;
  }

  if (childAges === null || childAges.length === 0) {
    return NOT_RECORDED;
  }

  return childAges.join(", ");
}

/** "2 adults, 1 child" — singular where it should be, children only when there are any. */
export function packagePartyLabel(adults: number, children: number): string {
  const adultPart = `${adults} adult${adults === 1 ? "" : "s"}`;

  if (children === 0) {
    return adultPart;
  }

  return `${adultPart}, ${children} child${children === 1 ? "" : "ren"}`;
}

/** One control the actions panel may offer. */
export type PackageStatusAction = {
  target: AdminPackageReservationStatusTarget;
  tone: "confirm" | "cancel";
  label: string;
  pendingLabel: string;
};

/**
 * Which controls are worth offering for a reservation in this state.
 *
 * Presentation only, and deliberately pure so it can be tested without a
 * server action in the module graph. The one authoritative transition policy
 * lives in the API, which re-checks every move under a row lock: this decides
 * what to show, never what is allowed. A button rendered from a status that
 * has since changed is refused there, not here.
 *
 * Packages are stricter than room reservations. Only a pending request can
 * move at all — `confirmed` and `cancelled` are both terminal — so neither
 * offers a control.
 */
export function packageStatusActions(
  status: AdminPackageReservationStatus,
): PackageStatusAction[] {
  if (status !== "pending") {
    return [];
  }

  return [
    { target: "confirmed", tone: "confirm", label: "Confirm request", pendingLabel: "Confirming…" },
    { target: "cancelled", tone: "cancel", label: "Cancel request", pendingLabel: "Cancelling…" },
  ];
}

/**
 * Why a decided request offers nothing to do, or null while it still does.
 *
 * Stated per terminal status rather than as one sentence, because the two are
 * different situations: a confirmed journey is settled, a cancelled one is
 * closed. Neither message hints at a refund or a payment step, because no such
 * workflow exists.
 */
export function packageTerminalNote(status: AdminPackageReservationStatus): string | null {
  if (status === "confirmed") {
    return (
      "This request is confirmed. Any further change is arranged with the guest directly, " +
      "outside the booking system."
    );
  }

  if (status === "cancelled") {
    return "This request is cancelled and cannot be reopened. Taking the guest back means a new request.";
  }

  return null;
}
