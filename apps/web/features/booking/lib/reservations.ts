// Browser-side reservation-submission domain module (WFI-T07). Calls the
// same-origin Next bridge (/api/v1/reservations) via lib/api/client.ts —
// never Express directly, never API_BASE_URL. Mirrors the exact backend
// contract (apps/api/src/modules/reservations/reservations.types.ts).
// Money fields (`nightlyRate`, `totalAmount`) are kept as the backend's
// exact decimal strings and never converted to numbers here. The backend
// transaction is authoritative — this module validates the response shape
// only enough to avoid treating malformed/unusable data as a successful
// reservation; it never fabricates a reference, status, price, or room.

import { requestJson } from "@/lib/api/client";

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

/** Mirrors apps/api/src/modules/reservations/reservations.types.ts's CreatedReservation exactly. */
export type CreatedReservation = {
  bookingReference: string;
  status: "pending";
  roomType: { slug: string; name: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  /** Backend's exact decimal string — never parsed to a number. */
  nightlyRate: string;
  /** Backend's exact decimal string — never parsed to a number. */
  totalAmount: string;
  currency: "EGP";
};

/** The three domain error codes the backend can return; `null` covers everything else (network/5xx/malformed). */
export type ReservationErrorCode = "INVALID_RESERVATION" | "ROOM_TYPE_NOT_FOUND" | "NO_AVAILABILITY" | null;

export type SubmitReservationResult =
  | { ok: true; data: CreatedReservation }
  | { ok: false; code: ReservationErrorCode; message: string };

const DECIMAL_STRING_PATTERN = /^-?\d+(?:\.\d{1,2})?$/;

function isFiniteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function isCreatedReservation(value: unknown): value is CreatedReservation {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const roomType = r.roomType as Record<string, unknown> | null | undefined;

  return (
    typeof r.bookingReference === "string" &&
    r.bookingReference.length > 0 &&
    r.status === "pending" &&
    typeof roomType === "object" &&
    roomType !== null &&
    typeof roomType.slug === "string" &&
    typeof roomType.name === "string" &&
    typeof r.checkIn === "string" &&
    typeof r.checkOut === "string" &&
    isFiniteInt(r.nights) &&
    (r.nights as number) > 0 &&
    isFiniteInt(r.adults) &&
    (r.adults as number) >= 1 &&
    isFiniteInt(r.children) &&
    (r.children as number) >= 0 &&
    typeof r.nightlyRate === "string" &&
    DECIMAL_STRING_PATTERN.test(r.nightlyRate) &&
    typeof r.totalAmount === "string" &&
    DECIMAL_STRING_PATTERN.test(r.totalAmount) &&
    r.currency === "EGP"
  );
}

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

function toKnownErrorCode(code: string): ReservationErrorCode {
  return code === "INVALID_RESERVATION" || code === "ROOM_TYPE_NOT_FOUND" || code === "NO_AVAILABILITY" ? code : null;
}

/** POST /api/v1/reservations, through the shared same-origin browser transport. Called at most once per invocation — callers own any in-flight/duplicate-submit guard. */
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

  let response;
  try {
    response = await requestJson<unknown>("/api/v1/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: null, message: "The reservation could not be submitted. Please try again." };
  }

  if (response.status === 201) {
    const payload = response.body as { data?: unknown } | null;
    if (payload && isCreatedReservation(payload.data)) {
      return { ok: true, data: payload.data };
    }
    return { ok: false, code: null, message: "The reservation response could not be understood. Please try again." };
  }

  if (isBackendErrorBody(response.body)) {
    return { ok: false, code: toKnownErrorCode(response.body.error.code), message: response.body.error.message };
  }

  return { ok: false, code: null, message: "The reservation could not be submitted. Please try again." };
}
