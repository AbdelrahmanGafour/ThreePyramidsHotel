import { parseMediaReference } from '../media/media.validation';
import type { PackageCardRecord, PackageDetailRecord, PackageFromPrice, PackageImageRecord, PackageRate, PackageVariant } from './packages.types';

// Treat driver results as unknown. A malformed row is a server/data failure,
// never a zero price, coerced boolean, empty catalogue or public 404.
function invalid(): never { throw new Error('Invalid package catalogue row'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : invalid();
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function integer(value: unknown, minimum = 1): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= 2147483647 ? value : invalid();
}
function decimal(value: unknown): string {
  return typeof value === 'string' && /^(?:0|[1-9]\d{0,9})\.\d{2}(?![\s\S])/.test(value) ? value : invalid();
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? Array.from(value) : invalid(); }
function key(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/.test(value) ? value : invalid();
}
function currency(value: unknown): 'USD' { return value === 'USD' ? 'USD' : invalid(); }
// Alt text exactly as the column admits it: any text, or nothing. Deliberately
// not `nullableText`, which refuses a whitespace-only string — the application
// never stores one, but the schema permits it and a legal row must not 500.
function altText(value: unknown): string | null {
  return value === null ? null : typeof value === 'string' ? value : invalid();
}
// The journey's one image, or nothing. Fail-closed like every other mapper
// here: a malformed media row is this system's own data being wrong, and it
// surfaces rather than being coerced into `image: null`, which would look
// exactly like a journey that simply has no picture.
//
// The reference is checked by the shared media parser, not by a second copy
// of that rule — it is the same canonical form the object key is built from,
// and anything else was never issued by this system.
function image(value: unknown): PackageImageRecord | null {
  if (value === null) return null;
  const row = record(value);
  const reference = parseMediaReference(row.reference);
  if (reference === null) invalid();
  return { reference, altText: altText(row.alt_text), width: integer(row.width), height: integer(row.height) };
}
function rate(value: unknown): PackageRate {
  const row = record(value);
  const minPartySize = integer(row.min_party_size);
  const maxPartySize = row.max_party_size === null ? null : integer(row.max_party_size);
  if (maxPartySize !== null && maxPartySize < minPartySize) invalid();
  return { minPartySize, maxPartySize, adultUnitRate: decimal(row.adult_unit_rate), currency: currency(row.currency) };
}
function fromRate(value: unknown): PackageFromPrice | null {
  if (value === null) return null;
  const row = record(value);
  const mapped = rate(row);
  return { adultUnitRate: mapped.adultUnitRate, variantKey: key(row.variant_key),
    minPartySize: mapped.minPartySize, maxPartySize: mapped.maxPartySize };
}

export function mapPackageCardRow(value: unknown): PackageCardRecord {
  const row = record(value);
  const operatingDays = row.operating_days === null ? null : array(row.operating_days).map(text);
  if (operatingDays !== null && (operatingDays.length === 0
    || new Set(operatingDays).size !== operatingDays.length
    || operatingDays.some(day => !['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].includes(day)))) invalid();
  return {
    code: text(row.code), slug: key(row.slug), title: text(row.title), summary: nullableText(row.summary),
    durationLabel: nullableText(row.duration_label), scheduleLabel: nullableText(row.schedule_label),
    operatingDays, currency: 'USD', requiresPriceConfirmation: bool(row.requires_price_confirmation),
    fromRate: fromRate(row.from_rate), image: image(row.image),
  };
}

function variant(value: unknown): PackageVariant {
  const row = record(value);
  const childMinAge = row.child_min_age === null ? null : integer(row.child_min_age, 0);
  const childMaxAge = row.child_max_age === null ? null : integer(row.child_max_age, 0);
  const childDiscountPercent = row.child_discount_percent === null ? null : decimal(row.child_discount_percent);
  if ([childMinAge, childMaxAge, childDiscountPercent].some(value => value !== null)) {
    if (childMinAge === null || childMaxAge === null || childDiscountPercent === null
      || childMaxAge < childMinAge || BigInt(childDiscountPercent.replace('.', '')) > 10000n) invalid();
  }
  return { key: key(row.key), label: text(row.label), isDefault: bool(row.is_default),
    childMinAge, childMaxAge, childDiscountPercent, rates: array(row.rates).map(rate) };
}

export function mapPackageDetailRow(value: unknown): PackageDetailRecord {
  const row = record(value);
  const content = { included: [] as string[], excluded: [] as string[], notes: [] as string[] };
  for (const value of array(row.content)) {
    const item = record(value);
    if (item.kind !== 'included' && item.kind !== 'excluded' && item.kind !== 'note') invalid();
    content[item.kind === 'note' ? 'notes' : item.kind].push(text(item.text));
  }
  return {
    ...mapPackageCardRow(row), description: nullableText(row.description),
    itinerary: array(row.itinerary).map(value => {
      const section = record(value);
      return { dayNumber: section.day_number === null ? null : integer(section.day_number),
        heading: nullableText(section.heading), body: text(section.body) };
    }),
    included: content.included, excluded: content.excluded, notes: content.notes,
    variants: array(row.variants).map(variant),
  };
}
