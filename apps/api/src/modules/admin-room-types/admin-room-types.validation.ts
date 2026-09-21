import {
  InvalidRoomTypeSlugError,
  InvalidRoomTypeUpdateError,
  type AdminRoomTypeUpdate,
} from './admin-room-types.types';

/**
 * Lowercase kebab-case, the shape every slug in this system actually has
 * (`demo-standard`, `room-concept-01`): lowercase letters and digits in
 * hyphen-separated groups, with no leading, trailing or doubled hyphen.
 *
 * Anchored and exact. Nothing is trimmed or lower-cased first: a slug is a
 * public identifier matched exactly and case-sensitively in SQL, so a value
 * that needs tidying is not the value the database holds. `Demo-Standard` and
 * ` demo-standard ` are therefore refused rather than repaired.
 *
 * This also makes the parameter safe by construction — no slash, dot, percent
 * or quote can appear — though the queries behind it are parameterised anyway.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Matches the reservation module's own limit for the same identifier. */
const MAX_SLUG_LENGTH = 120;

/**
 * Application-level maxima. The columns are unbounded `text`, so these are a
 * deliberate choice rather than a schema fact: a name is a label, not an
 * essay, and an unbounded admin field is a denial-of-service surface and a
 * layout problem in equal measure. `description` matches the reservation
 * module's `specialRequests` ceiling, the longest free text this system
 * already accepts.
 */
const MAX_LENGTHS = {
  name: 120,
  shortDescription: 300,
  description: 2000,
  bedType: 60,
  view: 120,
} as const;

/**
 * `numeric(12,2)`: up to ten digits before the point and two after. Unsigned —
 * a negative rate is not a price, and the column's own CHECK forbids it.
 */
const BASE_NIGHTLY_RATE_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

/**
 * `numeric(6,2)`: up to four digits before the point and two after. Unsigned
 * for the same reason, and the column's CHECK requires it to be positive.
 */
const SIZE_SQM_PATTERN = /^\d{1,4}(?:\.\d{1,2})?$/;

/** A decimal string carrying at least one non-zero digit, so "0.00" is not positive. */
const HAS_NON_ZERO_DIGIT = /[1-9]/;

/** Exactly the keys this endpoint accepts; anything else makes the body invalid. */
const EDITABLE_KEYS = [
  'name',
  'shortDescription',
  'description',
  'bedType',
  'bedCount',
  'sizeSqm',
  'view',
  'baseNightlyRate',
  'sortOrder',
] as const;

type EditableKey = (typeof EDITABLE_KEYS)[number];

function isEditableKey(key: string): key is EditableKey {
  return (EDITABLE_KEYS as readonly string[]).includes(key);
}

/**
 * Validates a room-type slug used as a route parameter.
 *
 * Returns it unchanged, so a caller cannot accidentally use the raw parameter
 * in place of the validated one.
 */
export function parseRoomTypeSlugParam(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(value)) {
    throw new InvalidRoomTypeSlugError();
  }

  return value;
}

/**
 * Required text: trimmed, then required to still say something.
 *
 * Trimming is part of the stored contract here — a name with a stray space at
 * either end is the same name — but a value that is *only* whitespace was
 * never a name at all.
 */
function parseRequiredText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new InvalidRoomTypeUpdateError();
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new InvalidRoomTypeUpdateError();
  }

  return trimmed;
}

/**
 * Optional text: a string or an explicit null.
 *
 * An empty or whitespace-only string becomes null. The column is nullable and
 * these fields are descriptions — "" and "absent" mean the same thing to every
 * reader, and storing both would leave the public API returning two different
 * values for one state.
 */
function parseOptionalText(value: unknown, maxLength: number): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new InvalidRoomTypeUpdateError();
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new InvalidRoomTypeUpdateError();
  }

  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A decimal kept as a string all the way to PostgreSQL.
 *
 * Deliberately never parsed with `Number`: the point of a `numeric` column is
 * that 1234.55 is exactly 1234.55, and routing it through a float to check its
 * range would be the one place that stops being true. The pattern bounds the
 * digits on each side of the point, which is the precision and scale check;
 * `minimum` is then a question about digits, not arithmetic.
 *
 * A number supplied where a decimal string belongs is refused rather than
 * stringified — accepting `1234.55` as a JavaScript number would mean the
 * value had already been through a float before this function ever saw it.
 */
function parseDecimalString(
  value: unknown,
  pattern: RegExp,
  minimum: 'zero' | 'positive',
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new InvalidRoomTypeUpdateError();
  }

  if (minimum === 'positive' && !HAS_NON_ZERO_DIGIT.test(value)) {
    throw new InvalidRoomTypeUpdateError();
  }

  return value;
}

function parseCount(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new InvalidRoomTypeUpdateError();
  }

  return value;
}

/**
 * Validates a partial room-type update.
 *
 * Only the nine editable fields are accepted. Any other key — an unknown one,
 * or a read-only/server-controlled one like `slug`, `capacity` or `isActive` —
 * makes the whole body invalid rather than being quietly dropped: a caller who
 * believed they were changing the slug must be told they were not, and the
 * request that says so is the only chance to tell them.
 *
 * A body that changes nothing is refused too. An empty PATCH is a request that
 * misunderstood something, and answering it with "done" would hide that.
 *
 * Returns a clean object carrying only the supplied editable fields, so a
 * caller can never reach past it to the raw body.
 */
export function parseAdminRoomTypeUpdate(body: unknown): AdminRoomTypeUpdate {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidRoomTypeUpdateError();
  }

  // Only a plain object (or a null-prototype one, as JSON.parse with a reviver
  // can produce). A Date, Map or class instance is an object whose fields
  // would not survive a JSON round-trip.
  const prototype = Object.getPrototypeOf(body);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidRoomTypeUpdateError();
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);

  if (keys.length === 0) {
    throw new InvalidRoomTypeUpdateError();
  }

  for (const key of keys) {
    if (!isEditableKey(key)) {
      throw new InvalidRoomTypeUpdateError();
    }
  }

  const update: AdminRoomTypeUpdate = {};

  // `in` rather than a truthiness check: an explicit null is a value being
  // set, and must not be mistaken for a field nobody mentioned.
  if ('name' in record) {
    update.name = parseRequiredText(record.name, MAX_LENGTHS.name);
  }
  if ('shortDescription' in record) {
    update.shortDescription = parseOptionalText(record.shortDescription, MAX_LENGTHS.shortDescription);
  }
  if ('description' in record) {
    update.description = parseOptionalText(record.description, MAX_LENGTHS.description);
  }
  if ('bedType' in record) {
    update.bedType = parseOptionalText(record.bedType, MAX_LENGTHS.bedType);
  }
  if ('bedCount' in record) {
    update.bedCount = record.bedCount === null ? null : parseCount(record.bedCount, 1);
  }
  if ('sizeSqm' in record) {
    update.sizeSqm =
      record.sizeSqm === null ? null : parseDecimalString(record.sizeSqm, SIZE_SQM_PATTERN, 'positive');
  }
  if ('view' in record) {
    update.view = parseOptionalText(record.view, MAX_LENGTHS.view);
  }
  if ('baseNightlyRate' in record) {
    update.baseNightlyRate = parseDecimalString(record.baseNightlyRate, BASE_NIGHTLY_RATE_PATTERN, 'zero');
  }
  if ('sortOrder' in record) {
    update.sortOrder = parseCount(record.sortOrder, 0);
  }

  return update;
}
