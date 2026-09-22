import type {
  PublicPackageCard,
  PublicPackageRate,
  PublicPackageVariant,
} from "@/features/packages/api/contracts";

function minorUnits(value: string): bigint {
  return BigInt(value.replace(".", ""));
}

export function formatEgp(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `EGP ${grouped}.${fraction}`;
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
      primary: `From ${formatEgp(pkg.pricing.from.adultUnitRate)}`,
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
