import { findRoomTypeAvailability } from './availability.repository';
import {
  AvailabilityQueryError,
  type AvailabilityInput,
  type AvailabilityResponse,
} from './availability.types';

// Exactly four-digit year, two-digit month, two-digit day — nothing else.
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Digits only: rejects "2abc", "2.5", "-1", "1e3", " 2" and "" up front, which
// Number() would otherwise coerce into something surprising.
const WHOLE_NUMBER_PATTERN = /^\d+$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type AvailabilityQuery = {
  checkIn?: unknown;
  checkOut?: unknown;
  adults?: unknown;
  children?: unknown;
};

/** Query values arrive as strings; arrays (`?adults=1&adults=2`) are never silently accepted. */
function requireScalarString(field: string, value: unknown): string {
  if (value === undefined || value === null) {
    throw new AvailabilityQueryError(`${field} is required`);
  }
  if (Array.isArray(value)) {
    throw new AvailabilityQueryError(`${field} must be a single value`);
  }
  if (typeof value !== 'string') {
    throw new AvailabilityQueryError(`${field} must be a single value`);
  }

  return value;
}

/**
 * Parses a calendar date as UTC midnight. The round-trip check rejects
 * impossible dates such as 2026-02-30 and 2026-13-01, which `Date` would
 * otherwise roll over into a different day.
 */
function parseCalendarDate(field: string, value: unknown): { value: string; timestamp: number } {
  const raw = requireScalarString(field, value);
  const match = CALENDAR_DATE_PATTERN.exec(raw);

  if (!match) {
    throw new AvailabilityQueryError(`${field} must be a date in YYYY-MM-DD format`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new AvailabilityQueryError(`${field} is not a valid calendar date`);
  }

  return { value: raw, timestamp };
}

function parseWholeNumber(field: string, value: unknown): number {
  const raw = requireScalarString(field, value);

  if (!WHOLE_NUMBER_PATTERN.test(raw)) {
    throw new AvailabilityQueryError(`${field} must be a whole number`);
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed)) {
    throw new AvailabilityQueryError(`${field} must be a whole number`);
  }

  return parsed;
}

/**
 * Validates and normalizes an availability query. Framework-independent: it
 * takes plain values, reads without mutating them, and throws
 * `AvailabilityQueryError` on anything unusable.
 *
 * Guest capacity against a room type is not checked here — that belongs to the
 * availability query itself. Neither is any "date must be in the future" rule.
 */
export function parseAvailabilityQuery(query: AvailabilityQuery): AvailabilityInput {
  const checkIn = parseCalendarDate('checkIn', query.checkIn);
  const checkOut = parseCalendarDate('checkOut', query.checkOut);

  if (checkOut.timestamp <= checkIn.timestamp) {
    throw new AvailabilityQueryError('checkOut must be after checkIn');
  }

  const adults = parseWholeNumber('adults', query.adults);

  if (adults < 1) {
    throw new AvailabilityQueryError('adults must be at least 1');
  }

  const children = query.children === undefined ? 0 : parseWholeNumber('children', query.children);

  // Both timestamps are UTC midnight, so this is exact calendar-day arithmetic:
  // no local timezone or daylight-saving shift can move the result.
  const nights = (checkOut.timestamp - checkIn.timestamp) / MS_PER_DAY;

  return {
    checkIn: checkIn.value,
    checkOut: checkOut.value,
    adults,
    children,
    nights,
  };
}

// Money is handled as exact integer minor units (piastres) — never as floats,
// which cannot represent values like 999.99 exactly.
const MONEY_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

function toMinorUnits(amount: string): bigint {
  const match = MONEY_PATTERN.exec(amount.trim());

  if (!match) {
    // A stored rate that isn't two-decimal money is a data problem, not a bad
    // request, so this propagates as a server error rather than a 400.
    throw new Error(`Unexpected monetary value from the database: ${amount}`);
  }

  const [, sign, whole, fraction = ''] = match;
  const minorUnits = BigInt(`${whole}${fraction.padEnd(2, '0')}`);

  return sign === '-' ? -minorUnits : minorUnits;
}

function fromMinorUnits(minorUnits: bigint): string {
  const negative = minorUnits < 0n;
  const absolute = negative ? -minorUnits : minorUnits;

  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

/** `"999.99" × 3 -> "2999.97"`, exactly. */
function multiplyMoney(amount: string, factor: number): string {
  return fromMinorUnits(toMinorUnits(amount) * BigInt(factor));
}

/**
 * Validates the query, asks PostgreSQL for live availability, and composes the
 * API response. Sold-out room types are kept: a room type with
 * `availableRoomCount: 0` is a meaningful answer, not something to hide.
 *
 * Unexpected repository/database errors are not caught here — they propagate.
 */
export async function getAvailability(query: AvailabilityQuery): Promise<AvailabilityResponse> {
  const { checkIn, checkOut, adults, children, nights } = parseAvailabilityQuery(query);
  const totalGuests = adults + children;

  // Both parts are safe integers, but their sum can still exceed the safe range.
  if (!Number.isSafeInteger(totalGuests)) {
    throw new AvailabilityQueryError('adults and children together are too large');
  }

  const roomTypes = await findRoomTypeAvailability({ checkIn, checkOut, totalGuests });

  return {
    data: {
      checkIn,
      checkOut,
      nights,
      adults,
      children,
      roomTypes: roomTypes.map((roomType) => ({
        slug: roomType.slug,
        name: roomType.name,
        capacity: roomType.capacity,
        baseNightlyRate: roomType.baseNightlyRate,
        totalAmount: multiplyMoney(roomType.baseNightlyRate, nights),
        currency: 'EGP',
        availableRoomCount: roomType.availableRoomCount,
      })),
    },
  };
}
