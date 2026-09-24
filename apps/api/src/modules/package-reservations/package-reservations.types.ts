export type PackageReservationInput = {
  packageSlug: string;
  variantKey: string | null;
  tourDate: string;
  adults: number;
  children: number;
  childAges: number[] | null;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
  guestCountry: string;
  specialRequests: string | null;
};

export type ReservationPackage = {
  id: string; code: string; slug: string; title: string;
  operatingDays: string[] | null; requiresPriceConfirmation: boolean;
};
export type ReservationVariant = {
  id: string; key: string; label: string; isDefault: boolean;
  childMinAge: number | null; childMaxAge: number | null; childDiscountPercent: string | null;
};
export type ReservationRate = { adultUnitRate: string };
export type PackageReservationPrice = {
  pricingStatus: 'quoted' | 'requires_confirmation';
  adultUnitRate: string;
  childUnitRate: string | null;
  totalAmount: string | null;
};
export type CreatedPackageReservation = PackageReservationPrice & {
  bookingReference: string;
  status: 'pending';
  package: { code: string; slug: string; title: string };
  variant: { key: string; label: string };
  tourDate: string;
  adults: number;
  children: number;
  currency: 'USD';
};

export class PackageReservationError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'PackageReservationError';
  }
}

export function invalidReservation(message: string): never {
  throw new PackageReservationError('INVALID_PACKAGE_RESERVATION', message);
}

/**
 * `COMMIT` was sent and did not report its outcome.
 *
 * Deliberately its own type rather than a flag on `PackageReservationError`:
 * this is the one condition that must never be confused with a pre-commit
 * failure, and a distinct type makes that confusion a compile-time concern
 * rather than a convention. The reservation may or may not exist; nothing is
 * inferred from it, no `ROLLBACK` follows it — a rollback of an already
 * committed transaction succeeds quietly, so its answer is not evidence —
 * and the commit is never retried.
 *
 * The underlying driver error is carried as `cause` for server-side
 * diagnosis only. It never reaches the response.
 */
export class PackageReservationOutcomeUncertainError extends Error {
  constructor(cause: unknown) {
    super('PostgreSQL COMMIT did not report its outcome', { cause });
    this.name = 'PackageReservationOutcomeUncertainError';
  }
}

export const isPackageReservationOutcomeUncertain = (
  error: unknown,
): error is PackageReservationOutcomeUncertainError =>
  error instanceof PackageReservationOutcomeUncertainError;

export const PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_STATUS = 503;

export const PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_ERROR_CODE =
  'PACKAGE_RESERVATION_OUTCOME_UNCERTAIN';

/**
 * Locked wording. It must never drift, because it is the HTTP face of the
 * uncertain-commit doctrine: the database may or may not have committed the
 * reservation, and nothing here may claim it did, that it did not, or that
 * anything was rolled back. It does not say "created", "failed" or "not
 * created" — none of those is known — and it does not suggest resubmitting.
 */
export const PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_ERROR_MESSAGE =
  'The reservation outcome could not be confirmed. Contact the hotel before submitting another request.';

export const PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_ERROR_CODE,
    message: PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_ERROR_MESSAGE,
  }),
});
