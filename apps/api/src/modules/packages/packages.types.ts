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

/**
 * The one image a journey may have, as a guest is allowed to see it.
 *
 * Four fields, and deliberately no more. The media reference, the object
 * key, the checksum, the content type, the byte size and both database ids
 * are all absent: none of them helps a browser display an image, and the
 * reference in particular stays internal — it is what the URL is composed
 * FROM, not something a guest is given.
 *
 * `url` is composed when this is built, never read from a column; no URL is
 * stored anywhere in the schema. `width` and `height` are the stored
 * object's own dimensions, so a page can reserve the right space without
 * downloading the image first. `altText` is nullable because a decorative
 * image is a real case.
 *
 * One type, shared by the card and the detail, because a journey has one
 * image and it looks the same wherever it is shown.
 */
export type PackageImage = {
  url: string;
  altText: string | null;
  width: number;
  height: number;
};

export type PackageCard = {
  code: string;
  slug: string;
  title: string;
  summary: string | null;
  durationLabel: string | null;
  scheduleLabel: string | null;
  operatingDays: string[] | null;
  currency: 'USD';
  requiresPriceConfirmation: boolean;
  pricing: PackagePricing;
  /**
   * The journey's image, or `null` when none has been uploaded.
   *
   * Always present as a key, so a consumer never has to tell "no image"
   * apart from "this response predates images". Never a placeholder: the
   * API's answer is the truth about what is stored, and what a website shows
   * in its absence is that website's decision.
   */
  image: PackageImage | null;
};

export type PackageRate = {
  minPartySize: number;
  maxPartySize: number | null;
  adultUnitRate: string;
  currency: 'USD';
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

/**
 * The image as the repository reads it: identity, not address.
 *
 * The difference from `PackageImage` is `reference` in place of `url`.
 * Composing a URL needs the deployment's public media base, which is
 * configuration the repository has no business reading — so the reference
 * travels this far and no further, and the service turns it into a URL.
 */
export type PackageImageRecord = {
  reference: string;
  altText: string | null;
  width: number;
  height: number;
};

// Repository records contain only mapped catalogue fields, never database IDs.
// `image` is omitted from the card it is derived from and restated as the
// record form: the row carries a reference, and the response carries a URL.
export type PackageCardRecord = Omit<PackageCard, 'pricing' | 'image'> & {
  fromRate: PackageFromPrice | null;
  image: PackageImageRecord | null;
};
export type PackageDetailRecord = PackageCardRecord & Omit<PackageDetail, keyof PackageCard>;

export class InvalidPackageSlugError extends Error {
  readonly code = 'INVALID_PACKAGE_SLUG';
  constructor() { super('Package slug must be 1–120 lowercase letters, digits or single separating hyphens'); }
}

export class PackageNotFoundError extends Error {
  readonly code = 'PACKAGE_NOT_FOUND';
  constructor() { super('Package not found'); }
}
