import type { PoolClient } from 'pg';
import { isPackageSlug } from '../packages/packages.validation';
import { toMinorUnits } from './package-reservations.pricing';
import type { PackageReservationInput, PackageReservationPrice, ReservationPackage, ReservationRate, ReservationVariant } from './package-reservations.types';

function invalid(): never { throw new Error('Invalid stored package reservation catalogue data'); }
function text(value: unknown): string { return typeof value === 'string' && value.trim() ? value : invalid(); }
function id(value: unknown): string { return typeof value === 'string' && /^[1-9]\d*(?![\s\S])/.test(value) ? value : invalid(); }
function key(value: unknown): string { return isPackageSlug(value) ? value : invalid(); }
function age(value: unknown): number | null {
  return value === null ? null : typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647 ? value : invalid();
}

export async function findReservationPackage(client: PoolClient, slug: string): Promise<ReservationPackage | null> {
  const { rows } = await client.query<Record<string, unknown>>(`SELECT id, code, slug, title,
    operating_days, requires_price_confirmation FROM packages
    WHERE slug=$1 AND is_active=true FOR SHARE`, [slug]);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (typeof row.requires_price_confirmation !== 'boolean') invalid();
  const days = row.operating_days;
  if (days !== null && (!Array.isArray(days) || days.length === 0 || new Set(days).size !== days.length
    || Array.from(days).some(day => !['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].includes(day)))) invalid();
  return { id: id(row.id), code: text(row.code), slug: key(row.slug), title: text(row.title),
    operatingDays: days as string[] | null, requiresPriceConfirmation: row.requires_price_confirmation };
}

export async function findReservationVariants(client: PoolClient, packageId: string): Promise<ReservationVariant[]> {
  const { rows } = await client.query<Record<string, unknown>>(`SELECT id, key, label, is_default,
    child_min_age, child_max_age, child_discount_percent FROM package_variants
    WHERE package_id=$1 ORDER BY sort_order, key FOR SHARE`, [packageId]);
  return rows.map(row => {
    const min = age(row.child_min_age), max = age(row.child_max_age);
    const discount = row.child_discount_percent;
    if (min !== null || max !== null || discount !== null) {
      if (min === null || max === null || max < min || discount === null || toMinorUnits(discount) > 10000n) invalid();
    }
    if (typeof row.is_default !== 'boolean') invalid();
    return { id: id(row.id), key: key(row.key), label: text(row.label), isDefault: row.is_default,
      childMinAge: min, childMaxAge: max, childDiscountPercent: discount === null ? null : text(discount) };
  });
}

export async function findReservationRate(client: PoolClient, variantId: string, partySize: number): Promise<ReservationRate | null> {
  const { rows } = await client.query<Record<string, unknown>>(`SELECT adult_unit_rate, currency
    FROM package_rate_tiers WHERE variant_id=$1 AND min_party_size<=$2
    AND (max_party_size IS NULL OR max_party_size>=$2) ORDER BY min_party_size FOR SHARE`, [variantId, partySize]);
  if (rows.length === 0) return null;
  if (rows.length !== 1 || rows[0].currency !== 'EGP') invalid();
  const amount = text(rows[0].adult_unit_rate);
  toMinorUnits(amount);
  return { adultUnitRate: amount };
}

export async function insertPackageReservation(
  client: PoolClient, input: PackageReservationInput, pkg: ReservationPackage,
  variant: ReservationVariant, price: PackageReservationPrice, bookingReference: string,
): Promise<void> {
  // Exactly one INSERT, no reference retry, no browser-owned pricing/status.
  const { rows } = await client.query<{ booking_reference: string }>(`INSERT INTO package_reservations (
    booking_reference, package_id, variant_id, tour_date, adults, children, child_ages,
    guest_first_name, guest_last_name, guest_email, guest_phone, guest_country, special_requests,
    status, pricing_status, package_code_snapshot, package_title_snapshot, variant_label_snapshot,
    currency, adult_unit_rate_snapshot, child_unit_rate_snapshot, total_amount_snapshot)
    VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,$15,$16,$17,'EGP',$18,$19,$20)
    RETURNING booking_reference`, [bookingReference, pkg.id, variant.id, input.tourDate, input.adults,
    input.children, input.childAges, input.guestFirstName, input.guestLastName, input.guestEmail,
    input.guestPhone, input.guestCountry, input.specialRequests, price.pricingStatus, pkg.code, pkg.title,
    variant.label, price.adultUnitRate, price.childUnitRate, price.totalAmount]);
  if (rows.length !== 1 || rows[0].booking_reference !== bookingReference) invalid();
}
