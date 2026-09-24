import {
  parsePackageReservationResponse,
  parsePublicApiError,
  type PackageReservationConfirmation,
} from "./contracts";

export type PackageReservationRequest = {
  packageSlug: string;
  variantKey?: string;
  tourDate: string;
  adults: number;
  children: number;
  childAges?: number[];
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
  guestCountry: string;
  specialRequests?: string;
};

export type PackageReservationRefusalCode =
  | "INVALID_JSON"
  | "INVALID_PACKAGE_RESERVATION"
  | "PACKAGE_VARIANT_REQUIRED"
  | "PACKAGE_OPERATING_DAY_MISMATCH"
  | "PACKAGE_NOT_FOUND"
  | "PACKAGE_VARIANT_NOT_FOUND"
  | "PACKAGE_VARIANT_UNAVAILABLE"
  | "PACKAGE_RATE_UNAVAILABLE"
  | "PACKAGE_TOTAL_OUT_OF_RANGE";

export type PackageReservationOutcome =
  | { kind: "success"; confirmation: PackageReservationConfirmation }
  | {
      kind: "refused";
      status: 400 | 404 | 409;
      error: { code: PackageReservationRefusalCode; message: string };
    }
  | { kind: "uncertain" };

const RESERVATION_PATH = "/api/v1/package-reservations";

function knownRefusalCode(status: number, code: string): PackageReservationRefusalCode | null {
  if (status === 400) {
    if (
      code === "INVALID_JSON" ||
      code === "INVALID_PACKAGE_RESERVATION" ||
      code === "PACKAGE_VARIANT_REQUIRED" ||
      code === "PACKAGE_OPERATING_DAY_MISMATCH"
    ) {
      return code;
    }
  }
  if (status === 404 && (code === "PACKAGE_NOT_FOUND" || code === "PACKAGE_VARIANT_NOT_FOUND")) {
    return code;
  }
  if (
    status === 409 &&
    (code === "PACKAGE_VARIANT_UNAVAILABLE" ||
      code === "PACKAGE_RATE_UNAVAILABLE" ||
      code === "PACKAGE_TOTAL_OUT_OF_RANGE")
  ) {
    return code;
  }
  return null;
}

export async function submitPackageReservation(
  input: PackageReservationRequest,
  request: typeof fetch = fetch,
): Promise<PackageReservationOutcome> {
  let response: Response;

  try {
    response = await request(RESERVATION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { kind: "uncertain" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "uncertain" };
  }

  if (response.status === 201) {
    try {
      return { kind: "success", confirmation: parsePackageReservationResponse(body).data };
    } catch {
      return { kind: "uncertain" };
    }
  }

  if (response.status === 400 || response.status === 404 || response.status === 409) {
    try {
      const error = parsePublicApiError(body).error;
      const code = knownRefusalCode(response.status, error.code);
      if (code !== null) {
        return { kind: "refused", status: response.status, error: { code, message: error.message } };
      }
    } catch {
      // A malformed known-status payload is not proof that the request was refused.
    }
    return { kind: "uncertain" };
  }

  // 5xx means PostgreSQL may have committed before the response was lost.
  // Other unexpected statuses are also not safe to call a definite refusal.
  return { kind: "uncertain" };
}
