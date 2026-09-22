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
  currency: 'EGP';
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
