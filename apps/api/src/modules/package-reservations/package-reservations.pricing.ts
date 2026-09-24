import {
  invalidReservation, PackageReservationError, type PackageReservationInput, type PackageReservationPrice,
  type ReservationPackage, type ReservationVariant,
} from './package-reservations.types';

const MAX_MINOR_UNITS = 999999999999n; // numeric(12,2)

export function toMinorUnits(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,9})\.\d{2}(?![\s\S])/.test(value)) {
    throw new Error('Invalid stored package monetary value');
  }
  return BigInt(value.replace('.', ''));
}

function money(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

export function validateOperatingDay(pkg: ReservationPackage, tourDate: string): void {
  if (pkg.operatingDays === null) return; // Free-text/manual schedules impose no invented weekday rule.
  const day = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(`${tourDate}T00:00:00Z`).getUTCDay()];
  if (!pkg.operatingDays.includes(day)) {
    throw new PackageReservationError('PACKAGE_OPERATING_DAY_MISMATCH', 'Package does not operate on the selected day');
  }
}

export function selectVariant(variants: ReservationVariant[], key: string | null): ReservationVariant {
  if (key !== null) {
    const variant = variants.find(item => item.key === key);
    if (!variant) throw new PackageReservationError('PACKAGE_VARIANT_NOT_FOUND', 'Package variant not found', 404);
    return variant;
  }
  if (variants.length === 0) throw new PackageReservationError('PACKAGE_VARIANT_UNAVAILABLE', 'Package has no reservable variant', 409);
  if (variants.length === 1) return variants[0];
  const defaults = variants.filter(item => item.isDefault);
  if (defaults.length === 1) return defaults[0];
  throw new PackageReservationError('PACKAGE_VARIANT_REQUIRED', 'Select a package variant');
}

export function calculatePackagePrice(
  input: PackageReservationInput, pkg: ReservationPackage, variant: ReservationVariant, adultUnitRate: string,
): PackageReservationPrice {
  const adultMinor = toMinorUnits(adultUnitRate);
  const hasChildRule = variant.childMinAge !== null && variant.childMaxAge !== null && variant.childDiscountPercent !== null;
  if (input.childAges !== null && !hasChildRule) {
    invalidReservation('childAges must not be supplied when the variant has no age-based pricing rule');
  }
  let childMinor: bigint | null = null;
  if (input.children > 0 && hasChildRule && input.childAges !== null
    && input.childAges.every(age => age >= variant.childMinAge! && age <= variant.childMaxAge!)) {
    const discountHundredths = toMinorUnits(variant.childDiscountPercent);
    if (discountHundredths > 10000n) throw new Error('Invalid stored child discount');
    // Round each child's unit price half-up to one piastre, then multiply.
    // This keeps the total consistent with the stored rounded child unit rate.
    childMinor = (adultMinor * (10000n - discountHundredths) + 5000n) / 10000n;
  }
  const uncertain = pkg.requiresPriceConfirmation || (input.children > 0 && childMinor === null);
  const total = uncertain ? null : adultMinor * BigInt(input.adults) + (childMinor ?? 0n) * BigInt(input.children);
  if (total !== null && total > MAX_MINOR_UNITS) {
    throw new PackageReservationError('PACKAGE_TOTAL_OUT_OF_RANGE', 'Party total exceeds the supported reservation amount', 409);
  }
  return {
    pricingStatus: uncertain ? 'requires_confirmation' : 'quoted', adultUnitRate,
    childUnitRate: childMinor === null ? null : money(childMinor), totalAmount: total === null ? null : money(total),
  };
}
