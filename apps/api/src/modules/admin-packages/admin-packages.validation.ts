import { PACKAGE_WEEKDAYS } from '../../db/seeds/packageCatalogueSeed';
import { isPackageSlug } from '../packages/packages.validation';
import {
  InvalidAdminPackageError,
  InvalidAdminPackageSlugError,
  InvalidAdminPackageStatusError,
  InvalidAdminPackageVariantKeyError,
  OverlappingRateTiersError,
  type AdminPackageContentReplacementInput,
  type AdminPackageItineraryReplacementInput,
  type AdminPackageItinerarySection,
  type AdminPackageCreateInput,
  type AdminPackageDefaultVariantInput,
  type AdminPackageVariantOrderInput,
  type AdminPackageUpdateInput,
  type AdminPackageRateTierInput,
  type AdminPackageRatesReplacementInput,
  type AdminPackageVariantCreateInput,
  type AdminPackageVariantUpdateInput,
} from './admin-packages.types';

/**
 * Validates the slug in the URL.
 *
 * Reuses `isPackageSlug` — the same predicate the public catalogue uses —
 * rather than restating the format. There is deliberately no second, looser
 * rule here: a slug is the exact string the catalogue issued or it is not
 * one, and accepting an uppercased or trimmed variant would mean looking up a
 * value the caller never sent.
 *
 * Only the predicate is borrowed, not the public error: this module raises
 * its own so the admin envelope stays this module's to decide.
 */
export function parseAdminPackageSlugParam(value: unknown): string {
  if (!isPackageSlug(value)) {
    throw new InvalidAdminPackageSlugError();
  }

  return value;
}

/**
 * Validates the body of an activation request.
 *
 * Exactly `true` or `false` under `isActive`, and nothing else. No coercion:
 * `"true"`, `1` and `null` are mistakes to report, not input to interpret —
 * a caller that meant to publish a journey should be told its request was
 * malformed rather than have the server guess which way it leaned.
 *
 * Other keys in the body are ignored; only `isActive` is read. A body that is
 * not an object at all — null, an array, a string — is refused outright.
 */
export function parseAdminPackageStatusUpdate(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidAdminPackageStatusError();
  }

  const isActive = (body as { isActive?: unknown }).isActive;

  if (typeof isActive !== 'boolean') {
    throw new InvalidAdminPackageStatusError();
  }

  return isActive;
}

// The package-level rules, mirroring the schema's own CHECK constraints so a
// bad request is refused before it reaches PostgreSQL rather than surfacing
// as a constraint violation nobody can act on.

/** `packages_code_not_blank_check`: trimmed, non-empty, no surrounding space. */
function isPackageCode(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 120
    && value === value.trim()
    && value.trim() !== '';
}

/**
 * `packages_title_not_blank_check` and its siblings: text that is present must
 * be trimmed and non-empty. Nothing is trimmed here — a value with stray
 * whitespace is reported rather than quietly repaired, matching how the
 * catalogue seed treats its own input.
 */
function isCanonicalText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim();
}

function isNullableCanonicalText(value: unknown, maxLength: number): value is string | null {
  return value === null || isCanonicalText(value, maxLength);
}

/**
 * `packages_operating_days_check`: null, or a non-empty set of distinct
 * weekday names. An empty array is refused by the database — `array_ndims`
 * is NULL for one — so it is refused here too rather than being written and
 * bounced back as a constraint error.
 */
function isOperatingDays(value: unknown): value is string[] | null {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((day) => typeof day === 'string' && PACKAGE_WEEKDAYS.includes(day as never))) {
    return false;
  }

  return new Set(value).size === value.length;
}

/** `packages_sort_order_check`, within int4. */
function isSortOrder(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= 2147483647;
}

/**
 * Validates the body of a create request.
 *
 * Strict and explicit: every field is checked against the rule the schema
 * already enforces, and anything unrecognised in the body is ignored rather
 * than written. Nothing is coerced — a numeric `sortOrder` sent as a string,
 * or a `requiresPriceConfirmation` sent as `"true"`, is a mistake to report.
 *
 * `isActive` and any ownership field a caller might send are not read at all.
 * They are not optional inputs with defaults; they are simply not this
 * endpoint's to accept, and the insert states both itself.
 *
 * Returns a narrow value, so a caller cannot use the raw body in its place.
 */
export function parseAdminPackageCreate(body: unknown): AdminPackageCreateInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidAdminPackageError();
  }

  const input = body as Record<string, unknown>;

  if (!isPackageCode(input.code)) throw new InvalidAdminPackageError();
  // The same slug rule the public catalogue uses, never a looser one.
  if (!isPackageSlug(input.slug)) throw new InvalidAdminPackageError();
  if (!isCanonicalText(input.title, 200)) throw new InvalidAdminPackageError();
  if (!isNullableCanonicalText(input.summary, 500)) throw new InvalidAdminPackageError();
  if (!isNullableCanonicalText(input.description, 5000)) throw new InvalidAdminPackageError();
  if (!isNullableCanonicalText(input.durationLabel, 120)) throw new InvalidAdminPackageError();
  if (!isNullableCanonicalText(input.scheduleLabel, 120)) throw new InvalidAdminPackageError();
  if (!isOperatingDays(input.operatingDays)) throw new InvalidAdminPackageError();
  if (typeof input.requiresPriceConfirmation !== 'boolean') throw new InvalidAdminPackageError();
  if (!isSortOrder(input.sortOrder)) throw new InvalidAdminPackageError();

  return {
    code: input.code,
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    description: input.description,
    durationLabel: input.durationLabel,
    scheduleLabel: input.scheduleLabel,
    operatingDays: input.operatingDays,
    requiresPriceConfirmation: input.requiresPriceConfirmation,
    sortOrder: input.sortOrder,
  };
}

/**
 * Exactly the keys an edit may carry.
 *
 * An allowlist rather than a list of forbidden names, so it covers every case
 * at once and cannot fall behind: `code` and `slug` (identity), `isActive`
 * (publication), `seedManaged` / `seed_managed` / `managementSource`
 * (ownership), and `variants`, `rates`, `itinerary`, `content` and anything
 * else belonging to a child resource are all simply not on it.
 *
 * A body carrying any of them is refused rather than having the extra field
 * ignored. Silently dropping it would let an administrator believe they had
 * renamed a journey, or published one, when nothing of the sort happened.
 */
const EDITABLE_PACKAGE_FIELDS = [
  'title',
  'summary',
  'description',
  'durationLabel',
  'scheduleLabel',
  'operatingDays',
  'requiresPriceConfirmation',
  'sortOrder',
] as const;

/**
 * Validates the body of an edit request.
 *
 * Every editable field is required: this is a full replacement of the
 * package-level fields, not a partial patch, so omitting one would mean
 * guessing whether the caller meant "leave it" or "clear it". Nullable fields
 * must be sent as an explicit `null`, which is preserved exactly.
 *
 * The rules are the same ones create uses, so a value that could be created
 * can be edited to and back.
 */
export function parseAdminPackageUpdate(body: unknown): AdminPackageUpdateInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidAdminPackageError();
  }

  const input = body as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (!EDITABLE_PACKAGE_FIELDS.includes(key as never)) {
      throw new InvalidAdminPackageError();
    }
  }

  if (!isCanonicalText(input.title, 200)) throw new InvalidAdminPackageError();
  if (!isNullableCanonicalText(input.summary, 500)) throw new InvalidAdminPackageError();
  if (!isNullableCanonicalText(input.description, 5000)) throw new InvalidAdminPackageError();
  if (!isNullableCanonicalText(input.durationLabel, 120)) throw new InvalidAdminPackageError();
  if (!isNullableCanonicalText(input.scheduleLabel, 120)) throw new InvalidAdminPackageError();
  if (!isOperatingDays(input.operatingDays)) throw new InvalidAdminPackageError();
  if (typeof input.requiresPriceConfirmation !== 'boolean') throw new InvalidAdminPackageError();
  if (!isSortOrder(input.sortOrder)) throw new InvalidAdminPackageError();

  return {
    title: input.title,
    summary: input.summary,
    description: input.description,
    durationLabel: input.durationLabel,
    scheduleLabel: input.scheduleLabel,
    operatingDays: input.operatingDays,
    requiresPriceConfirmation: input.requiresPriceConfirmation,
    sortOrder: input.sortOrder,
  };
}

/**
 * Validates the variant key in the URL.
 *
 * The schema's `package_variants_key_format_check` is the same shape as a
 * package slug, so the same predicate serves — one definition of "lower-case
 * words joined by hyphens", not two that could drift.
 */
export function parseAdminPackageVariantKeyParam(value: unknown): string {
  if (!isPackageSlug(value)) {
    throw new InvalidAdminPackageVariantKeyError();
  }

  return value;
}

/** Exactly the keys a variant edit may carry. */
const EDITABLE_VARIANT_FIELDS = [
  'label',
  'childMinAge',
  'childMaxAge',
  'childDiscountPercent',
] as const;

/**
 * A percentage as an exact two-decimal string, 0.00 to 100.00.
 *
 * A string, never a number: the column is `numeric(5,2)`, and routing a
 * decimal through a JavaScript float to get it there would be the one place
 * this codebase lets a rounding error in. Exactly two decimals so there is a
 * single way to write any value, matching how the catalogue stores them.
 */
function isChildDiscountPercent(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})\.\d{2}(?![\s\S])/.test(value)) {
    return false;
  }

  // Compared as hundredths so the bound is checked without parsing a float.
  return BigInt(value.replace('.', '')) <= 10000n;
}

/** A whole, non-negative age within int4. */
function isChildAge(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= 2147483647;
}

/**
 * Validates the body of a variant metadata edit.
 *
 * An allowlist, so `key`, `isDefault`, `sortOrder`, `rates`, `isActive` and
 * anything about ownership are refused rather than ignored: silently dropping
 * `isDefault` would let an administrator believe they had changed which
 * variant a reservation resolves to.
 *
 * The child trio is checked as a trio, exactly as the database CHECK states
 * it — three nulls, or three values with `childMaxAge >= childMinAge`. A
 * half-set rule is refused here rather than being bounced back as a
 * constraint violation nobody can act on.
 */
export function parseAdminPackageVariantUpdate(body: unknown): AdminPackageVariantUpdateInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidAdminPackageError();
  }

  const input = body as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (!EDITABLE_VARIANT_FIELDS.includes(key as never)) {
      throw new InvalidAdminPackageError();
    }
  }

  if (!isCanonicalText(input.label, 200)) throw new InvalidAdminPackageError();

  const { childMinAge, childMaxAge, childDiscountPercent } = input;
  const allNull = childMinAge === null && childMaxAge === null && childDiscountPercent === null;

  if (!allNull) {
    if (!isChildAge(childMinAge) || !isChildAge(childMaxAge)) {
      throw new InvalidAdminPackageError();
    }
    if (!isChildDiscountPercent(childDiscountPercent)) {
      throw new InvalidAdminPackageError();
    }
    if (childMaxAge < childMinAge) {
      throw new InvalidAdminPackageError();
    }
  }

  return {
    label: input.label,
    childMinAge: allNull ? null : (childMinAge as number),
    childMaxAge: allNull ? null : (childMaxAge as number),
    childDiscountPercent: allNull ? null : (childDiscountPercent as string),
  };
}

/**
 * Exactly the keys a new variant may carry.
 *
 * `key` is on it and `label` is on it; `isDefault`, `sortOrder` and `rates`
 * are not, and neither is anything about the parent journey. A body offering
 * one of those is refused rather than having it ignored: silently dropping
 * `isDefault` would let an administrator believe they had chosen which
 * variant a reservation resolves to, and silently dropping `rates` would let
 * them believe a new variant had been priced.
 */
const CREATABLE_VARIANT_FIELDS = [
  'key',
  'label',
  'childMinAge',
  'childMaxAge',
  'childDiscountPercent',
] as const;

/**
 * Validates the body of a variant create request.
 *
 * The key is checked with the same predicate the URL parameter uses — one
 * definition of a variant key, not two that could drift — but a key that
 * fails here is a malformed body rather than a malformed address, so it
 * raises the same single error every other field does. The rules for the
 * label and the child trio are the ones an edit already enforces, so a
 * variant that can be created can be edited to and back.
 *
 * Whether the key is already taken is not asked here. Only the database can
 * answer that without a race, and it is asked by trying.
 */
export function parseAdminPackageVariantCreate(body: unknown): AdminPackageVariantCreateInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidAdminPackageError();
  }

  const input = body as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (!CREATABLE_VARIANT_FIELDS.includes(key as never)) {
      throw new InvalidAdminPackageError();
    }
  }

  if (!isPackageSlug(input.key)) throw new InvalidAdminPackageError();
  if (!isCanonicalText(input.label, 200)) throw new InvalidAdminPackageError();

  const { childMinAge, childMaxAge, childDiscountPercent } = input;
  const allNull = childMinAge === null && childMaxAge === null && childDiscountPercent === null;

  if (!allNull) {
    if (!isChildAge(childMinAge) || !isChildAge(childMaxAge)) {
      throw new InvalidAdminPackageError();
    }
    if (!isChildDiscountPercent(childDiscountPercent)) {
      throw new InvalidAdminPackageError();
    }
    if (childMaxAge < childMinAge) {
      throw new InvalidAdminPackageError();
    }
  }

  return {
    key: input.key,
    label: input.label,
    childMinAge: allNull ? null : (childMinAge as number),
    childMaxAge: allNull ? null : (childMaxAge as number),
    // Preserved as the exact string it arrived as. It is never parsed as a
    // number anywhere on this path, so no rounding can enter it.
    childDiscountPercent: allNull ? null : (childDiscountPercent as string),
  };
}

/**
 * Validates the body that names the leading variant.
 *
 * Exactly one key, and it must be `variantKey`. An allowlist of one rather
 * than "read variantKey and ignore the rest": a body that also carried
 * `isDefault`, `sortOrder` or a variant's metadata would be a caller
 * expecting something this endpoint does not do, and silently dropping it
 * would let them believe it had happened.
 *
 * The key is checked with the same predicate the URL parameter uses — one
 * definition of a variant key, not two that could drift — and is used exactly
 * as given. Nothing is trimmed or lowercased: a key that needs repairing is
 * not the key of any variant, and repairing it would look up a value the
 * caller never sent.
 */
export function parseAdminPackageDefaultVariant(body: unknown): AdminPackageDefaultVariantInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidAdminPackageError();
  }

  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);

  if (keys.length !== 1 || keys[0] !== 'variantKey') {
    throw new InvalidAdminPackageError();
  }

  if (!isPackageSlug(input.variantKey)) {
    throw new InvalidAdminPackageError();
  }

  return { variantKey: input.variantKey };
}

/**
 * Validates the body that states the running order.
 *
 * Exactly one key, `variantKeys`, holding a non-empty array of well-formed
 * variant keys with no repeats. A repeat is refused here rather than
 * deduplicated: two positions for one variant is not an order, and choosing
 * which of them to honour would be guessing.
 *
 * Whether the list matches the journey's actual variants is NOT asked here.
 * Only a locked read can answer that without a race, so it is answered in the
 * transaction, where a missing key and an unknown one get different replies.
 *
 * Keys are used exactly as given. Nothing is trimmed or lowercased: a key
 * that needs repairing is not the key of any variant, and repairing it would
 * reorder around a value the caller never sent.
 */
export function parseAdminPackageVariantOrder(body: unknown): AdminPackageVariantOrderInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidAdminPackageError();
  }

  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);

  if (keys.length !== 1 || keys[0] !== 'variantKeys') {
    throw new InvalidAdminPackageError();
  }

  const variantKeys = input.variantKeys;

  if (!Array.isArray(variantKeys) || variantKeys.length === 0) {
    throw new InvalidAdminPackageError();
  }

  for (const key of variantKeys) {
    if (!isPackageSlug(key)) {
      throw new InvalidAdminPackageError();
    }
  }

  if (new Set(variantKeys).size !== variantKeys.length) {
    throw new InvalidAdminPackageError();
  }

  return { variantKeys: [...variantKeys] as string[] };
}

/** Exactly the keys one itinerary section may carry. */
const ITINERARY_SECTION_FIELDS = ['dayNumber', 'heading', 'body'] as const;

const MAX_ITINERARY_SECTIONS = 100;
const MAX_ITINERARY_HEADING_LENGTH = 200;
const MAX_ITINERARY_BODY_LENGTH = 2000;

/**
 * A day number: null, or a whole number above zero within int4.
 *
 * Mirrors `package_itinerary_sections_day_number_check`. Null is a real
 * value here — a section about the journey as a whole rather than about a
 * particular day — so it is accepted rather than defaulted.
 */
function isItineraryDayNumber(value: unknown): value is number | null {
  if (value === null) return true;

  return typeof value === 'number'
    && Number.isInteger(value)
    && value > 0
    && value <= 2147483647;
}

function parseItinerarySection(value: unknown): AdminPackageItinerarySection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidAdminPackageError();
  }

  const section = value as Record<string, unknown>;
  const keys = Object.keys(section);

  // Exactly the three, no more and no fewer. An omitted `heading` is not the
  // same statement as an explicit null, and reading it as one would let a
  // caller believe they had kept a heading they never sent.
  if (keys.length !== ITINERARY_SECTION_FIELDS.length
    || ITINERARY_SECTION_FIELDS.some((field) => !keys.includes(field))) {
    throw new InvalidAdminPackageError();
  }

  if (!isItineraryDayNumber(section.dayNumber)) throw new InvalidAdminPackageError();

  // Null or real text, never an empty string. The database would refuse a
  // blank heading outright, and quietly turning one into null would store a
  // different section than the one described.
  if (!isNullableCanonicalText(section.heading, MAX_ITINERARY_HEADING_LENGTH)) {
    throw new InvalidAdminPackageError();
  }

  if (!isCanonicalText(section.body, MAX_ITINERARY_BODY_LENGTH)) {
    throw new InvalidAdminPackageError();
  }

  return {
    dayNumber: section.dayNumber,
    heading: section.heading,
    body: section.body,
  };
}

/**
 * Validates a whole-itinerary replacement.
 *
 * The body carries `sections` and nothing else, and every section is checked
 * on its own. An empty array is valid: a journey without a day-by-day plan is
 * ordinary, and the catalogue seed already permits one.
 *
 * Duplicates are allowed. Two sections can legitimately read alike — a
 * repeated "Return to the hotel" — and nothing is keyed on their text.
 *
 * The count bound exists because the table has none: without it one request
 * could insert an unbounded number of rows, and the body bound exists because
 * `text` is unbounded in PostgreSQL.
 *
 * Returned in the order given. That order is the itinerary.
 */
export function parseAdminPackageItineraryReplacement(
  body: unknown,
): AdminPackageItineraryReplacementInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidAdminPackageError();
  }

  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);

  if (keys.length !== 1 || keys[0] !== 'sections') {
    throw new InvalidAdminPackageError();
  }

  if (!Array.isArray(input.sections) || input.sections.length > MAX_ITINERARY_SECTIONS) {
    throw new InvalidAdminPackageError();
  }

  return { sections: input.sections.map(parseItinerarySection) };
}

/** The three lists a content replacement carries, in the API's vocabulary. */
const CONTENT_LIST_KEYS = ['included', 'excluded', 'notes'] as const;

/** Guards against a request that would insert an unbounded number of rows. */
const MAX_CONTENT_ENTRIES = 100;
const MAX_CONTENT_ENTRY_LENGTH = 500;

/**
 * Validates a whole-set content replacement.
 *
 * Exactly the three lists, all required, each an array. An omitted list is a
 * malformed request rather than "leave that one alone": this replaces the
 * package's content, and a caller who meant to change one list still has to
 * say what the other two are.
 *
 * Every entry is checked with the same canonical-text rule the package-level
 * prose uses, so text arrives trimmed or is refused rather than repaired —
 * the database only demands non-blank, but quietly trimming would store
 * something the administrator did not type.
 *
 * Both bounds exist because the columns have none: `text` is unbounded in
 * PostgreSQL, so without them one request could insert a hundred thousand
 * rows, or a single item longer than the page that renders it.
 *
 * `sort_order` is not read, and there is nowhere in this shape to put one:
 * position in the array is the order, and the server derives the rest.
 */
export function parseAdminPackageContentReplacement(
  body: unknown,
): AdminPackageContentReplacementInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidAdminPackageError();
  }

  const input = body as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (!CONTENT_LIST_KEYS.includes(key as never)) {
      throw new InvalidAdminPackageError();
    }
  }

  const lists: Record<string, string[]> = {};

  for (const key of CONTENT_LIST_KEYS) {
    const value = input[key];

    // Required, not defaulted: an absent list is a question this endpoint
    // cannot answer.
    if (!Array.isArray(value) || value.length > MAX_CONTENT_ENTRIES) {
      throw new InvalidAdminPackageError();
    }

    for (const entry of value) {
      if (!isCanonicalText(entry, MAX_CONTENT_ENTRY_LENGTH)) {
        throw new InvalidAdminPackageError();
      }
    }

    // Copied, so the caller's array cannot be mutated underneath the write.
    lists[key] = [...(value as string[])];
  }

  return {
    included: lists.included!,
    excluded: lists.excluded!,
    notes: lists.notes!,
  };
}

/** Exactly the keys one replacement tier may carry. */
const RATE_TIER_FIELDS = ['minPartySize', 'maxPartySize', 'adultUnitRate'] as const;

const MAX_RATE_MINOR_UNITS = 999999999999n; // numeric(12,2)

/**
 * An amount as an exact two-decimal string, within `numeric(12,2)`.
 *
 * A string, never a number, and compared in minor units with BigInt: this is
 * money, and routing it through a JavaScript float to check a bound would be
 * the one place a rounding error could enter the pricing path. The pattern is
 * the same one the catalogue seed validates its own rates with.
 */
function isAdultUnitRate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,9})\.\d{2}(?![\s\S])/.test(value)) {
    return false;
  }

  return BigInt(value.replace('.', '')) <= MAX_RATE_MINOR_UNITS;
}

/** A party size: a whole number above zero, within int4. */
function isPartySize(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value > 0
    && value <= 2147483647;
}

function parseRateTier(value: unknown): AdminPackageRateTierInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidAdminPackageError();
  }

  const tier = value as Record<string, unknown>;

  for (const key of Object.keys(tier)) {
    if (!RATE_TIER_FIELDS.includes(key as never)) {
      // `currency` lands here too: it is the system's to decide, not the
      // caller's, so offering it is a malformed request rather than a value
      // to ignore.
      throw new InvalidAdminPackageError();
    }
  }

  if (!isPartySize(tier.minPartySize)) throw new InvalidAdminPackageError();
  if (tier.maxPartySize !== null && !isPartySize(tier.maxPartySize)) {
    throw new InvalidAdminPackageError();
  }
  if (tier.maxPartySize !== null && (tier.maxPartySize as number) < tier.minPartySize) {
    throw new InvalidAdminPackageError();
  }
  if (!isAdultUnitRate(tier.adultUnitRate)) throw new InvalidAdminPackageError();

  return {
    minPartySize: tier.minPartySize,
    maxPartySize: tier.maxPartySize as number | null,
    adultUnitRate: tier.adultUnitRate,
  };
}

/**
 * Whether any two tiers cover the same party size.
 *
 * Checked here as well as by the database, and for a different reason: the
 * exclusion constraint is the integrity guarantee, but it answers with a
 * SQLSTATE mid-transaction, after the delete has already run. Catching it
 * before the transaction opens means the ordinary mistake — two tiers that
 * both cover a party of four — is a plain 409 that never touched a row.
 *
 * Sorted by lower bound, then each tier compared with the one before it. An
 * open-ended tier swallows everything after it, which is why a null upper
 * bound anywhere but last is an overlap.
 */
export function ratesOverlap(rates: readonly AdminPackageRateTierInput[]): boolean {
  const sorted = [...rates].sort((left, right) => left.minPartySize - right.minPartySize);

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;

    if (previous.maxPartySize === null || current.minPartySize <= previous.maxPartySize) {
      return true;
    }
  }

  return false;
}

/**
 * Validates a whole-set rate replacement.
 *
 * The body carries `rates` and nothing else. Each tier is checked on its own,
 * then the set is checked as a set: individually valid tiers can still
 * describe an impossible price list.
 *
 * Returned sorted by `minPartySize`, so the write order is deterministic and
 * two identical requests produce identical rows.
 */
export function parseAdminPackageRatesReplacement(
  body: unknown,
): AdminPackageRatesReplacementInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidAdminPackageError();
  }

  const input = body as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (key !== 'rates') throw new InvalidAdminPackageError();
  }

  if (!Array.isArray(input.rates)) throw new InvalidAdminPackageError();

  const rates = input.rates.map(parseRateTier);

  if (ratesOverlap(rates)) {
    throw new OverlappingRateTiersError();
  }

  return {
    rates: [...rates].sort((left, right) => left.minPartySize - right.minPartySize),
  };
}
