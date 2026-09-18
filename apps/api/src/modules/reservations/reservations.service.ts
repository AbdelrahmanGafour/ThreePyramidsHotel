import { randomInt } from 'node:crypto';
import { dbPool } from '../../db/pool';
import {
  findActiveRoomTypeBySlug,
  findAndLockAvailableRoom,
  insertReservation,
} from './reservations.repository';
import {
  NoAvailabilityError,
  ReservationValidationError,
  RoomTypeNotFoundError,
  type CreatedReservation,
  type ReservationInput,
} from './reservations.types';

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Deliberately modest: catches obvious nonsense without pretending to implement RFC 5322.
const EMAIL_SHAPE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MAX_LENGTHS = {
  roomTypeSlug: 120,
  guestName: 100,
  guestEmail: 254,
  guestPhone: 50,
  guestCountry: 100,
  specialRequests: 2000,
} as const;

/** Values the server owns. A client that sends any of them is rejected rather than quietly ignored. */
const SERVER_CONTROLLED_FIELDS = [
  'roomId',
  'roomNumber',
  'nightlyRate',
  'nightlyRateSnapshot',
  'totalAmount',
  'currency',
  'status',
  'bookingReference',
] as const;

function requireTrimmedString(field: string, value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new ReservationValidationError(`${field} is required`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new ReservationValidationError(`${field} is required`);
  }
  if (trimmed.length > maxLength) {
    throw new ReservationValidationError(`${field} must be ${maxLength} characters or fewer`);
  }

  return trimmed;
}

/**
 * Parses a calendar date as UTC midnight. The round-trip check rejects
 * impossible dates such as 2026-02-30, which `Date` would otherwise roll over
 * into a different day.
 */
function parseCalendarDate(field: string, value: unknown): { value: string; timestamp: number } {
  if (typeof value !== 'string') {
    throw new ReservationValidationError(`${field} is required`);
  }

  const match = CALENDAR_DATE_PATTERN.exec(value);

  if (!match) {
    throw new ReservationValidationError(`${field} must be a date in YYYY-MM-DD format`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new ReservationValidationError(`${field} is not a valid calendar date`);
  }

  return { value, timestamp };
}

/** JSON carries real numbers, so guest counts must arrive as numbers — not "2". */
function parseWholeNumber(field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ReservationValidationError(`${field} must be a whole number`);
  }

  return value;
}

function parseSpecialRequests(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ReservationValidationError('specialRequests must be text');
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_LENGTHS.specialRequests) {
    throw new ReservationValidationError(
      `specialRequests must be ${MAX_LENGTHS.specialRequests} characters or fewer`,
    );
  }

  return trimmed;
}

/**
 * Validates and normalizes a reservation request body. Framework-independent:
 * it takes an unknown value, reads it without mutating it, and throws
 * `ReservationValidationError` on anything unusable.
 *
 * Room capacity is not checked here — that needs the room type from
 * PostgreSQL. Neither is any "date must be in the future" rule.
 */
export function parseReservationInput(body: unknown): ReservationInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ReservationValidationError('Reservation request body must be a JSON object');
  }

  // Only a plain object (or a null-prototype one, as JSON.parse with a reviver
  // can produce) is accepted. A Date, Map, Set or class instance is an object
  // with fields that would not survive a JSON round-trip.
  const prototype = Object.getPrototypeOf(body);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new ReservationValidationError('Reservation request body must be a JSON object');
  }

  const record = body as Record<string, unknown>;

  for (const field of SERVER_CONTROLLED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      throw new ReservationValidationError(`${field} must not be provided; the hotel sets it`);
    }
  }

  const roomTypeSlug = requireTrimmedString('roomTypeSlug', record.roomTypeSlug, MAX_LENGTHS.roomTypeSlug);

  const checkIn = parseCalendarDate('checkIn', record.checkIn);
  const checkOut = parseCalendarDate('checkOut', record.checkOut);

  if (checkOut.timestamp <= checkIn.timestamp) {
    throw new ReservationValidationError('checkOut must be after checkIn');
  }

  const adults = parseWholeNumber('adults', record.adults);

  if (adults < 1) {
    throw new ReservationValidationError('adults must be at least 1');
  }

  const children = record.children === undefined ? 0 : parseWholeNumber('children', record.children);

  // Both parts are safe integers, but their sum can still exceed the safe range.
  if (!Number.isSafeInteger(adults + children)) {
    throw new ReservationValidationError('adults and children together are too large');
  }

  const guestEmail = requireTrimmedString('guestEmail', record.guestEmail, MAX_LENGTHS.guestEmail);

  if (!EMAIL_SHAPE_PATTERN.test(guestEmail)) {
    throw new ReservationValidationError('guestEmail must be a valid email address');
  }

  // Both timestamps are UTC midnight, so this is exact calendar-day arithmetic:
  // no local timezone or daylight-saving shift can move the result.
  const nights = (checkOut.timestamp - checkIn.timestamp) / MS_PER_DAY;

  return {
    roomTypeSlug,
    checkIn: checkIn.value,
    checkOut: checkOut.value,
    adults,
    children,
    nights,
    guestFirstName: requireTrimmedString('guestFirstName', record.guestFirstName, MAX_LENGTHS.guestName),
    guestLastName: requireTrimmedString('guestLastName', record.guestLastName, MAX_LENGTHS.guestName),
    guestEmail: guestEmail.toLowerCase(),
    guestPhone: requireTrimmedString('guestPhone', record.guestPhone, MAX_LENGTHS.guestPhone),
    guestCountry: requireTrimmedString('guestCountry', record.guestCountry, MAX_LENGTHS.guestCountry),
    specialRequests: parseSpecialRequests(record.specialRequests),
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

// Unambiguous when read aloud or written down: no 0/O or 1/I.
const BOOKING_REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const BOOKING_REFERENCE_LENGTH = 12;
const MAX_BOOKING_REFERENCE_ATTEMPTS = 5;
// PostgreSQL exclusion_violation.
const EXCLUSION_VIOLATION_SQLSTATE = '23P01';

/**
 * Server-owned booking reference. `crypto.randomInt` is a CSPRNG and is
 * unbiased across the alphabet — no timestamps, counters or guest data, so a
 * reference can't be guessed from a known booking.
 */
function generateBookingReference(): string {
  let token = '';

  for (let index = 0; index < BOOKING_REFERENCE_LENGTH; index += 1) {
    token += BOOKING_REFERENCE_ALPHABET[randomInt(BOOKING_REFERENCE_ALPHABET.length)];
  }

  return `TPH-${token}`;
}

function isExclusionViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === EXCLUSION_VIOLATION_SQLSTATE
  );
}

/**
 * Creates one pending reservation inside a single transaction: look up the room
 * type, check capacity, lock a free physical room, price the stay server-side
 * and insert.
 *
 * The room-row lock keeps concurrent requests off the same room; the
 * `reservations_no_overlapping_active_stays` exclusion constraint remains the
 * final guarantee, and a violation from it is reported as no availability.
 */
export async function createReservation(body: unknown): Promise<CreatedReservation> {
  const input = parseReservationInput(body);
  const totalGuests = input.adults + input.children;

  const client = await dbPool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const roomType = await findActiveRoomTypeBySlug(client, input.roomTypeSlug);

    if (!roomType) {
      throw new RoomTypeNotFoundError(`Room type not found: ${input.roomTypeSlug}`);
    }

    if (totalGuests > roomType.capacity) {
      throw new ReservationValidationError(
        `The ${roomType.name} sleeps up to ${roomType.capacity} guests, fewer than your party of ${totalGuests}`,
      );
    }

    const room = await findAndLockAvailableRoom(client, {
      roomTypeId: roomType.id,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
    });

    if (!room) {
      throw new NoAvailabilityError('No room of this type is available for those dates');
    }

    const nightlyRateSnapshot = roomType.baseNightlyRate;
    const totalAmount = multiplyMoney(nightlyRateSnapshot, input.nights);

    let bookingReference: string | null = null;

    for (let attempt = 0; attempt < MAX_BOOKING_REFERENCE_ATTEMPTS; attempt += 1) {
      const candidate = generateBookingReference();
      let inserted: { id: string } | null;

      try {
        inserted = await insertReservation(client, {
          bookingReference: candidate,
          roomTypeId: roomType.id,
          roomId: room.id,
          guestFirstName: input.guestFirstName,
          guestLastName: input.guestLastName,
          guestEmail: input.guestEmail,
          guestPhone: input.guestPhone,
          guestCountry: input.guestCountry,
          adults: input.adults,
          children: input.children,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          nightlyRateSnapshot,
          totalAmount,
          specialRequests: input.specialRequests,
        });
      } catch (error) {
        // The locked room was taken for an overlapping stay after all: the
        // database refused it, which is an availability answer, not a bug.
        // Unrelated database errors propagate untouched.
        if (isExclusionViolation(error)) {
          throw new NoAvailabilityError('No room of this type is available for those dates');
        }
        throw error;
      }

      // No row means only one thing here: the conflict target, a duplicate
      // booking reference. The transaction is still usable, so retry.
      if (inserted) {
        bookingReference = candidate;
        break;
      }
    }

    if (!bookingReference) {
      throw new Error(
        `Could not generate a unique booking reference after ${MAX_BOOKING_REFERENCE_ATTEMPTS} attempts`,
      );
    }

    await client.query('COMMIT');
    inTransaction = false;

    return {
      bookingReference,
      status: 'pending',
      roomType: {
        slug: roomType.slug,
        name: roomType.name,
      },
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights: input.nights,
      adults: input.adults,
      children: input.children,
      nightlyRate: nightlyRateSnapshot,
      totalAmount,
      currency: 'EGP',
    };
  } catch (error) {
    // One rollback path for every failure, including a failed COMMIT.
    if (inTransaction) {
      inTransaction = false;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to roll back reservation transaction:', rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}
