// Browser-side reservation-submission domain module (WFI-T07). Calls the
// same-origin Next bridge (/api/v1/reservations) via lib/api/client.ts —
// never Express directly, never API_BASE_URL. Mirrors the exact backend
// contract (apps/api/src/modules/reservations/reservations.types.ts).
// Money fields (`nightlyRate`, `totalAmount`) are kept as the backend's
// exact decimal strings and never converted to numbers here. The backend
// transaction is authoritative — response validation (reservationContract.ts)
// only guards against treating malformed/unusable data as a successful
// reservation; it never fabricates a reference, status, price, or room.

import { requestJson, type ClientResponse } from "@/lib/api/client";
import { isCreatedReservation, type CreatedReservation } from "@/features/booking/lib/reservationContract";

export type { CreatedReservation };

/** Exactly the approved request contract — never a server-controlled field. */
export type ReservationRequestInput = {
  roomTypeSlug: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
  guestCountry: string;
  /** Raw guest input; trimmed here, and omitted from the request entirely when empty. */
  specialRequests: string;
};

/** The three known backend domain rejections — see reservations.controller.ts. */
export type ReservationRefusalCode = "INVALID_RESERVATION" | "ROOM_TYPE_NOT_FOUND" | "NO_AVAILABILITY";

/**
 * The outcome of a submission attempt, as an explicit three-way union:
 *
 * - `success`: a structurally valid backend 201. Safe to show a confirmation.
 * - `refused`: a KNOWN backend domain rejection (400/INVALID_RESERVATION,
 *   404/ROOM_TYPE_NOT_FOUND, 409/NO_AVAILABILITY). The guest can correct and
 *   resubmit — no room or reservation was consumed.
 * - `uncertain`: everything else (network failure, 5xx, malformed body,
 *   malformed 201, unexpected status, unrecognized error code). The client
 *   cannot prove whether PostgreSQL committed the reservation, so this is
 *   never treated as "failed" and must never trigger an automatic retry —
 *   retrying could create a duplicate reservation and consume another room.
 *
 * Deliberately not flattened into `{ ok: false; code: null }` — `uncertain`
 * and `refused` require different UI treatment and must not be conflated.
 */
export type SubmitReservationResult =
  | { outcome: "success"; data: CreatedReservation }
  | { outcome: "refused"; code: ReservationRefusalCode; message: string }
  | { outcome: "uncertain"; message: string };

/** Required meaning per the uncertain-outcome contract — callers should not invent their own wording. */
export const UNCERTAIN_RESERVATION_MESSAGE =
  "We could not confirm whether your reservation was created. Please contact the hotel before submitting another reservation.";

type BackendErrorBody = { error: { code: string; message: string } };

function isBackendErrorBody(value: unknown): value is BackendErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "object" &&
    (value as { error: { code?: unknown } | null }).error !== null &&
    typeof (value as { error: { code?: unknown } }).error.code === "string" &&
    typeof (value as { error: { message?: unknown } }).error.message === "string"
  );
}

/**
 * A refusal is only "known" when its error code arrives on the exact HTTP
 * status the controller uses for it (reservations.controller.ts). A
 * recognized code on the wrong status, or any other code, is not something
 * this client can trust as a genuine domain rejection.
 */
function toKnownRefusal(status: number, code: string): ReservationRefusalCode | null {
  if (status === 400 && code === "INVALID_RESERVATION") return "INVALID_RESERVATION";
  if (status === 404 && code === "ROOM_TYPE_NOT_FOUND") return "ROOM_TYPE_NOT_FOUND";
  if (status === 409 && code === "NO_AVAILABILITY") return "NO_AVAILABILITY";
  return null;
}

/**
 * Pure classifier for an already-received HTTP response — no network, no
 * timers. Exported so the three-outcome decision can be unit-tested without
 * mocking `fetch`. `submitReservation` is the only caller in production code.
 */
export function classifyReservationResponse(response: ClientResponse<unknown>): SubmitReservationResult {
  if (response.status === 201) {
    const payload = response.body as { data?: unknown } | null;
    if (payload && isCreatedReservation(payload.data)) {
      return { outcome: "success", data: payload.data };
    }
    // A malformed/unreadable 201 body: PostgreSQL may well have committed —
    // this is unproven, not a failure.
    return { outcome: "uncertain", message: UNCERTAIN_RESERVATION_MESSAGE };
  }

  if (isBackendErrorBody(response.body)) {
    const refusal = toKnownRefusal(response.status, response.body.error.code);
    if (refusal) {
      return { outcome: "refused", code: refusal, message: response.body.error.message };
    }
  }

  // 5xx, an unexpected status, an unrecognized error code, or a body that
  // isn't the known error shape — none of these prove the request was
  // rejected before any commit, so all of them stay uncertain.
  return { outcome: "uncertain", message: UNCERTAIN_RESERVATION_MESSAGE };
}

/**
 * POST /api/v1/reservations, through the shared same-origin browser
 * transport. Performs at most one request per call — callers own any
 * in-flight/duplicate-submit guard, and MUST NOT call this again
 * automatically after an `uncertain` result.
 */
export async function submitReservation(input: ReservationRequestInput): Promise<SubmitReservationResult> {
  const specialRequests = input.specialRequests.trim();

  const body: Record<string, unknown> = {
    roomTypeSlug: input.roomTypeSlug,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults: input.adults,
    children: input.children,
    guestFirstName: input.guestFirstName,
    guestLastName: input.guestLastName,
    guestEmail: input.guestEmail,
    guestPhone: input.guestPhone,
    guestCountry: input.guestCountry,
  };
  if (specialRequests.length > 0) {
    body.specialRequests = specialRequests;
  }

  let response: ClientResponse<unknown>;
  try {
    response = await requestJson<unknown>("/api/v1/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // fetch rejected outright: network failure, connection dropped, etc. The
    // request may or may not have reached the server, let alone committed.
    return { outcome: "uncertain", message: UNCERTAIN_RESERVATION_MESSAGE };
  }

  return classifyReservationResponse(response);
}
