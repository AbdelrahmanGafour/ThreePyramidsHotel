import type { AdminRoomTypeCreate } from "../types";

/**
 * Turning a submitted form into the typed payload an API client sends.
 *
 * Pure: no request context, no network, no `next/*`. That is deliberate — a
 * Server Action cannot be imported under a plain Node test without Next's
 * request context, so everything here that *decides* something lives outside
 * one and is tested directly.
 *
 * These parsers are **not** a second copy of the API's validation contract.
 * The API remains authoritative on lengths, patterns, ranges and trimming, and
 * nothing here enforces a PostgreSQL range or a regex. They do exactly two
 * jobs:
 *
 *   1. read only the fields each operation is allowed to read, so no extra
 *      input a page happened to carry — and nothing a crafted post added —
 *      can become a payload key;
 *   2. preserve the API's types, so a money string stays a string and a count
 *      arrives as a JSON number rather than as text.
 *
 * A value this layer can already see is unusable is a *local refusal*: the
 * request is never issued, and the administrator is told the entry was
 * rejected rather than that the hotel API failed.
 */

/** A parse either produced a payload or refused it. No third possibility. */
export type FormParse<T> = { ok: true; value: T } | { ok: false };

const REFUSED = { ok: false } as const;

/**
 * A field as submitted, with no processing at all.
 *
 * A file, or a name the form never carried, is not a value this form sends, so
 * both are `null` here and the caller decides whether that is a refusal or an
 * absence.
 */
function raw(form: FormData, name: string): string | null {
  const value = form.get(name);

  return typeof value === "string" ? value : null;
}

/**
 * A number the API will receive as JSON.
 *
 * `Number("")` is 0, so an empty entry is checked before conversion rather
 * than being quietly read as zero. Nothing is clamped or rounded: `2.5` is
 * passed through as `2.5` for the API to refuse, because silently turning it
 * into `2` or `3` would store a capacity nobody asked for.
 */
function toFiniteNumber(value: string): number | null {
  if (value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Builds a new room type from exactly the eleven fields the create form may
 * carry.
 *
 * `isActive` is not read — nor are `id`, `roomCount`, `currency` or the
 * timestamps. They are not on this list, so no submission can introduce them.
 *
 * `slug` is passed through byte for byte: not trimmed, not lower-cased. It is
 * the permanent public identifier, and tidying it here would create a room
 * type at an address the administrator never typed.
 *
 * Money and the room size stay strings the whole way. Routing either through
 * a float is the one thing that would make an exact `numeric` column inexact.
 */
export function parseRoomTypeCreateForm(form: FormData): FormParse<AdminRoomTypeCreate> {
  const slug = raw(form, "slug");
  const name = raw(form, "name");
  const baseNightlyRate = raw(form, "baseNightlyRate");
  const capacityRaw = raw(form, "capacity");

  // A required entry that is absent, or that arrived as something other than
  // text, is refused before anything is sent.
  if (slug === null || name === null || baseNightlyRate === null || capacityRaw === null) {
    return REFUSED;
  }

  const capacity = toFiniteNumber(capacityRaw);

  if (capacity === null) {
    return REFUSED;
  }

  // Absent means "not recorded". An empty string is left exactly as submitted:
  // the API owns turning "" into null, and doing it here as well would be a
  // second opinion able to disagree with the first.
  const optionalText = (field: string) => raw(form, field);

  const bedCountRaw = raw(form, "bedCount");
  let bedCount: number | null = null;

  if (bedCountRaw !== null && bedCountRaw.trim().length > 0) {
    bedCount = toFiniteNumber(bedCountRaw);

    if (bedCount === null) {
      return REFUSED;
    }
  }

  const sortOrderRaw = raw(form, "sortOrder");
  let sortOrder = 0;

  if (sortOrderRaw !== null && sortOrderRaw.trim().length > 0) {
    const parsed = toFiniteNumber(sortOrderRaw);

    if (parsed === null) {
      return REFUSED;
    }

    sortOrder = parsed;
  }

  const sizeSqmRaw = raw(form, "sizeSqm");

  return {
    ok: true,
    value: {
      slug,
      name,
      capacity,
      baseNightlyRate,
      sortOrder,
      shortDescription: optionalText("shortDescription"),
      description: optionalText("description"),
      bedType: optionalText("bedType"),
      bedCount,
      // An exact decimal string, never a number.
      sizeSqm: sizeSqmRaw !== null && sizeSqmRaw.trim().length > 0 ? sizeSqmRaw : null,
      view: optionalText("view"),
    },
  };
}

/**
 * Reads the one field a capacity change may carry.
 *
 * Not clamped, not rounded, not range-checked: whether 0, 2.5 or three billion
 * is acceptable is the API's rule, and this layer refuses only what it could
 * not send as a number at all.
 */
export function parseCapacityForm(form: FormData): FormParse<number> {
  const value = raw(form, "capacity");

  if (value === null) {
    return REFUSED;
  }

  const capacity = toFiniteNumber(value);

  return capacity === null ? REFUSED : { ok: true, value: capacity };
}

/**
 * Reads the one field an add-room or rename form may carry.
 *
 * Passed through byte for byte — not trimmed, not re-cased. The API trims
 * before storage and refuses what it cannot store; trimming here would mean
 * silently asking about a different room number than the one submitted.
 */
export function parseRoomNumberForm(form: FormData): FormParse<string> {
  const value = raw(form, "roomNumber");

  return value === null ? REFUSED : { ok: true, value };
}
