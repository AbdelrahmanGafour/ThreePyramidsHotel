/**
 * The room-type field contracts, in one place.
 *
 * Extracted when creation and capacity editing joined the existing partial
 * update: three entry points now read the same fields, and three copies of
 * "a name is trimmed text of at most 120 characters" would be three things to
 * keep in step. What a room-type field *is* is decided here; which fields a
 * given request may carry, and which locked error it raises, stays with each
 * parser.
 *
 * Every helper throws `FieldError` — a marker with no message worth reading.
 * Each public parser catches it and raises its own contract error instead, so
 * nothing from this file reaches a caller. Naming the offending field would
 * map the model for whoever asked.
 *
 * Pure: no database, no Express, no I/O.
 */

/** Internal. Never leaves the validation layer, never reaches HTTP. */
export class FieldError extends Error {
  constructor() {
    super('Invalid room type field');
    this.name = 'FieldError';
  }
}

function fail(): never {
  throw new FieldError();
}

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
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Matches the reservation module's own limit for the same identifier. */
export const MAX_SLUG_LENGTH = 120;

/**
 * Application-level maxima. The columns are unbounded `text`, so these are a
 * deliberate choice rather than a schema fact: a name is a label, not an
 * essay, and an unbounded admin field is a denial-of-service surface and a
 * layout problem in equal measure. `description` matches the reservation
 * module's `specialRequests` ceiling, the longest free text this system
 * already accepts.
 */
export const MAX_LENGTHS = {
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
export const BASE_NIGHTLY_RATE_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

/**
 * `numeric(6,2)`: up to four digits before the point and two after. Unsigned
 * for the same reason, and the column's CHECK requires it to be positive.
 */
export const SIZE_SQM_PATTERN = /^\d{1,4}(?:\.\d{1,2})?$/;

/** A decimal string carrying at least one non-zero digit, so "0.00" is not positive. */
const HAS_NON_ZERO_DIGIT = /[1-9]/;

/**
 * A JSON object and nothing else.
 *
 * A null prototype is accepted because `JSON.parse` with a reviver can produce
 * one. A Date, Map, Set or class instance is an object whose fields would not
 * survive a JSON round-trip, so it is not a body this API was sent.
 */
export function requirePlainJsonObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail();
  }

  const prototype = Object.getPrototypeOf(body);

  if (prototype !== Object.prototype && prototype !== null) {
    fail();
  }

  return body as Record<string, unknown>;
}

/** A room-type slug, returned unchanged. */
export function parseSlugValue(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(value)) {
    fail();
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
export function parseRequiredText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    fail();
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > maxLength) {
    fail();
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
export function parseOptionalText(value: unknown, maxLength: number): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    fail();
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    fail();
  }

  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A decimal kept as a string all the way to MySQL.
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
export function parseDecimalString(
  value: unknown,
  pattern: RegExp,
  minimum: 'zero' | 'positive',
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail();
  }

  if (minimum === 'positive' && !HAS_NON_ZERO_DIGIT.test(value)) {
    fail();
  }

  return value;
}

/**
 * The largest value a MySQL `integer` column holds.
 *
 * Every whole number this module validates — `capacity`, `bed_count`,
 * `sort_order` — is stored in an `int4` column, so this is the real ceiling,
 * not `Number.MAX_SAFE_INTEGER`. Bounding at the JavaScript limit instead let
 * a request that looked valid pass validation and then fail inside MySQL
 * with `22003`, which surfaces as a server error rather than as the bad
 * request it is.
 */
export const PG_INT4_MAX = 2_147_483_647;

/**
 * A whole number bound to what its column can actually store.
 *
 * `minimum` differs per field — capacity and bed count start at 1, sort order
 * at 0 — but the ceiling is the same for all of them, because every count in a
 * room type is an `integer` column. Stated here rather than at each call site
 * so no field can be given the bound and another forgotten.
 */
export function parseCount(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail();
  }

  if (value < minimum || value > PG_INT4_MAX) {
    fail();
  }

  return value;
}
