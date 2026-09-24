import type {
  PublicPackageCard,
  PublicPackageRate,
  PublicPackageVariant,
} from "@/features/packages/api/contracts";

function minorUnits(value: string): bigint {
  return BigInt(value.replace(".", ""));
}

/**
 * Renders a backend USD decimal string for display, e.g. "420.00" -> "$420.00".
 *
 * The string is never parsed into a number: the backend's exact
 * `numeric(12,2)` value is the source of truth, and grouping is applied to
 * the integer part textually so no floating-point rounding can occur here.
 * `$` matches the currency mark already used across the public site.
 */
export function formatUsdMoney(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // Every caller receives values already validated as `\d+\.\d{2}` by the
  // contract parser; a value without decimals is still rendered sensibly
  // rather than as "$420.undefined".
  return fraction === undefined ? `$${grouped}.00` : `$${grouped}.${fraction}`;
}

export function lowestPackageFrom(packages: PublicPackageCard[]): string | null {
  let lowest: string | null = null;
  for (const pkg of packages) {
    const amount = pkg.pricing.from?.adultUnitRate ?? null;
    if (amount !== null && (lowest === null || minorUnits(amount) < minorUnits(lowest))) lowest = amount;
  }
  return lowest;
}

export function packagePriceSummary(pkg: PublicPackageCard): { primary: string; secondary: string } {
  if (pkg.pricing.from) {
    return {
      primary: `From ${formatUsdMoney(pkg.pricing.from.adultUnitRate)}`,
      secondary: pkg.pricing.status === "requires_confirmation" ? "per person · final price requires confirmation" : "per person",
    };
  }
  return {
    primary: "Price on request",
    secondary: "Final price requires confirmation",
  };
}

export function ratePartyLabel(rate: PublicPackageRate): string {
  if (rate.maxPartySize === null) return `${rate.minPartySize}+ travellers`;
  if (rate.minPartySize === rate.maxPartySize) return `${rate.minPartySize} traveller${rate.minPartySize === 1 ? "" : "s"}`;
  return `${rate.minPartySize}–${rate.maxPartySize} travellers`;
}

export function childRuleLabel(variant: PublicPackageVariant): string | null {
  if (variant.childMinAge === null || variant.childMaxAge === null || variant.childDiscountPercent === null) return null;
  return `Children ages ${variant.childMinAge}–${variant.childMaxAge}: ${variant.childDiscountPercent}% discount`;
}

export function operatingDaysLabel(days: string[] | null): string | null {
  if (!days) return null;
  return days.map((day) => day.charAt(0).toUpperCase() + day.slice(1)).join(", ");
}
