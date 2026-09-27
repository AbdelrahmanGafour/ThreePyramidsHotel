/**
 * The administration contract for the package catalogue.
 *
 * Separate from the public package contract: an administrator needs to see
 * inactive offerings, where each sits in the running order, and who is
 * allowed to edit it — none of which a guest may know.
 */

/**
 * Who authors a package row.
 *
 * The database records this as `packages.seed_managed`, a boolean named after
 * the mechanism. That name is not in this contract on purpose: a client has no
 * business knowing there is a seed, and a boolean called `seedManaged` would
 * make every reader work out which way round `false` reads. `brochure` and
 * `admin` say who owns the row, which is the fact that matters.
 *
 * `brochure` — still reconciled by the catalogue seed, so an edit would be
 * overwritten on the next run until ownership moves.
 * `admin` — an administrator owns it; the seed skips it entirely.
 */
export type AdminPackageManagementSource = 'brochure' | 'admin';

/**
 * One row of the administration catalogue list.
 *
 * No database id of any kind. A package is addressed by its `code` and its
 * `slug`, both of which are unique and both of which an administrator can
 * already see.
 *
 * Deliberately narrower than the row it is built from. `description`,
 * `operatingDays`, the itinerary, the content items and every rate tier are
 * all real and all useful, and none of them belongs in a list: they are what
 * a detail view is for, and a list that carries everything is a list that
 * leaks by default. No price appears here at all.
 */
export type AdminPackageListItem = {
  code: string;
  slug: string;
  title: string;
  summary: string | null;
  durationLabel: string | null;
  scheduleLabel: string | null;
  /** True when the offering is quoted by an operator rather than priced outright. */
  requiresPriceConfirmation: boolean;
  /** Whether guests can see it. Independent of who owns the row. */
  isActive: boolean;
  sortOrder: number;
  managementSource: AdminPackageManagementSource;
  /**
   * How many variants the package has, and which one leads.
   *
   * Enough to tell a single-variant tour from one with cabin or service
   * choices, without carrying the variants themselves. `defaultVariantLabel`
   * is null when no variant is flagged as the default; at most one ever can
   * be, which a partial unique index enforces.
   */
  variantCount: number;
  defaultVariantLabel: string | null;
};

/** What the service returns, with no HTTP envelope around it. */
export type AdminPackageList = {
  packages: AdminPackageListItem[];
};

/** One party-size tier, exactly as stored. No figure here is computed. */
export type AdminPackageRateTier = {
  minPartySize: number;
  /** null means unbounded — a "3 or more" tier. */
  maxPartySize: number | null;
  adultUnitRate: string;
  currency: 'USD';
};

/**
 * One variant an administrator may edit.
 *
 * `sortOrder` is exposed here where the public contract omits it: a guest is
 * given the variants in order and has no reason to know the numbers, while an
 * administrator arranging them does. The child-pricing trio is all-or-nothing
 * by a database CHECK, so the three fields are null together or set together.
 */
export type AdminPackageVariant = {
  key: string;
  label: string;
  isDefault: boolean;
  sortOrder: number;
  childMinAge: number | null;
  childMaxAge: number | null;
  childDiscountPercent: string | null;
  rates: AdminPackageRateTier[];
};

export type AdminPackageItinerarySection = {
  /** null for a section that belongs to the whole journey rather than a day. */
  dayNumber: number | null;
  heading: string | null;
  body: string;
};

/**
 * The content items, grouped by the three kinds the schema's CHECK allows.
 *
 * Grouped rather than returned as a flat list of `{ kind, text }`: every
 * reader wants them separated, and doing it once here means no consumer
 * reimplements the split — nor invents a fourth kind by mistake.
 */
export type AdminPackageContent = {
  included: string[];
  excluded: string[];
  notes: string[];
};

/**
 * One package in full.
 *
 * Defined as the list item plus the rest, so "the detail shows everything the
 * list shows" is true by construction and cannot drift as either changes.
 * `variantCount` and `defaultVariantLabel` therefore remain, redundant beside
 * the variants themselves but consistent with the list a reader arrived from.
 *
 * Still no database id of any kind — not the package's, not a variant's, not
 * a tier's. A package is addressed by slug, a variant by key.
 */
/**
 * The journey's one image, as an administrator is allowed to see it.
 *
 * Five fields. The extra one over the public shape is `reference`, and it is
 * deliberate: the media endpoints already address an image by exactly that
 * value, so an admin page that has just read the journey can describe or
 * replace its picture without a second request. It is an opaque identifier
 * the application itself issued, not an internal key — a guest is given only
 * the URL, and the public projection has no `reference` field at all.
 *
 * Still absent, here as everywhere: `storage_key`, `checksum_sha256`,
 * `content_type`, `byte_size`, both database ids, and anything naming a
 * bucket or a provider. None of them helps manage an image, and the object
 * key and digest are facts about how bytes are stored rather than about the
 * picture.
 *
 * `url` is composed when this is built, never read from a column.
 */
export type AdminPackageImage = {
  reference: string;
  url: string;
  altText: string | null;
  width: number;
  height: number;
};

/**
 * The image as the repository reads it: identity, not address.
 *
 * The difference from `AdminPackageImage` is `url`, which is absent.
 * Composing one needs the deployment's public media base — configuration the
 * repository has no business reading — so the reference travels this far and
 * the projection turns it into a URL at the HTTP boundary.
 */
export type AdminPackageImageRecord = {
  reference: string;
  altText: string | null;
  width: number;
  height: number;
};

export type AdminPackageDetail = AdminPackageListItem & {
  description: string | null;
  /** Lowercase weekday names, or null when the journey has no fixed days. */
  operatingDays: string[] | null;
  itinerary: AdminPackageItinerarySection[];
  content: AdminPackageContent;
  variants: AdminPackageVariant[];
  /**
   * The journey's image, or `null` when none has been uploaded.
   *
   * On the detail, not on the list item: a catalogue row does not show a
   * picture, and adding one there would make every list read pay for a join
   * nothing renders. Every endpoint that answers with a whole journey —
   * the read, the create, the edits, the variant and content operations —
   * carries it, because they all return this one shape and splitting them
   * would be an artificial difference nobody could predict.
   */
  image: AdminPackageImage | null;
};

/**
 * The journey as the repository returns it, before the HTTP boundary has
 * turned its media reference into a URL.
 *
 * Identical to `AdminPackageDetail` but for that one field. It exists so the
 * repository can stay PostgreSQL and row-mapping only: composing a URL needs
 * configuration, and a repository that read configuration would be a second
 * place deployment settings are interpreted.
 */
export type AdminPackageDetailRecord = Omit<AdminPackageDetail, 'image'> & {
  image: AdminPackageImageRecord | null;
};

export const INVALID_PACKAGE_SLUG_ERROR_CODE = 'INVALID_PACKAGE_SLUG';
export const INVALID_PACKAGE_SLUG_ERROR_MESSAGE = 'Invalid package slug';

/**
 * The slug in the URL is not a slug at all.
 *
 * Kept apart from "no package has it": one is a malformed request, the other
 * is an answer. The code matches the public catalogue's, because it is the
 * same rule about the same kind of value; the message never echoes what was
 * supplied.
 */
export class InvalidAdminPackageSlugError extends Error {
  readonly code = INVALID_PACKAGE_SLUG_ERROR_CODE;

  constructor() {
    super(INVALID_PACKAGE_SLUG_ERROR_MESSAGE);
    this.name = 'InvalidAdminPackageSlugError';
  }
}

export function isInvalidAdminPackageSlugError(
  error: unknown,
): error is InvalidAdminPackageSlugError {
  return error instanceof InvalidAdminPackageSlugError;
}

export const PACKAGE_NOT_FOUND_ERROR_CODE = 'PACKAGE_NOT_FOUND';
export const PACKAGE_NOT_FOUND_ERROR_MESSAGE = 'Package not found';

/** Frozen so the one not-found body cannot be mutated by a caller. */
export const PACKAGE_NOT_FOUND_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_NOT_FOUND_ERROR_CODE,
    message: PACKAGE_NOT_FOUND_ERROR_MESSAGE,
  }),
});

export const INVALID_PACKAGE_STATUS_ERROR_CODE = 'INVALID_PACKAGE_STATUS';
export const INVALID_PACKAGE_STATUS_ERROR_MESSAGE = 'Invalid package status';

/**
 * The request body did not say, unambiguously, whether the package should be
 * offered to guests.
 *
 * A separate error from a malformed slug: one names the wrong package, the
 * other asks the wrong question about the right one.
 */
export class InvalidAdminPackageStatusError extends Error {
  readonly code = INVALID_PACKAGE_STATUS_ERROR_CODE;

  constructor() {
    super(INVALID_PACKAGE_STATUS_ERROR_MESSAGE);
    this.name = 'InvalidAdminPackageStatusError';
  }
}

export function isInvalidAdminPackageStatusError(
  error: unknown,
): error is InvalidAdminPackageStatusError {
  return error instanceof InvalidAdminPackageStatusError;
}

/**
 * The package-level fields an administrator may supply when creating one.
 *
 * Deliberately excludes `isActive` and the management source. A new journey is
 * always created unpublished and always admin-owned; letting a request say
 * otherwise would let it publish something unreviewed, or claim an offering
 * the brochure seed would then overwrite.
 *
 * Child records — variants, rate tiers, itinerary sections, content items —
 * are not here either. This creates the parent row and nothing else.
 */
export type AdminPackageCreateInput = {
  code: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  durationLabel: string | null;
  scheduleLabel: string | null;
  operatingDays: string[] | null;
  requiresPriceConfirmation: boolean;
  sortOrder: number;
};

export const INVALID_ADMIN_PACKAGE_ERROR_CODE = 'INVALID_PACKAGE';
export const INVALID_ADMIN_PACKAGE_ERROR_MESSAGE = 'Invalid package details';

/**
 * The request body is not a package this system can create.
 *
 * One error for every field, deliberately: naming which field failed would
 * let a caller probe the rules one at a time, and an administrator filling in
 * a form is better served by the form's own field-level validation than by a
 * server message they cannot see in context. The message never echoes what
 * was supplied.
 */
export class InvalidAdminPackageError extends Error {
  readonly code = INVALID_ADMIN_PACKAGE_ERROR_CODE;

  constructor() {
    super(INVALID_ADMIN_PACKAGE_ERROR_MESSAGE);
    this.name = 'InvalidAdminPackageError';
  }
}

export function isInvalidAdminPackageError(error: unknown): error is InvalidAdminPackageError {
  return error instanceof InvalidAdminPackageError;
}

export const RESERVED_BROCHURE_IDENTITY_ERROR_CODE = 'RESERVED_BROCHURE_PACKAGE_IDENTITY';
export const RESERVED_BROCHURE_IDENTITY_ERROR_MESSAGE =
  'That code or slug belongs to the brochure catalogue';

/**
 * The request asked for an identity the brochure owns.
 *
 * A conflict rather than a bad request: the value is a perfectly well-formed
 * code or slug, and the reason it is refused is that something else already
 * has a claim on it — whether or not that row exists yet.
 */
export const RESERVED_BROCHURE_IDENTITY_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: RESERVED_BROCHURE_IDENTITY_ERROR_CODE,
    message: RESERVED_BROCHURE_IDENTITY_ERROR_MESSAGE,
  }),
});

export const PACKAGE_CODE_IN_USE_ERROR_CODE = 'PACKAGE_CODE_IN_USE';
export const PACKAGE_SLUG_IN_USE_ERROR_CODE = 'PACKAGE_SLUG_IN_USE';

/**
 * Which identity a database uniqueness conflict was about.
 *
 * Kept apart from the brochure case and from each other: an administrator who
 * reused a code needs to change a different field than one who reused a slug,
 * and both are different from having picked something the brochure owns.
 */
export const PACKAGE_CODE_IN_USE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_CODE_IN_USE_ERROR_CODE,
    message: 'Another package already uses that code',
  }),
});

export const PACKAGE_SLUG_IN_USE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_SLUG_IN_USE_ERROR_CODE,
    message: 'Another package already uses that slug',
  }),
});

/**
 * The package-level fields an administrator may change.
 *
 * `code` and `slug` are absent: they are the journey's identity, they appear
 * in its address, and reservations were taken against snapshots of them. They
 * are not editable in this slice and a request that offers one is refused
 * rather than having it quietly dropped.
 *
 * `isActive` is absent too — publication has its own endpoint, and folding it
 * into a general edit would let a wording change publish a journey by
 * accident. Ownership is absent because it is a consequence of editing, not
 * an input to it.
 */
export type AdminPackageUpdateInput = {
  title: string;
  summary: string | null;
  description: string | null;
  durationLabel: string | null;
  scheduleLabel: string | null;
  operatingDays: string[] | null;
  requiresPriceConfirmation: boolean;
  sortOrder: number;
};

/**
 * The variant metadata an administrator may change.
 *
 * `key`, `isDefault` and `sortOrder` are absent: they decide which variant a
 * reservation resolves to and in what order variants read, and changing any
 * of them touches a unique constraint. Rate tiers are absent because they
 * decide whether a journey can be booked at all. Each is its own later step.
 *
 * The child trio is all-or-nothing, exactly as the database CHECK states it:
 * three nulls, or three values.
 */
export type AdminPackageVariantUpdateInput = {
  label: string;
  childMinAge: number | null;
  childMaxAge: number | null;
  /** An exact two-decimal string, 0.00–100.00. Never a number. */
  childDiscountPercent: string | null;
};

export const INVALID_PACKAGE_VARIANT_KEY_ERROR_CODE = 'INVALID_PACKAGE_VARIANT_KEY';
export const INVALID_PACKAGE_VARIANT_KEY_ERROR_MESSAGE = 'Invalid package variant key';

/** The key in the URL is not a variant key at all. */
export class InvalidAdminPackageVariantKeyError extends Error {
  readonly code = INVALID_PACKAGE_VARIANT_KEY_ERROR_CODE;

  constructor() {
    super(INVALID_PACKAGE_VARIANT_KEY_ERROR_MESSAGE);
    this.name = 'InvalidAdminPackageVariantKeyError';
  }
}

export function isInvalidAdminPackageVariantKeyError(
  error: unknown,
): error is InvalidAdminPackageVariantKeyError {
  return error instanceof InvalidAdminPackageVariantKeyError;
}

export const PACKAGE_VARIANT_NOT_FOUND_ERROR_CODE = 'PACKAGE_VARIANT_NOT_FOUND';
export const PACKAGE_VARIANT_NOT_FOUND_ERROR_MESSAGE = 'Package variant not found';

/**
 * Distinct from `PACKAGE_NOT_FOUND`, and deliberately so: an administrator
 * who mistyped the journey needs to go somewhere different from one who
 * mistyped the variant. The code matches the vocabulary the public
 * reservation path already uses for the same fact.
 */
export const PACKAGE_VARIANT_NOT_FOUND_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_VARIANT_NOT_FOUND_ERROR_CODE,
    message: PACKAGE_VARIANT_NOT_FOUND_ERROR_MESSAGE,
  }),
});

/**
 * A new variant, as an administrator supplies it.
 *
 * `isDefault` and `sortOrder` are absent, and that is the point of the type.
 * Both decide something a reservation depends on — which variant is chosen
 * when a guest names none, and in what order the choices read — and both are
 * derived by the server from the variants that already exist. A request that
 * offers either is refused rather than having it quietly dropped.
 *
 * Rate tiers are absent too. A variant is created without any, and pricing it
 * is a separate step against its own sub-resource.
 */
export type AdminPackageVariantCreateInput = {
  key: string;
  label: string;
  childMinAge: number | null;
  childMaxAge: number | null;
  /** An exact two-decimal string, 0.00–100.00. Never a number. */
  childDiscountPercent: string | null;
};

export const PACKAGE_VARIANT_KEY_IN_USE_ERROR_CODE = 'PACKAGE_VARIANT_KEY_IN_USE';

/**
 * The journey already has a variant with that key.
 *
 * A conflict rather than a bad request: the key is perfectly well formed, and
 * the reason it is refused is that this journey has already used it. Keys are
 * unique per package, not globally, so the message says so.
 */
export const PACKAGE_VARIANT_KEY_IN_USE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_VARIANT_KEY_IN_USE_ERROR_CODE,
    message: 'This journey already has a variant with that key',
  }),
});

export const PACKAGE_MUST_BE_INACTIVE_ERROR_CODE = 'PACKAGE_MUST_BE_INACTIVE';

/**
 * A variant cannot be added to a journey guests can currently see.
 *
 * A new variant has no rate tiers — this endpoint creates none — so it is not
 * reservable at the moment it appears. Adding one to a live journey would put
 * a choice on the website that refuses every reservation made against it.
 *
 * `requiresPriceConfirmation` does not bypass this. A quoted-on-request
 * journey still resolves a rate before it accepts anything; being quoted
 * changes what the guest is told about the price, not whether a tier exists.
 *
 * Deactivating the journey is a real answer, and so is adding the variant
 * before publishing. Doing either on the administrator's behalf is not, so
 * this refuses and says which.
 */
export const PACKAGE_MUST_BE_INACTIVE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_MUST_BE_INACTIVE_ERROR_CODE,
    message:
      'A new variant has no rates yet, so it can only be added while the journey is inactive. '
      + 'Deactivate the journey first.',
  }),
});

/**
 * Which variant a journey should lead with.
 *
 * One field, because the operation is one fact: at most one variant of a
 * package carries the default flag, and this states which. It is modelled as
 * a slot on the package rather than a toggle on a variant — a per-variant
 * toggle would imply an "unset" that must not exist, since a multi-variant
 * journey with no default refuses every reservation that names no variant.
 */
export type AdminPackageDefaultVariantInput = {
  variantKey: string;
};

/**
 * The default cannot be moved on a journey guests can currently see.
 *
 * The same code the variant-create refusal uses, because it is the same rule
 * about the same state — but with its own message, because the reason differs.
 * Moving the default changes which variant an unqualified reservation
 * resolves to, and the new one may price differently, cover different party
 * sizes, or carry a different child rule. On a live journey that silently
 * rewrites what is being sold; on an inactive one there is nothing in flight
 * to rewrite.
 *
 * Nothing is deactivated on the administrator's behalf.
 */
export const PACKAGE_DEFAULT_VARIANT_MUST_BE_INACTIVE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_MUST_BE_INACTIVE_ERROR_CODE,
    message:
      'Changing which variant leads a journey changes what a booking without a named variant '
      + 'resolves to, so it is only allowed while the journey is inactive. '
      + 'Deactivate the journey first.',
  }),
});

export const PACKAGE_VARIANT_DEFAULT_UNSAFE_ERROR_CODE = 'PACKAGE_VARIANT_DEFAULT_UNSAFE';

/**
 * Adding a variant here would change which one a reservation resolves to.
 *
 * A journey with exactly one variant resolves to it when a guest names none,
 * whether or not it is flagged as the default. Add a second, and that
 * shortcut no longer applies: with no flagged default, a reservation that
 * named no variant would start being refused as ambiguous.
 *
 * This endpoint does not flag defaults — that is its own operation with its
 * own consequences — so rather than silently changing what an existing
 * reservation request means, it refuses and says what to fix first.
 */
export const PACKAGE_VARIANT_DEFAULT_UNSAFE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_VARIANT_DEFAULT_UNSAFE_ERROR_CODE,
    message:
      'This journey has one variant that is not marked as the default, so adding a second would '
      + 'change which variant a reservation without a named variant resolves to. '
      + 'Mark the existing variant as the default first.',
  }),
});

/**
 * The complete running order of a journey's variants.
 *
 * A whole list rather than a move command, and deliberately. A move is
 * interpreted against an order the client last saw, so two administrators
 * rearranging the same journey compose into something neither asked for. A
 * complete list states the end state: sending it twice leaves the same order,
 * and a list that no longer matches the journey is detectably stale rather
 * than silently half-applied.
 */
export type AdminPackageVariantOrderInput = {
  variantKeys: string[];
};

export const PACKAGE_VARIANT_SET_MISMATCH_ERROR_CODE = 'PACKAGE_VARIANT_SET_MISMATCH';

/**
 * The submitted order does not name every variant the journey has.
 *
 * A conflict rather than a bad request: each key is well formed and every one
 * of them exists, and what is wrong is that the list is not the whole set —
 * which nearly always means the page was rendered before a variant was added.
 *
 * Refused rather than repaired. Appending the missing variant, or leaving it
 * where it sits, would both invent a position the administrator never chose,
 * and would move a variant they never saw.
 */
export const PACKAGE_VARIANT_SET_MISMATCH_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_VARIANT_SET_MISMATCH_ERROR_CODE,
    message:
      'The submitted order must list every variant this journey has, exactly once. '
      + 'Reload the journey and try again.',
  }),
});

/**
 * A journey cannot be removed while guests can still see it.
 *
 * The same code the other publication refusals use, with its own message.
 * Deactivation is instant and reversible and is already the right tool for
 * "stop selling this"; requiring it first makes a permanent removal a
 * deliberate second step on something already withdrawn and observed, rather
 * than one click on a live product.
 *
 * Nothing is deactivated on the administrator's behalf.
 */
export const PACKAGE_DELETE_MUST_BE_INACTIVE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_MUST_BE_INACTIVE_ERROR_CODE,
    message:
      'A journey can only be deleted once it is inactive. Deactivate it first, check that it is '
      + 'gone from the website, then delete it.',
  }),
});

export const PACKAGE_IS_BROCHURE_MANAGED_ERROR_CODE = 'PACKAGE_IS_BROCHURE_MANAGED';

/**
 * This journey's identity belongs to the brochure catalogue.
 *
 * Refused because deleting it would not remove it. The catalogue seed looks
 * each brochure journey up by code or slug; finding no row, it inserts a
 * fresh one and marks it seed-owned again. So a hard delete here disappears
 * the journey until the next seed run and then silently restores it, under a
 * new id, with every administrator's edit lost.
 *
 * That applies whatever `seed_managed` currently says, which is why this is
 * judged on identity rather than ownership: the ownership flag lives on the
 * row, so deleting the row destroys the only record that anyone ever took
 * ownership of it.
 *
 * Deactivation is the real answer for a brochure journey, and it is durable —
 * the seed does not reconcile `is_active`, so a withdrawn brochure journey
 * stays withdrawn across reseeding.
 */
export const PACKAGE_IS_BROCHURE_MANAGED_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_IS_BROCHURE_MANAGED_ERROR_CODE,
    message:
      'This journey comes from the brochure catalogue, so it cannot be deleted: the catalogue '
      + 'seed would simply recreate it. Deactivate it instead to keep it off the public site.',
  }),
});

export const PACKAGE_HAS_RESERVATIONS_ERROR_CODE = 'PACKAGE_HAS_RESERVATIONS';

/**
 * Guests have booked this journey.
 *
 * `package_reservations` references its variants with ON DELETE RESTRICT, so
 * a booking against any variant blocks the whole journey. The status of those
 * bookings is irrelevant: a cancelled reservation is a record of what was
 * sold and holds the row exactly as a confirmed one does.
 *
 * The message names deactivation rather than implying that cancelling the
 * bookings would help. It would not — reservations are never removed by this
 * system, so a journey that has ever sold anything can never be deleted, and
 * sending an administrator to cancel bookings would be sending them nowhere.
 */
export const PACKAGE_HAS_RESERVATIONS_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_HAS_RESERVATIONS_ERROR_CODE,
    message:
      'This journey has bookings, and bookings are kept as a record of what was sold, so it '
      + 'cannot be deleted. It can stay deactivated instead.',
  }),
});

/**
 * A variant cannot be removed from a journey guests can currently see.
 *
 * The same code the other publication refusals use, with its own message.
 * Removing a variant is the most consequential of the three: it takes away
 * the thing a booking resolves to. A guest with the form already open is
 * refused, an unqualified booking either switches to a differently priced
 * variant or stops resolving at all, and the shopfront's "from" price can
 * move or vanish.
 *
 * Nothing is deactivated on the administrator's behalf.
 */
export const PACKAGE_VARIANT_DELETE_MUST_BE_INACTIVE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_MUST_BE_INACTIVE_ERROR_CODE,
    message:
      'Removing a variant changes what a booking resolves to, so it is only allowed while the '
      + 'journey is inactive. Deactivate the journey first.',
  }),
});

export const PACKAGE_VARIANT_IS_DEFAULT_ERROR_CODE = 'PACKAGE_VARIANT_IS_DEFAULT';

/**
 * The variant asked for is the one the journey leads with, and others remain.
 *
 * Refused rather than resolved. Promoting a successor would decide, silently
 * and inside a removal, which variant every unqualified booking resolves to
 * — and that decision changes coverage, the child rule and the price. The
 * endpoint that exists for it refuses to make it implicitly, and so does
 * this one.
 *
 * Leaving no default at all is worse than either: a multi-variant journey
 * without one refuses every booking that names no variant, and blocks adding
 * a variant too.
 *
 * The last remaining variant is deliberately not covered by this. There is no
 * successor to choose, so there is no choice being made.
 */
export const PACKAGE_VARIANT_IS_DEFAULT_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_VARIANT_IS_DEFAULT_ERROR_CODE,
    message:
      'This variant is the one the journey leads with, so it cannot be removed while others '
      + 'remain. Make another variant the default first.',
  }),
});

export const PACKAGE_VARIANT_HAS_RESERVATIONS_ERROR_CODE = 'PACKAGE_VARIANT_HAS_RESERVATIONS';

/**
 * Guests have booked this variant.
 *
 * `package_reservations` references `(variant_id, package_id)` with
 * ON DELETE RESTRICT, and the status of those reservations is irrelevant: a
 * cancelled booking holds the variant exactly as a confirmed one does,
 * because it is a record of what was sold.
 *
 * The message offers no remedy on purpose. Reservations are never deleted by
 * this system — the admin API only moves them between pending, confirmed and
 * cancelled — so a variant that has ever been booked cannot be removed at
 * all, and implying otherwise would send an administrator looking for a door
 * that does not exist.
 */
export const PACKAGE_VARIANT_HAS_RESERVATIONS_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_VARIANT_HAS_RESERVATIONS_ERROR_CODE,
    message:
      'This variant has been booked, and bookings are kept as a record of what was sold, so it '
      + 'cannot be removed.',
  }),
});

export const PACKAGE_VARIANT_ORDER_EXHAUSTED_ERROR_CODE = 'PACKAGE_VARIANT_ORDER_EXHAUSTED';

/**
 * There is no position left to append a variant to.
 *
 * `package_variants.sort_order` is an int4, and this endpoint appends at the
 * end. A journey whose highest position is already the largest integer the
 * column holds has nowhere to put another one.
 *
 * Reported as a conflict, and reported at all: the alternative is writing a
 * value that overflows mid-statement and surfacing as a 500 nobody can act
 * on. Renumbering the existing variants would fix it, and that is a
 * reordering operation, which this endpoint is not.
 */
export const PACKAGE_VARIANT_ORDER_EXHAUSTED_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: PACKAGE_VARIANT_ORDER_EXHAUSTED_ERROR_CODE,
    message: 'This journey has no ordering position left for another variant',
  }),
});

/**
 * The whole itinerary an administrator may replace.
 *
 * The section shape is `AdminPackageItinerarySection` itself rather than a
 * separate input type: what a caller may send here is exactly what a read
 * gives back, field for field, so declaring a second identical type would
 * only create two places to keep in step.
 *
 * `sortOrder` is absent, and there is nowhere in this shape to put one.
 * Position in the array is the order, and the server derives the rest — a
 * client-supplied position would be a second source of truth for the same
 * fact.
 *
 * Both nullable fields carry meaning rather than absence. A null `dayNumber`
 * is a section belonging to the whole journey rather than to a day, and a
 * null `heading` is an unheaded passage. Neither is a missing value to be
 * defaulted, and neither may be spelled as an empty string.
 */
export type AdminPackageItineraryReplacementInput = {
  sections: AdminPackageItinerarySection[];
};

/**
 * The three content lists an administrator may replace.
 *
 * Three named arrays rather than a flat list of `{ kind, text }`, and that is
 * the point of the shape: a fourth kind cannot be expressed, so there is no
 * invalid-kind error to define and no way for a caller to invent one. The
 * database's `kind` CHECK becomes unreachable through this endpoint.
 *
 * `notes` is the vocabulary the contract already uses — the detail DTO has
 * exposed it since the catalogue was first read — while the stored kind is
 * the singular `note`. The translation lives in exactly one place, at the
 * write, and nowhere else.
 *
 * All three are required. An omitted list would be ambiguous between "leave
 * it alone" and "clear it", which is the same reason a package edit requires
 * every field rather than accepting a partial patch.
 *
 * Order within each list is authoritative: it is what the guest reads, and
 * `sort_order` is derived from it. Duplicates are allowed, because two items
 * can legitimately read alike and nothing is keyed on the text.
 */
export type AdminPackageContentReplacementInput = {
  included: string[];
  excluded: string[];
  notes: string[];
};

/**
 * One replacement rate tier, as an administrator supplies it.
 *
 * `currency` is absent on purpose. Every tier is USD — the column has a CHECK
 * saying so — and a client-supplied currency would be a value the system
 * could only ever refuse or ignore. It is written as a literal instead.
 */
export type AdminPackageRateTierInput = {
  minPartySize: number;
  /** null is an open-ended tier: "3 or more". */
  maxPartySize: number | null;
  /** An exact two-decimal string. Never a number. */
  adultUnitRate: string;
};

/**
 * The whole rate set for one variant.
 *
 * A replacement, not a patch: the administrator states what the tiers are,
 * and the transaction makes that true. There is no way to add or remove one
 * tier in isolation, which is what keeps the set from drifting into an
 * overlapping or gapped state one edit at a time.
 */
export type AdminPackageRatesReplacementInput = {
  rates: AdminPackageRateTierInput[];
};

export const OVERLAPPING_RATE_TIERS_ERROR_CODE = 'OVERLAPPING_RATE_TIERS';

/**
 * Two tiers cover the same party size.
 *
 * A conflict rather than a bad request: each tier is well formed, and what is
 * wrong is the relationship between them. The database says the same thing
 * with an exclusion constraint; this is the readable version of it.
 */
export const OVERLAPPING_RATE_TIERS_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: OVERLAPPING_RATE_TIERS_ERROR_CODE,
    message: 'Rate tiers must not cover overlapping party sizes',
  }),
});

export const RATES_REQUIRED_ERROR_CODE = 'PACKAGE_RATES_REQUIRED';

/**
 * An active, deterministically-priced journey cannot have no rates.
 *
 * It would still be on the website, and every reservation attempt would be
 * refused for want of a rate. Withdrawing the journey or marking it quoted on
 * request are both real answers; silently doing either on the administrator's
 * behalf is not, so this refuses and says which.
 */
export const RATES_REQUIRED_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: RATES_REQUIRED_ERROR_CODE,
    message:
      'An active journey priced from its rate tiers must keep at least one. '
      + 'Deactivate it, or mark it quoted on request, first.',
  }),
});

/**
 * Two tiers cover the same party size, caught before any row was touched.
 *
 * An error class rather than an outcome value because it is raised from the
 * validator, alongside the other malformed-input errors — but the controller
 * answers it with 409, not 400: the tiers are well formed, and what is wrong
 * is how they sit together.
 */
export class OverlappingRateTiersError extends Error {
  readonly code = OVERLAPPING_RATE_TIERS_ERROR_CODE;

  constructor() {
    super('Rate tiers must not cover overlapping party sizes');
    this.name = 'OverlappingRateTiersError';
  }
}

export function isOverlappingRateTiersError(error: unknown): error is OverlappingRateTiersError {
  return error instanceof OverlappingRateTiersError;
}
