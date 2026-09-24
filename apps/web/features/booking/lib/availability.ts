// Browser-side availability domain module (WFI-T04). Calls the same-origin
// Next bridge (/api/v1/availability) via lib/api/client.ts — never Express
// directly, never API_BASE_URL. Mirrors the exact backend contract
// (apps/api/src/modules/availability/availability.types.ts). Money fields
// (`baseNightlyRate`, `totalAmount`) are kept as the backend's exact decimal
// strings and never converted to numbers here.

import { requestJson } from "@/lib/api/client";

export type AvailabilityRoomType = {
  slug: string;
  name: string;
  capacity: number;
  baseNightlyRate: string;
  totalAmount: string;
  currency: "EGP";
  availableRoomCount: number;
};

type AvailabilityResponseBody = {
  data: {
    checkIn: string;
    checkOut: string;
    nights: number;
    adults: number;
    children: number;
    roomTypes: AvailabilityRoomType[];
  };
};

type AvailabilityErrorBody = {
  error: { code: string; message: string };
};

export type AvailabilityResult =
  | { ok: true; data: AvailabilityResponseBody["data"] }
  | { ok: false; code: string | null; message: string };

// Matches the backend's own money-string pattern (see
// apps/web/features/rooms/api.ts's identical check for room data). Shape
// check only — never used to parse baseNightlyRate/totalAmount into numbers.
const DECIMAL_STRING_PATTERN = /^-?\d+(?:\.\d{1,2})?$/;

function isFiniteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function isRoomType(value: unknown): value is AvailabilityRoomType {
  if (typeof value !== "object" || value === null) return false;
  const room = value as Record<string, unknown>;

  return (
    typeof room.slug === "string" &&
    typeof room.name === "string" &&
    isFiniteInt(room.capacity) &&
    room.capacity > 0 &&
    typeof room.baseNightlyRate === "string" &&
    DECIMAL_STRING_PATTERN.test(room.baseNightlyRate) &&
    typeof room.totalAmount === "string" &&
    DECIMAL_STRING_PATTERN.test(room.totalAmount) &&
    room.currency === "EGP" &&
    isFiniteInt(room.availableRoomCount) &&
    room.availableRoomCount >= 0
  );
}

function isAvailabilityResponseBody(value: unknown): value is AvailabilityResponseBody {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return false;

  const candidate = data as Record<string, unknown>;

  return (
    typeof candidate.checkIn === "string" &&
    typeof candidate.checkOut === "string" &&
    isFiniteInt(candidate.nights) &&
    candidate.nights > 0 &&
    isFiniteInt(candidate.adults) &&
    candidate.adults >= 1 &&
    isFiniteInt(candidate.children) &&
    candidate.children >= 0 &&
    Array.isArray(candidate.roomTypes) &&
    candidate.roomTypes.every(isRoomType)
  );
}

function isAvailabilityErrorBody(value: unknown): value is AvailabilityErrorBody {
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

export async function searchAvailability(params: {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}): Promise<AvailabilityResult> {
  const query = new URLSearchParams({
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    adults: String(params.adults),
    children: String(params.children),
  });

  let response;
  try {
    response = await requestJson<unknown>(`/api/v1/availability?${query.toString()}`);
  } catch {
    return { ok: false, code: null, message: "Availability could not be reached." };
  }

  if (response.status === 200 && isAvailabilityResponseBody(response.body)) {
    return { ok: true, data: response.body.data };
  }

  if (isAvailabilityErrorBody(response.body)) {
    return { ok: false, code: response.body.error.code, message: response.body.error.message };
  }

  return { ok: false, code: null, message: "Availability returned an unexpected response." };
}
