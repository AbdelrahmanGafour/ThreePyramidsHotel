export type PublicPackageFromPrice = {
  adultUnitRate: string;
  variantKey: string;
  minPartySize: number;
  maxPartySize: number | null;
};

export type PublicPackagePricing = {
  status: "from" | "requires_confirmation" | "unavailable";
  unit: "per_person";
  from: PublicPackageFromPrice | null;
};

export type PublicPackageCard = {
  code: string;
  slug: string;
  title: string;
  summary: string | null;
  durationLabel: string | null;
  scheduleLabel: string | null;
  operatingDays: string[] | null;
  currency: "USD";
  requiresPriceConfirmation: boolean;
  pricing: PublicPackagePricing;
};

export type PublicPackageRate = {
  minPartySize: number;
  maxPartySize: number | null;
  adultUnitRate: string;
  currency: "USD";
};

export type PublicPackageVariant = {
  key: string;
  label: string;
  isDefault: boolean;
  childMinAge: number | null;
  childMaxAge: number | null;
  childDiscountPercent: string | null;
  rates: PublicPackageRate[];
};

export type PublicPackageDetail = PublicPackageCard & {
  description: string | null;
  itinerary: Array<{ dayNumber: number | null; heading: string | null; body: string }>;
  included: string[];
  excluded: string[];
  notes: string[];
  variants: PublicPackageVariant[];
};

export type PackageReservationConfirmation = {
  bookingReference: string;
  status: "pending";
  package: { code: string; slug: string; title: string };
  variant: { key: string; label: string };
  tourDate: string;
  adults: number;
  children: number;
  pricingStatus: "quoted" | "requires_confirmation";
  currency: "USD";
  adultUnitRate: string;
  childUnitRate: string | null;
  totalAmount: string | null;
};

export type PublicApiError = { error: { code: string; message: string } };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MONEY = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BOOKING_REFERENCE = /^TPP-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;
const WEEKDAYS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

function invalid(message: string): never {
  throw new Error(`Invalid public packages API response: ${message}`);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("expected object");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid("unexpected response fields");
  }
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") invalid("expected nonblank text");
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid("expected boolean");
  return value;
}

function integer(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) invalid("expected integer");
  return value;
}

function nullableInteger(value: unknown, minimum = 0): number | null {
  return value === null ? null : integer(value, minimum);
}

function slug(value: unknown): string {
  const result = text(value);
  if (result.length > 120 || !SLUG.test(result)) invalid("invalid slug");
  return result;
}

function money(value: unknown): string {
  if (typeof value !== "string" || !MONEY.test(value)) invalid("invalid money value");
  return value;
}

function moneyMinorUnits(value: string): bigint {
  return BigInt(value.replace(".", ""));
}

function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !DATE.test(value)) invalid("invalid tour date");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    invalid("invalid tour date");
  }
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) invalid("expected string array");
  return value.map(text);
}

function operatingDays(value: unknown): string[] | null {
  if (value === null) return null;
  const days = stringArray(value);
  if (days.length === 0 || new Set(days).size !== days.length || days.some((day) => !WEEKDAYS.has(day))) {
    invalid("invalid operating days");
  }
  return days;
}

function fromPrice(value: unknown): PublicPackageFromPrice | null {
  if (value === null) return null;
  const row = object(value);
  exactKeys(row, ["adultUnitRate", "variantKey", "minPartySize", "maxPartySize"]);
  const minPartySize = integer(row.minPartySize, 1);
  const maxPartySize = nullableInteger(row.maxPartySize, 1);
  if (maxPartySize !== null && maxPartySize < minPartySize) invalid("invalid from-price party bounds");
  return {
    adultUnitRate: money(row.adultUnitRate),
    variantKey: slug(row.variantKey),
    minPartySize,
    maxPartySize,
  };
}

function pricing(value: unknown): PublicPackagePricing {
  const row = object(value);
  exactKeys(row, ["status", "unit", "from"]);
  if (row.status !== "from" && row.status !== "requires_confirmation" && row.status !== "unavailable") {
    invalid("invalid pricing status");
  }
  if (row.unit !== "per_person") invalid("invalid pricing unit");
  const from = fromPrice(row.from);
  if (row.status === "from" && from === null) invalid("from pricing requires a source rate");
  if (row.status === "unavailable" && from !== null) invalid("unavailable pricing cannot have a source rate");
  return { status: row.status, unit: row.unit, from };
}

const CARD_KEYS = [
  "code",
  "slug",
  "title",
  "summary",
  "durationLabel",
  "scheduleLabel",
  "operatingDays",
  "currency",
  "requiresPriceConfirmation",
  "pricing",
] as const;

function packageCard(value: unknown): PublicPackageCard {
  const row = object(value);
  exactKeys(row, CARD_KEYS);
  if (row.currency !== "USD") invalid("invalid package currency");
  return {
    code: text(row.code),
    slug: slug(row.slug),
    title: text(row.title),
    summary: nullableText(row.summary),
    durationLabel: nullableText(row.durationLabel),
    scheduleLabel: nullableText(row.scheduleLabel),
    operatingDays: operatingDays(row.operatingDays),
    currency: "USD",
    requiresPriceConfirmation: boolean(row.requiresPriceConfirmation),
    pricing: pricing(row.pricing),
  };
}

function rate(value: unknown): PublicPackageRate {
  const row = object(value);
  exactKeys(row, ["minPartySize", "maxPartySize", "adultUnitRate", "currency"]);
  const minPartySize = integer(row.minPartySize, 1);
  const maxPartySize = nullableInteger(row.maxPartySize, 1);
  if (maxPartySize !== null && maxPartySize < minPartySize) invalid("invalid rate bounds");
  if (row.currency !== "USD") invalid("invalid rate currency");
  return { minPartySize, maxPartySize, adultUnitRate: money(row.adultUnitRate), currency: "USD" };
}

function variant(value: unknown): PublicPackageVariant {
  const row = object(value);
  exactKeys(row, [
    "key",
    "label",
    "isDefault",
    "childMinAge",
    "childMaxAge",
    "childDiscountPercent",
    "rates",
  ]);
  const childMinAge = nullableInteger(row.childMinAge);
  const childMaxAge = nullableInteger(row.childMaxAge);
  const childDiscountPercent = row.childDiscountPercent === null ? null : money(row.childDiscountPercent);
  const hasAnyChildRule = childMinAge !== null || childMaxAge !== null || childDiscountPercent !== null;
  if (hasAnyChildRule) {
    if (childMinAge === null || childMaxAge === null || childDiscountPercent === null || childMaxAge < childMinAge) {
      invalid("incomplete child pricing rule");
    }
    if (BigInt(childDiscountPercent.replace(".", "")) > 10000n) invalid("invalid child discount");
  }
  if (!Array.isArray(row.rates)) invalid("expected rates array");
  return {
    key: slug(row.key),
    label: text(row.label),
    isDefault: boolean(row.isDefault),
    childMinAge,
    childMaxAge,
    childDiscountPercent,
    rates: row.rates.map(rate),
  };
}

export function parsePackageListResponse(value: unknown): { data: PublicPackageCard[] } {
  const row = object(value);
  exactKeys(row, ["data"]);
  if (!Array.isArray(row.data)) invalid("expected package list");
  return { data: row.data.map(packageCard) };
}

export function parsePackageDetailResponse(value: unknown): { data: PublicPackageDetail } {
  const envelope = object(value);
  exactKeys(envelope, ["data"]);
  const row = object(envelope.data);
  exactKeys(row, [...CARD_KEYS, "description", "itinerary", "included", "excluded", "notes", "variants"]);
  const cardInput: Record<string, unknown> = {};
  for (const key of CARD_KEYS) cardInput[key] = row[key];
  const card = packageCard(cardInput);
  if (!Array.isArray(row.itinerary)) invalid("expected itinerary array");
  if (!Array.isArray(row.variants)) invalid("expected variants array");
  return {
    data: {
      ...card,
      description: nullableText(row.description),
      itinerary: row.itinerary.map((item) => {
        const section = object(item);
        exactKeys(section, ["dayNumber", "heading", "body"]);
        return {
          dayNumber: nullableInteger(section.dayNumber, 1),
          heading: nullableText(section.heading),
          body: text(section.body),
        };
      }),
      included: stringArray(row.included),
      excluded: stringArray(row.excluded),
      notes: stringArray(row.notes),
      variants: row.variants.map(variant),
    },
  };
}

export function parsePackageReservationResponse(value: unknown): { data: PackageReservationConfirmation } {
  const envelope = object(value);
  exactKeys(envelope, ["data"]);
  const row = object(envelope.data);
  exactKeys(row, [
    "bookingReference",
    "status",
    "package",
    "variant",
    "tourDate",
    "adults",
    "children",
    "pricingStatus",
    "currency",
    "adultUnitRate",
    "childUnitRate",
    "totalAmount",
  ]);
  if (typeof row.bookingReference !== "string" || !BOOKING_REFERENCE.test(row.bookingReference)) {
    invalid("invalid booking reference");
  }
  if (row.status !== "pending") invalid("invalid reservation status");
  if (row.pricingStatus !== "quoted" && row.pricingStatus !== "requires_confirmation") {
    invalid("invalid reservation pricing status");
  }
  if (row.currency !== "USD") invalid("invalid reservation currency");
  const tourDate = calendarDate(row.tourDate);

  const packageRow = object(row.package);
  exactKeys(packageRow, ["code", "slug", "title"]);
  const variantRow = object(row.variant);
  exactKeys(variantRow, ["key", "label"]);
  const adults = integer(row.adults, 1);
  const children = integer(row.children);
  const adultUnitRate = money(row.adultUnitRate);
  const childUnitRate = row.childUnitRate === null ? null : money(row.childUnitRate);
  const totalAmount = row.totalAmount === null ? null : money(row.totalAmount);

  if (children === 0 && childUnitRate !== null) invalid("child rate present without children");
  if (row.pricingStatus === "quoted") {
    if (totalAmount === null) invalid("quoted reservation requires total");
    if (children > 0 && childUnitRate === null) invalid("quoted children require child rate");
    const expected =
      moneyMinorUnits(adultUnitRate) * BigInt(adults) +
      (childUnitRate === null ? 0n : moneyMinorUnits(childUnitRate) * BigInt(children));
    if (moneyMinorUnits(totalAmount) !== expected) invalid("reservation total is inconsistent");
  }
  if (row.pricingStatus === "requires_confirmation" && totalAmount !== null) {
    invalid("confirmation-required reservation cannot guarantee total");
  }

  return {
    data: {
      bookingReference: row.bookingReference,
      status: "pending",
      package: { code: text(packageRow.code), slug: slug(packageRow.slug), title: text(packageRow.title) },
      variant: { key: slug(variantRow.key), label: text(variantRow.label) },
      tourDate,
      adults,
      children,
      pricingStatus: row.pricingStatus,
      currency: "USD",
      adultUnitRate,
      childUnitRate,
      totalAmount,
    },
  };
}

export function parsePublicApiError(value: unknown): PublicApiError {
  const envelope = object(value);
  exactKeys(envelope, ["error"]);
  const error = object(envelope.error);
  exactKeys(error, ["code", "message"]);
  return { error: { code: text(error.code), message: text(error.message) } };
}
