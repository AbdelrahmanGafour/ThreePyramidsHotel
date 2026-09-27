import {
  BASE_NIGHTLY_RATE_PATTERN,
  FieldError,
  MAX_LENGTHS,
  SIZE_SQM_PATTERN,
  parseCount,
  parseDecimalString,
  parseOptionalText,
  parseRequiredText,
  parseSlugValue,
  requirePlainJsonObject,
} from './admin-room-types.fields';
import {
  InvalidRoomTypeCapacityError,
  InvalidRoomTypeCreateError,
  InvalidRoomTypeSlugError,
  InvalidRoomTypeStatusError,
  InvalidRoomTypeUpdateError,
  type AdminRoomTypeCapacityUpdate,
  type AdminRoomTypeCreate,
  type AdminRoomTypeStatusUpdate,
  type AdminRoomTypeUpdate,
} from './admin-room-types.types';

/**
 * The four things an administrator can say about a room type, as pure
 * functions: name this one, create this one, change these fields, set this
 * capacity.
 *
 * What each field is allowed to be lives in `admin-room-types.fields.ts` and
 * is shared. What each *request* is allowed to carry, and which locked error
 * it raises, lives here — they are different questions, and a create body that
 * happens to share a field with a PATCH body is still a different contract.
 *
 * Every parser returns a fresh object holding only the fields it accepted, so
 * no caller can reach past it to the raw body.
 */

/**
 * Runs a parse and converts the shared helpers' marker error into whichever
 * contract the caller is answering for.
 *
 * Only `FieldError` is converted. Anything else is a fault and propagates
 * untouched rather than being reported to a caller as their mistake.
 */
function underContract<T>(parse: () => T, toContractError: () => Error): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof FieldError) {
      throw toContractError();
    }

    throw error;
  }
}

/**
 * Validates a room-type slug used as a route parameter.
 *
 * Returns it unchanged, so a caller cannot accidentally use the raw parameter
 * in place of the validated one.
 */
export function parseRoomTypeSlugParam(value: unknown): string {
  return underContract(
    () => parseSlugValue(value),
    () => new InvalidRoomTypeSlugError(),
  );
}

/** Exactly the keys the create endpoint accepts; anything else makes the body invalid. */
const CREATABLE_KEYS = [
  'slug',
  'name',
  'capacity',
  'baseNightlyRate',
  'sortOrder',
  'shortDescription',
  'description',
  'bedType',
  'bedCount',
  'sizeSqm',
  'view',
] as const;

/** Exactly the keys a partial update accepts. Narrower than create: no slug, no capacity. */
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

function requireOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new FieldError();
    }
  }
}

function buildCreate(body: unknown): AdminRoomTypeCreate {
  const record = requirePlainJsonObject(body);

  // An allowlist, so an unknown key and a server-controlled one are the same
  // rejection: `id`, `isActive`, `roomCount`, `currency`, `createdAt` and
  // `updatedAt` are simply not on it. A caller who believed they were creating
  // an active room type must be told they were not, and this is the only
  // chance to tell them.
  requireOnlyKeys(record, CREATABLE_KEYS);

  return {
    // Present and well formed, or there is nothing to create. The slug is part
    // of this body, so a bad one is a bad creation request.
    slug: parseSlugValue(record.slug),
    name: parseRequiredText(record.name, MAX_LENGTHS.name),
    capacity: parseCount(record.capacity, 1),
    // Zero is a legitimate rate — a type may be priced on request — so this is
    // bounded at zero rather than required to be positive.
    baseNightlyRate: parseDecimalString(record.baseNightlyRate, BASE_NIGHTLY_RATE_PATTERN, 'zero'),
    // The column's own default, restated: the repository will be handed a
    // complete row, so there is nothing left for the database to fill in.
    sortOrder: 'sortOrder' in record ? parseCount(record.sortOrder, 0) : 0,
    shortDescription:
      'shortDescription' in record
        ? parseOptionalText(record.shortDescription, MAX_LENGTHS.shortDescription)
        : null,
    description:
      'description' in record ? parseOptionalText(record.description, MAX_LENGTHS.description) : null,
    bedType: 'bedType' in record ? parseOptionalText(record.bedType, MAX_LENGTHS.bedType) : null,
    bedCount:
      'bedCount' in record ? (record.bedCount === null ? null : parseCount(record.bedCount, 1)) : null,
    // The column's CHECK requires a positive size, so zero is data the schema
    // says cannot exist.
    sizeSqm:
      'sizeSqm' in record
        ? record.sizeSqm === null
          ? null
          : parseDecimalString(record.sizeSqm, SIZE_SQM_PATTERN, 'positive')
        : null,
    view: 'view' in record ? parseOptionalText(record.view, MAX_LENGTHS.view) : null,
  };
}

/**
 * Validates a new room type.
 *
 * Four fields are required because their columns are NOT NULL with no useful
 * default, and because two of them cannot be corrected afterwards: the slug is
 * immutable, and capacity is not part of the ordinary update contract.
 *
 * `isActive` is not read at all. A new room type has no physical rooms, so it
 * is always created as a draft — that is not a default a caller may override.
 */
export function parseAdminRoomTypeCreate(body: unknown): AdminRoomTypeCreate {
  return underContract(
    () => buildCreate(body),
    () => new InvalidRoomTypeCreateError(),
  );
}

function buildUpdate(body: unknown): AdminRoomTypeUpdate {
  const record = requirePlainJsonObject(body);
  const keys = Object.keys(record);

  // A body that changes nothing is refused. An empty PATCH is a request that
  // misunderstood something, and answering it with "done" would hide that.
  if (keys.length === 0) {
    throw new FieldError();
  }

  requireOnlyKeys(record, EDITABLE_KEYS);

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

/**
 * Validates a partial room-type update.
 *
 * Only the nine editable fields are accepted. Any other key — an unknown one,
 * or a read-only/server-controlled one like `slug`, `capacity` or `isActive` —
 * makes the whole body invalid rather than being quietly dropped.
 *
 * Unchanged since T01: creation and capacity editing were added beside it, not
 * through it.
 */
export function parseAdminRoomTypeUpdate(body: unknown): AdminRoomTypeUpdate {
  return underContract(
    () => buildUpdate(body),
    () => new InvalidRoomTypeUpdateError(),
  );
}

function buildCapacityUpdate(body: unknown): AdminRoomTypeCapacityUpdate {
  const record = requirePlainJsonObject(body);
  const keys = Object.keys(record);

  // Exactly one key, by name. This endpoint exists to change one value, so a
  // body carrying anything alongside it was not written against this contract
  // — accepting it and ignoring the rest is how a caller comes to believe an
  // edit was applied that never was.
  if (keys.length !== 1 || keys[0] !== 'capacity') {
    throw new FieldError();
  }

  return { capacity: parseCount(record.capacity, 1) };
}

/**
 * Validates a capacity change.
 *
 * Shape only. Whether the new capacity conflicts with stays already booked is
 * a question about reservations, which no pure function can answer — that is
 * the service's job, under a lock.
 */
export function parseAdminRoomTypeCapacity(body: unknown): AdminRoomTypeCapacityUpdate {
  return underContract(
    () => buildCapacityUpdate(body),
    () => new InvalidRoomTypeCapacityError(),
  );
}

function buildStatusUpdate(body: unknown): AdminRoomTypeStatusUpdate {
  const record = requirePlainJsonObject(body);
  const keys = Object.keys(record);

  // Exactly one key, by name, like the capacity body beside it. A caller who
  // sent `{ isActive: true, name: "..." }` believing both would apply must be
  // told neither did.
  if (keys.length !== 1 || keys[0] !== 'isActive') {
    throw new FieldError();
  }

  // A real boolean, and nothing that merely looks like one. `"true"`, `1`,
  // `"false"`, `0` and `null` are mistakes to report, not input to interpret:
  // publishing a room type and withdrawing it are opposite acts, and a server
  // that guesses which way a malformed request leaned will eventually guess
  // wrong in front of guests.
  if (typeof record.isActive !== 'boolean') {
    throw new FieldError();
  }

  return { isActive: record.isActive };
}

/**
 * Validates a publish/archive request.
 *
 * Shape only. Whether the room type may actually be published depends on how
 * many of its physical rooms are in service, which no pure function can
 * answer — that is the service's job, under the room type's own lock.
 */
export function parseAdminRoomTypeStatus(body: unknown): AdminRoomTypeStatusUpdate {
  return underContract(
    () => buildStatusUpdate(body),
    () => new InvalidRoomTypeStatusError(),
  );
}
