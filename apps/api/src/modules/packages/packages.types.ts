export type PackageFromPrice = {
  adultUnitRate: string;
  variantKey: string;
  minPartySize: number;
  maxPartySize: number | null;
};

export type PackagePricing = {
  status: 'from' | 'requires_confirmation' | 'unavailable';
  unit: 'per_person';
  // Adult rate, not a party quote. Party size counts adults + children.
  from: PackageFromPrice | null;
};

export type PackageCard = {
  code: string;
  slug: string;
  title: string;
  summary: string | null;
  durationLabel: string | null;
  scheduleLabel: string | null;
  operatingDays: string[] | null;
  currency: 'EGP';
  requiresPriceConfirmation: boolean;
  pricing: PackagePricing;
};

export type PackageRate = {
  minPartySize: number;
  maxPartySize: number | null;
  adultUnitRate: string;
  currency: 'EGP';
};

export type PackageVariant = {
  key: string;
  label: string;
  isDefault: boolean;
  childMinAge: number | null;
  childMaxAge: number | null;
  childDiscountPercent: string | null;
  rates: PackageRate[];
};

export type PackageDetail = PackageCard & {
  description: string | null;
  itinerary: { dayNumber: number | null; heading: string | null; body: string }[];
  included: string[];
  excluded: string[];
  notes: string[];
  variants: PackageVariant[];
};

// Repository records contain only mapped catalogue fields, never database IDs.
export type PackageCardRecord = Omit<PackageCard, 'pricing'> & { fromRate: PackageFromPrice | null };
export type PackageDetailRecord = PackageCardRecord & Omit<PackageDetail, keyof PackageCard>;

export class InvalidPackageSlugError extends Error {
  readonly code = 'INVALID_PACKAGE_SLUG';
  constructor() { super('Package slug must be 1–120 lowercase letters, digits or single separating hyphens'); }
}

export class PackageNotFoundError extends Error {
  readonly code = 'PACKAGE_NOT_FOUND';
  constructor() { super('Package not found'); }
}
