import { isPackageSlug } from '../packages/packages.validation';
import { invalidReservation, type PackageReservationInput } from './package-reservations.types';

const ALLOWED = new Set(['packageSlug','variantKey','tourDate','adults','children','childAges',
  'guestFirstName','guestLastName','guestEmail','guestPhone','guestCountry','specialRequests']);

function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    return invalidReservation(`${name} must be nonblank text of at most ${max} characters`);
  }
  return value.trim();
}

function count(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > 2147483647) {
    return invalidReservation(`${name} must be an integer between ${minimum} and 2147483647`);
  }
  return value;
}

export function cairoCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  return ['year','month','day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function parsePackageReservationInput(body: unknown, today = cairoCalendarDate()): PackageReservationInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || (Object.getPrototypeOf(body) !== Object.prototype && Object.getPrototypeOf(body) !== null)) {
    return invalidReservation('Reservation body must be an object');
  }
  // Whitelist, rather than a blacklist of currently known server-owned fields.
  for (const key of Reflect.ownKeys(body)) {
    if (typeof key !== 'string' || !ALLOWED.has(key)) invalidReservation('Unknown reservation field');
  }
  const row = body as Record<string, unknown>;
  if (!isPackageSlug(row.packageSlug)) invalidReservation('packageSlug must be a valid package slug');
  if (row.variantKey !== undefined && !isPackageSlug(row.variantKey)) invalidReservation('variantKey must be a valid variant key');
  const date = row.tourDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}(?![\s\S])/.test(date)
    || date.startsWith('0000')) invalidReservation('tourDate must be a valid YYYY-MM-DD date');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    invalidReservation('tourDate must be a valid calendar date');
  }
  if (date < today) invalidReservation('tourDate must be today or later in Egypt');
  const adults = count(row.adults, 'adults', 1);
  const children = row.children === undefined ? 0 : count(row.children, 'children');
  if (adults + children > 2147483647) invalidReservation('Party size is too large');
  let childAges: number[] | null = null;
  if (row.childAges !== undefined) {
    if (!Array.isArray(row.childAges) || children === 0 || row.childAges.length !== children) {
      invalidReservation('childAges must contain exactly one age per child');
    }
    childAges = Array.from(row.childAges).map(age => count(age, 'child age'));
  }
  const guestEmail = requiredText(row.guestEmail, 'guestEmail', 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) invalidReservation('guestEmail must be a valid email address');
  let specialRequests: string | null = null;
  if (row.specialRequests !== undefined && row.specialRequests !== null) {
    if (typeof row.specialRequests !== 'string' || row.specialRequests.trim().length > 2000) {
      invalidReservation('specialRequests must be text of at most 2000 characters');
    }
    specialRequests = row.specialRequests.trim() || null;
  }
  return {
    packageSlug: row.packageSlug, variantKey: row.variantKey === undefined ? null : row.variantKey as string,
    tourDate: date, adults, children, childAges,
    guestFirstName: requiredText(row.guestFirstName, 'guestFirstName', 100),
    guestLastName: requiredText(row.guestLastName, 'guestLastName', 100), guestEmail: guestEmail.toLowerCase(),
    guestPhone: requiredText(row.guestPhone, 'guestPhone', 50),
    guestCountry: requiredText(row.guestCountry, 'guestCountry', 100), specialRequests,
  };
}
