import type { QueryResult, QueryResultRow } from '../../db/pool';
import { dbPool } from '../../db/pool';
import { parseMediaReference } from '../media/media.validation';
import {
  isReservedBrochureCode,
  isReservedBrochureSlug,
} from './admin-packages.brochure';
import {
  isUnreadableVariantSortOrderError,
  isVariantSortOrderExhaustedError,
  parkPackageVariantSortOrders,
} from '../../db/packageVariantOrdering';
import type {
  AdminPackageContent,
  AdminPackageContentReplacementInput,
  AdminPackageCreateInput,
  AdminPackageDetailRecord,
  AdminPackageImageRecord,
  AdminPackageItinerarySection,
  AdminPackageList,
  AdminPackageListItem,
  AdminPackageManagementSource,
  AdminPackageRateTier,
  AdminPackageRateTierInput,
  AdminPackageUpdateInput,
  AdminPackageVariant,
  AdminPackageVariantCreateInput,
  AdminPackageVariantUpdateInput,
} from './admin-packages.types';

/**
 * One row of the list query, named exactly as PostgreSQL returns it.
 *
 * `variant_count` is cast to int in SQL: COUNT() is a bigint, which `pg`
 * hands back as a string, and a count is small enough that int is the honest
 * type for it.
 */
type AdminPackageListRow = {
  code: string;
  slug: string;
  title: string;
  summary: string | null;
  duration_label: string | null;
  schedule_label: string | null;
  requires_price_confirmation: boolean;
  is_active: boolean;
  sort_order: number;
  seed_managed: boolean;
  variant_count: number;
  default_variant_label: string | null;
};

/** The list row plus everything a single package carries. */
type AdminPackageDetailRow = AdminPackageListRow & {
  description: string | null;
  operating_days: string[] | null;
  itinerary: unknown;
  content: unknown;
  variants: unknown;
  /** The journey's one image as a jsonb object, or null. */
  image: unknown;
};

/**
 * What this module needs from a database handle, and nothing more.
 *
 * Read-only and single-statement, so a `PoolClient` would mean borrowing a
 * connection and owning its release for no gain.
 */
type Queryable = {
  query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

let queryable: Queryable = dbPool;

/** Swaps the database handle for a test double. Null restores the real pool. */
export function __setQueryableForTests(handle: Queryable | null): void {
  queryable = handle ?? dbPool;
}

/**
 * Guards against stored data the schema's own constraints say cannot exist.
 * A boolean column is NOT NULL, so anything else is a data or migration
 * problem and raises rather than being softened into a default.
 */
function requireBoolean(field: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Unexpected package ${field} from the database: ${String(value)}`);
  }

  return value;
}

function requireWholeNumber(field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Unexpected package ${field} from the database: ${String(value)}`);
  }

  return value;
}

/**
 * A NOT NULL text column, re-proved rather than trusted.
 *
 * Used for the one value that leaves this module and is then handed to object
 * storage. An empty or absent storage key is not something the schema admits
 * — `media_assets.storage_key` is NOT NULL and UNIQUE — so reaching this is a
 * data or migration problem, and raising is better than asking R2 to delete
 * an object named by the empty string.
 */
function requireText(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Unexpected package ${field} from the database: expected a non-empty value`);
  }

  return value;
}

/**
 * Translates the storage boolean into the contract's vocabulary.
 *
 * The one place `seed_managed` is read, and the one place the mapping is
 * stated — so `false` can never be read the wrong way round twice.
 */
function toManagementSource(seedManaged: boolean): AdminPackageManagementSource {
  return seedManaged ? 'brochure' : 'admin';
}

/**
 * Maps one row onto the locked list contract, field by field and never
 * spread, so a column added to the SELECT later cannot reach a response just
 * by existing.
 */
export function toAdminPackageListItem(row: AdminPackageListRow): AdminPackageListItem {
  return {
    code: row.code,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    durationLabel: row.duration_label,
    scheduleLabel: row.schedule_label,
    requiresPriceConfirmation: requireBoolean('requires_price_confirmation', row.requires_price_confirmation),
    isActive: requireBoolean('is_active', row.is_active),
    sortOrder: requireWholeNumber('sort_order', row.sort_order),
    managementSource: toManagementSource(requireBoolean('seed_managed', row.seed_managed)),
    variantCount: requireWholeNumber('variant_count', row.variant_count),
    defaultVariantLabel: row.default_variant_label,
  };
}

/**
 * Every package, active or not, in the catalogue's running order.
 *
 * ONE query, whatever the variant counts. The variant summary is an aggregate
 * over a LEFT JOIN rather than a lookup per package, so a catalogue of
 * forty-two offerings costs exactly one statement and so would four hundred.
 * The LEFT JOIN is what keeps a package with no variants in the list at all,
 * with a count of zero rather than a missing row.
 *
 * `GROUP BY p.id` is legal against every selected column because `id` is the
 * primary key, so PostgreSQL knows the rest are functionally dependent on it.
 * `id` is grouped by and never selected.
 *
 * `default_variant_label` needs no tie-break: a partial unique index on
 * `(package_id) WHERE is_default` means at most one variant per package can
 * match the filter, so the aggregate sees one value or none.
 *
 * No rate tier, itinerary section or content item is touched. This endpoint
 * reads no price at all.
 */
export async function findAdminPackages(): Promise<AdminPackageList> {
  const { rows } = await queryable.query<AdminPackageListRow>(
    `SELECT p.code,
            p.slug,
            p.title,
            p.summary,
            p.duration_label,
            p.schedule_label,
            p.requires_price_confirmation,
            p.is_active,
            p.sort_order,
            p.seed_managed,
            -- COUNT(pv.id), not COUNT(*): the LEFT JOIN yields one all-NULL
            -- row for a package with no variants, which COUNT(*) would call 1.
            COUNT(pv.id)::int AS variant_count,
            MAX(pv.label) FILTER (WHERE pv.is_default) AS default_variant_label
       FROM packages p
       LEFT JOIN package_variants pv ON pv.package_id = p.id
      GROUP BY p.id
      -- code breaks sort_order ties so the order is total rather than merely
      -- mostly-stable; duplicate sort orders are legal on packages, and a row
      -- for an admin-owned offering the seed skips can share one.
      ORDER BY p.sort_order ASC, p.code ASC`,
  );

  return { packages: rows.map(toAdminPackageListItem) };
}

// ---------------------------------------------------------------------------
// One package, in full
// ---------------------------------------------------------------------------

/**
 * Narrowing for the jsonb payloads below.
 *
 * Deliberately this module's own rather than borrowed from the public
 * catalogue's mapping, whose equivalents are private to it. Duplicating a
 * handful of type checks is cheaper than widening another module's surface to
 * share them, and it keeps the admin DTO boundary this module's alone.
 */
function invalidRow(): never {
  throw new Error('Invalid admin package catalogue row');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidRow();
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalidRow();
}

function asText(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : invalidRow();
}

function asNullableText(value: unknown): string | null {
  return value === null ? null : asText(value);
}

function asBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalidRow();
}

function asInteger(value: unknown, minimum = 1): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= 2147483647
    ? value
    : invalidRow();
}

/** Exact two-decimal money, as a string. Never parsed into a number. */
function asDecimal(value: unknown): string {
  return typeof value === 'string' && /^(?:0|[1-9]\d{0,9})\.\d{2}(?![\s\S])/.test(value)
    ? value
    : invalidRow();
}

function asCurrency(value: unknown): 'USD' {
  return value === 'USD' ? 'USD' : invalidRow();
}

function toRateTier(value: unknown): AdminPackageRateTier {
  const row = asRecord(value);
  const minPartySize = asInteger(row.min_party_size);
  const maxPartySize = row.max_party_size === null ? null : asInteger(row.max_party_size);

  if (maxPartySize !== null && maxPartySize < minPartySize) invalidRow();

  return {
    minPartySize,
    maxPartySize,
    adultUnitRate: asDecimal(row.adult_unit_rate),
    currency: asCurrency(row.currency),
  };
}

function toVariant(value: unknown): AdminPackageVariant {
  const row = asRecord(value);
  const childMinAge = row.child_min_age === null ? null : asInteger(row.child_min_age, 0);
  const childMaxAge = row.child_max_age === null ? null : asInteger(row.child_max_age, 0);
  const childDiscountPercent =
    row.child_discount_percent === null ? null : asDecimal(row.child_discount_percent);

  // The schema's child-pricing CHECK makes the trio all-or-nothing; read back
  // the same way, so a row that somehow broke it raises rather than being
  // served as a variant with half a child rule.
  if ([childMinAge, childMaxAge, childDiscountPercent].some((field) => field !== null)) {
    if (childMinAge === null || childMaxAge === null || childDiscountPercent === null
      || childMaxAge < childMinAge) {
      invalidRow();
    }
  }

  return {
    key: asText(row.key),
    label: asText(row.label),
    isDefault: asBoolean(row.is_default),
    sortOrder: asInteger(row.sort_order, 0),
    childMinAge,
    childMaxAge,
    childDiscountPercent,
    rates: asArray(row.rates).map(toRateTier),
  };
}

/** Groups the flat `{ kind, text }` rows into the three kinds the CHECK allows. */
function toContent(value: unknown): AdminPackageContent {
  const content: AdminPackageContent = { included: [], excluded: [], notes: [] };

  for (const entry of asArray(value)) {
    const item = asRecord(entry);

    if (item.kind !== 'included' && item.kind !== 'excluded' && item.kind !== 'note') {
      invalidRow();
    }

    content[item.kind === 'note' ? 'notes' : item.kind].push(asText(item.text));
  }

  return content;
}

/**
 * The journey's image, or nothing.
 *
 * Fail-closed like every other mapper here: a malformed media row is this
 * system's own data being wrong, and it raises rather than being coerced
 * into `image: null`, which would look exactly like a journey that simply
 * has no picture.
 *
 * The reference is checked by the shared media parser rather than by a
 * second copy of that rule — it is the same canonical form the object key is
 * built from, and anything else was never issued by this system. The
 * dimensions go through the same `asInteger` every other count here uses,
 * and its `minimum = 1` matches `media_assets_width_check`.
 *
 * `alt_text` is accepted as any text or null, exactly as the column admits
 * it. `asNullableText` would refuse a whitespace-only string: the
 * application never stores one, but the schema permits it and a legal row
 * must not raise.
 *
 * No URL is composed here and no configuration is read. This module maps
 * rows; turning a reference into an address needs the deployment's public
 * media base, and that belongs at the HTTP boundary.
 */
function toAdminPackageImageRecord(value: unknown): AdminPackageImageRecord | null {
  if (value === null || value === undefined) {
    return value === null ? null : invalidRow();
  }

  const row = asRecord(value);
  const reference = parseMediaReference(row.reference);

  if (reference === null) {
    invalidRow();
  }

  const altText = row.alt_text;

  if (altText !== null && typeof altText !== 'string') {
    invalidRow();
  }

  return { reference, altText, width: asInteger(row.width), height: asInteger(row.height) };
}

export function toAdminPackageDetail(row: AdminPackageDetailRow): AdminPackageDetailRecord {
  const operatingDays = row.operating_days === null ? null : asArray(row.operating_days).map(asText);

  return {
    ...toAdminPackageListItem(row),
    description: asNullableText(row.description),
    operatingDays,
    itinerary: asArray(row.itinerary).map((value) => {
      const section = asRecord(value);
      return {
        dayNumber: section.day_number === null ? null : asInteger(section.day_number),
        heading: asNullableText(section.heading),
        body: asText(section.body),
      };
    }),
    content: toContent(row.content),
    variants: asArray(row.variants).map(toVariant),
    image: toAdminPackageImageRecord(row.image),
  };
}

/**
 * Every column the detail contract needs, aliased to `p`.
 *
 * Hoisted so the read below and the status update further down project the
 * identical shape from the identical orderings. Two copies of a projection
 * this size would drift, and a status change that answered with a subtly
 * different package than a plain read would be a difference nobody would
 * think to look for.
 */
const PACKAGE_DETAIL_COLUMNS = `p.code,
            p.slug,
            p.title,
            p.summary,
            p.duration_label,
            p.schedule_label,
            p.requires_price_confirmation,
            p.is_active,
            p.sort_order,
            p.seed_managed,
            p.description,
            p.operating_days,
            (SELECT COUNT(*)::int FROM package_variants v WHERE v.package_id = p.id) AS variant_count,
            (SELECT v.label FROM package_variants v
              WHERE v.package_id = p.id AND v.is_default) AS default_variant_label,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'day_number', s.day_number, 'heading', s.heading, 'body', s.body)
                ORDER BY s.sort_order)
              FROM package_itinerary_sections s WHERE s.package_id = p.id), '[]'::jsonb) AS itinerary,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', c.kind, 'text', c.text)
                ORDER BY c.kind, c.sort_order)
              FROM package_content_items c WHERE c.package_id = p.id), '[]'::jsonb) AS content,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'key', v.key, 'label', v.label, 'is_default', v.is_default,
                'sort_order', v.sort_order,
                'child_min_age', v.child_min_age, 'child_max_age', v.child_max_age,
                'child_discount_percent', v.child_discount_percent::text,
                'rates', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'min_party_size', r.min_party_size, 'max_party_size', r.max_party_size,
                    'adult_unit_rate', r.adult_unit_rate::text, 'currency', r.currency)
                    ORDER BY r.min_party_size)
                  FROM package_rate_tiers r WHERE r.variant_id = v.id), '[]'::jsonb))
                ORDER BY v.sort_order, v.key)
              FROM package_variants v WHERE v.package_id = p.id), '[]'::jsonb) AS variants,
            (SELECT jsonb_build_object(
                'reference', ma.reference, 'alt_text', pm.alt_text,
                'width', ma.width, 'height', ma.height)
              FROM package_media pm
              JOIN media_assets ma ON ma.id = pm.media_asset_id
              WHERE pm.package_id = p.id) AS image`;

/**
 * Reads one package by slug, active or not, with everything it owns.
 *
 * ONE statement, so parent and children are a consistent snapshot without a
 * transaction or a row lock. The children arrive as `jsonb_agg` aggregates,
 * the same shape the public catalogue's detail query already uses.
 *
 * The four orderings are reused from that query verbatim, so the admin view
 * and the public site can never disagree about sequence:
 *
 *   itinerary  ORDER BY s.sort_order
 *   content    ORDER BY c.kind, c.sort_order
 *   variants   ORDER BY v.sort_order, v.key
 *   rates      ORDER BY r.min_party_size
 *
 * `v.key` breaks a variant tie that `UNIQUE (package_id, sort_order)` already
 * makes impossible; it stays because the public query has it, and a matching
 * clause is worth more than a shorter one.
 *
 * Two deliberate differences from the public query. There is no
 * `is_active = true` filter — an administrator manages retired offerings too —
 * and there is no "from" rate, which is a shopfront summary rather than
 * anything to manage. No price is computed here; every figure is read.
 *
 * `COALESCE(..., '[]'::jsonb)` on each aggregate means a package with no
 * itinerary, no content or no variants comes back with empty arrays rather
 * than nulls the caller would have to defend against.
 */
export async function findAdminPackageBySlug(slug: string): Promise<AdminPackageDetailRecord | null> {
  const { rows } = await queryable.query<AdminPackageDetailRow>(
    `SELECT ${PACKAGE_DETAIL_COLUMNS}
       FROM packages p
      WHERE p.slug = $1`,
    [slug],
  );

  const row = rows[0];

  return row ? toAdminPackageDetail(row) : null;
}

// ---------------------------------------------------------------------------
// Creating a journey
// ---------------------------------------------------------------------------

/** Which identity a uniqueness conflict was about, or a created package. */
export type AdminPackageCreateResult =
  | { outcome: 'created'; package: AdminPackageDetailRecord }
  | { outcome: 'code-in-use' }
  | { outcome: 'slug-in-use' };

const UNIQUE_VIOLATION = '23505';
const CODE_CONSTRAINT = 'packages_code_key';
const SLUG_CONSTRAINT = 'packages_slug_key';

/**
 * Reads the constraint a PostgreSQL error names, if it named one.
 *
 * `pg` attaches `constraint` for an integrity violation. Matched on that
 * rather than on the message text, which is localised and unversioned.
 */
function violatedConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;

  const candidate = error as { code?: unknown; constraint?: unknown };

  if (candidate.code !== UNIQUE_VIOLATION || typeof candidate.constraint !== 'string') {
    return null;
  }

  return candidate.constraint;
}

/**
 * Creates one admin-owned journey and answers with the whole thing.
 *
 * ONE statement. The INSERT is a CTE whose RETURNING feeds the same detail
 * projection a plain read uses, so the caller gets the created package
 * without a second query that could observe a different row. No BEGIN/COMMIT:
 * a single statement is already atomic.
 *
 * `is_active` and `seed_managed` are written as literal `false` here, not
 * bound parameters. They are not inputs with defaults — there is no value a
 * request could supply that would reach them — so a new journey is always
 * unpublished and always admin-owned, and the catalogue seed will always
 * leave it alone.
 *
 * A uniqueness conflict is translated rather than thrown. The database is the
 * only place that can answer "is this code already taken" without a race, so
 * the insert asks it by trying, and reads which constraint refused. Anything
 * else — a check violation, a lost connection — is a real fault and still
 * propagates.
 */
export async function insertAdminPackage(
  input: AdminPackageCreateInput,
): Promise<AdminPackageCreateResult> {
  let rows: AdminPackageDetailRow[];

  try {
    ({ rows } = await queryable.query<AdminPackageDetailRow>(
      `WITH inserted AS (
         INSERT INTO packages (
           code, slug, title, summary, description, duration_label, schedule_label,
           operating_days, requires_price_confirmation, sort_order,
           is_active, seed_managed
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, false)
         RETURNING *
       )
       SELECT ${PACKAGE_DETAIL_COLUMNS}
         FROM inserted p`,
      [
        input.code,
        input.slug,
        input.title,
        input.summary,
        input.description,
        input.durationLabel,
        input.scheduleLabel,
        input.operatingDays,
        input.requiresPriceConfirmation,
        input.sortOrder,
      ],
    ));
  } catch (error) {
    const constraint = violatedConstraint(error);

    if (constraint === CODE_CONSTRAINT) return { outcome: 'code-in-use' };
    if (constraint === SLUG_CONSTRAINT) return { outcome: 'slug-in-use' };

    throw error;
  }

  const row = rows[0];

  if (!row) {
    throw new Error('Package insert returned no row');
  }

  return { outcome: 'created', package: toAdminPackageDetail(row) };
}

// ---------------------------------------------------------------------------
// Editing a journey
// ---------------------------------------------------------------------------

/**
 * Rewrites one journey's package-level fields, and takes ownership of it.
 *
 * ONE statement. The UPDATE is a CTE whose RETURNING feeds the same detail
 * projection a plain read uses, so there is no read-then-write window and no
 * second query that could observe a different row than the one just written.
 * No BEGIN/COMMIT: a single statement is already atomic.
 *
 * `seed_managed = false` is written in the SAME SET clause as the edit, and
 * that is the load-bearing part of this function. The catalogue seed rewrites
 * every one of these fields for a package it still owns, so an edit that did
 * not take ownership would be undone on the next seed run — silently, and
 * possibly weeks later. Doing it in one statement means a journey can never
 * be left edited-but-still-brochure-owned, not even for the width of a
 * transaction.
 *
 * It is written unconditionally rather than only when it is currently true:
 * setting false to false costs nothing, and a conditional would be a second
 * way of saying the same thing that could disagree with the first.
 *
 * `is_active` is absent from the SET clause. Publication has its own
 * endpoint, and a wording change must never put a journey in front of guests.
 * `code` and `slug` are absent because they are the journey's identity.
 * No child table is named here at all.
 */
export async function updateAdminPackageFields(
  slug: string,
  input: AdminPackageUpdateInput,
): Promise<AdminPackageDetailRecord | null> {
  const { rows } = await queryable.query<AdminPackageDetailRow>(
    `WITH updated AS (
       UPDATE packages
          SET title = $2,
              summary = $3,
              description = $4,
              duration_label = $5,
              schedule_label = $6,
              operating_days = $7,
              requires_price_confirmation = $8,
              sort_order = $9,
              -- Editing a journey is what makes it the administrator's. The
              -- seed must stop reconciling it from this moment, so ownership
              -- moves in the same write as the change that needs protecting.
              seed_managed = false,
              updated_at = now()
        WHERE slug = $1
       RETURNING *
     )
     SELECT ${PACKAGE_DETAIL_COLUMNS}
       FROM updated p`,
    [
      slug,
      input.title,
      input.summary,
      input.description,
      input.durationLabel,
      input.scheduleLabel,
      input.operatingDays,
      input.requiresPriceConfirmation,
      input.sortOrder,
    ],
  );

  const row = rows[0];

  return row ? toAdminPackageDetail(row) : null;
}

// ---------------------------------------------------------------------------
// Editing one variant's metadata
// ---------------------------------------------------------------------------

/** What the edit found, before any HTTP meaning is attached to it. */
export type AdminPackageVariantEditResult =
  | { outcome: 'updated'; package: AdminPackageDetailRecord }
  | { outcome: 'package-not-found' }
  | { outcome: 'variant-not-found' };

/** What this module needs from a pooled connection, and nothing more. */
type ClientLike = {
  query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
  release(discard?: boolean): void;
};

type ClientFactory = () => Promise<ClientLike>;

const defaultClientFactory: ClientFactory = () => dbPool.connect() as unknown as Promise<ClientLike>;

let acquireClient: ClientFactory = defaultClientFactory;

/**
 * Swaps the connection source for a test double. Mirrors the seam in
 * `package-reservations.service.ts`. Passing null restores the real pool.
 */
export function __setClientFactoryForTests(factory: ClientFactory | null): void {
  acquireClient = factory ?? defaultClientFactory;
}

/**
 * Rewrites one variant's metadata, and takes ownership of its package.
 *
 * A transaction rather than the single data-modifying CTE the other writes in
 * this module use, and deliberately so. A CTE's writes are invisible to the
 * rest of the same statement: it shares one snapshot, so a projection reading
 * `package_variants` alongside an UPDATE of it would return the row as it was
 * BEFORE the edit. Returning a detail DTO that still showed the old label
 * would be worse than any amount of extra ceremony — so the work happens in
 * one transaction, where the final read does see both writes.
 *
 * It is one transaction on one connection, taken from the pool explicitly.
 * Running BEGIN on the pool itself would be a real bug: successive queries
 * could land on different connections and the statements would not share a
 * transaction at all.
 *
 * The parent package is locked with `FOR UPDATE` first and the variant row
 * second, so two administrators editing the same variant serialize rather
 * than racing, and there is no read-then-write window. That order is the
 * canonical one — the catalogue seed, the public reservation path and every
 * other write in this module take the package before its children — and it
 * is what this function was changed to. Locking the variant first and only
 * then writing to its package, which the ownership flip below does, put this
 * path in a deadlock cycle with all of them.
 *
 * Ownership moves only when the variant was actually found. A package whose
 * variant does not exist is left exactly as it was — including its
 * `seed_managed` — so a mistyped key can never quietly detach a journey from
 * the brochure catalogue.
 *
 * Four columns are written on the variant and two on its package. `key`,
 * `is_default` and `sort_order` are untouched, no rate tier, itinerary
 * section or content item is named, and `is_active` is not in either
 * statement: editing a variant never publishes or withdraws a journey.
 */
export async function updateAdminPackageVariant(
  slug: string,
  key: string,
  input: AdminPackageVariantUpdateInput,
): Promise<AdminPackageVariantEditResult> {
  const client = await acquireClient();
  let transaction = false;
  let discardClient = false;

  try {
    await client.query('BEGIN');
    transaction = true;

    // The parent first, then the variant: the canonical order this module,
    // the catalogue seed and the public reservation path all take. Locking
    // the variant first and only afterwards writing to its package — which
    // the ownership flip below does — would complete a deadlock cycle with
    // every path that takes them the other way round.
    const parent = await client.query<{ id: string }>(
      'SELECT id FROM packages WHERE slug = $1 FOR UPDATE',
      [slug],
    );

    const pkg = parent.rows[0];

    if (!pkg) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-not-found' };
    }

    const target = await client.query<{ id: string }>(
      `SELECT id
         FROM package_variants
        WHERE package_id = $1
          AND key = $2
        FOR UPDATE`,
      [pkg.id, key],
    );

    const found = target.rows[0];

    if (!found) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'variant-not-found' };
    }

    await client.query(
      `UPDATE package_variants
          SET label = $2,
              child_min_age = $3,
              child_max_age = $4,
              child_discount_percent = $5
        WHERE id = $1`,
      [found.id, input.label, input.childMinAge, input.childMaxAge, input.childDiscountPercent],
    );

    // The seed rewrites a variant's label and child rule for a package it
    // still owns, so an edit that did not take ownership would be undone on
    // the next run. Same transaction as the edit, so the two cannot separate.
    await client.query(
      'UPDATE packages SET seed_managed = false, updated_at = now() WHERE id = $1',
      [pkg.id],
    );

    // Read inside the transaction, so it sees both writes above.
    const detail = await client.query<AdminPackageDetailRow>(
      `SELECT ${PACKAGE_DETAIL_COLUMNS}
         FROM packages p
        WHERE p.id = $1`,
      [pkg.id],
    );

    const row = detail.rows[0];

    if (!row) {
      throw new Error('Package disappeared during a variant edit');
    }

    const updated = toAdminPackageDetail(row);

    // Cleared BEFORE the COMMIT is issued, not after. A COMMIT that throws
    // leaves an outcome nobody can know: the transaction may well have
    // been applied, so it is not ours to roll back, and the catch below
    // must not try. Clearing it first is what routes that case to the
    // discard-the-connection branch instead.
    transaction = false;
    await client.query('COMMIT');

    return { outcome: 'updated', package: updated };
  } catch (error) {
    if (transaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection is already unusable; poisoning it below is the only
        // remaining cleanup, and the original error is the one worth raising.
        discardClient = true;
      }
    } else {
      // BEGIN never succeeded, or COMMIT itself threw. In the COMMIT case the
      // outcome is genuinely unknown, so no ROLLBACK is sent after the fact
      // and the connection is not reused.
      discardClient = true;
    }

    throw error;
  } finally {
    client.release(discardClient);
  }
}

// ---------------------------------------------------------------------------
// Adding one variant to a journey
// ---------------------------------------------------------------------------

/** What the creation found, before any HTTP meaning is attached to it. */
export type AdminPackageVariantCreateResult =
  | { outcome: 'created'; package: AdminPackageDetailRecord }
  | { outcome: 'package-not-found' }
  | { outcome: 'package-active' }
  | { outcome: 'key-in-use' }
  | { outcome: 'unsafe-default-state' }
  | { outcome: 'order-exhausted' };

const VARIANT_KEY_CONSTRAINT = 'package_variants_package_key_key';

/** `package_variants.sort_order` is an int4. */
const POSTGRES_INTEGER_MAX = 2147483647;

/**
 * What the journey's existing variants say about adding another.
 *
 * Read as one aggregate rather than three queries, and read under the
 * package lock so the three figures describe one moment.
 */
type VariantContext = {
  variant_count: number;
  default_count: number;
  max_sort_order: number;
};

/**
 * Creates one variant on an existing journey, and takes ownership of it.
 *
 * A transaction on one connection, for the same reason the sibling writes in
 * this module use one: the final read has to see the insert, and a
 * data-modifying CTE's writes are invisible to the rest of its own statement.
 * It also has a second job here — every decision below is made from state
 * that must not change between reading it and writing.
 *
 * The PACKAGE row is locked, not the variant row, and that is the whole
 * concurrency story. There is no variant row to lock yet: what has to hold
 * still is the set of variants the journey already has, because the new
 * row's position, its default flag and whether it may be added at all are
 * all derived from that set. Locking the parent is what makes two
 * simultaneous creates against the same journey serialize — the second waits
 * for the first to commit, then counts the row the first inserted, rather
 * than both reading "one variant" and both appending at the same position.
 * It is also the row the public reservation path takes a share lock on, so
 * this can never interleave with a booking mid-flight.
 *
 * Three things are decided under that lock, in this order:
 *
 *   Publication. A new variant has no rate tiers, so it is not reservable the
 *   moment it appears. It may therefore only be added while the journey is
 *   inactive. `requires_price_confirmation` is deliberately not consulted:
 *   a quoted-on-request journey still resolves a rate tier before accepting
 *   anything, so a rate-less variant is no more bookable there than anywhere
 *   else. Nothing is deactivated on the administrator's behalf.
 *
 *   Implicit selection. A reservation that names no variant resolves to the
 *   lone variant when a journey has exactly one, whatever its default flag.
 *   Adding a second to a journey whose only variant is NOT flagged would
 *   silently turn those reservations into ambiguous ones. That state is
 *   refused rather than changed. Every other shape is safe: from zero, the
 *   new variant becomes the default and is the lone one; from one flagged
 *   variant, the flag keeps resolving it; from two or more, whatever the
 *   journey resolved to before, it still resolves to.
 *
 *   Position. Appended at the end, one past the highest in use, so no
 *   existing variant moves and `UNIQUE (package_id, sort_order)` cannot be
 *   tripped. An empty journey starts at 1, matching the brochure seed's own
 *   numbering. The int4 ceiling is checked by comparison, never by writing a
 *   value and seeing whether it overflows.
 *
 * Ownership moves only when the variant is actually created. A missing
 * journey, an active one, an unsafe default state, a duplicate key and an
 * exhausted ordering all leave `seed_managed` exactly as it was.
 *
 * No rate tier is inserted, and `is_active` appears in no statement here:
 * adding a variant never prices a journey and never publishes one.
 */
export async function insertAdminPackageVariant(
  slug: string,
  input: AdminPackageVariantCreateInput,
): Promise<AdminPackageVariantCreateResult> {
  const client = await acquireClient();
  let transaction = false;
  let discardClient = false;

  try {
    await client.query('BEGIN');
    transaction = true;

    // The parent is locked before anything below is read, so the variant set
    // this decides from cannot change underneath the decision.
    const parent = await client.query<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM packages WHERE slug = $1 FOR UPDATE',
      [slug],
    );

    const pkg = parent.rows[0];

    if (!pkg) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-not-found' };
    }

    if (pkg.is_active) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-active' };
    }

    const context = await client.query<VariantContext>(
      `SELECT COUNT(*)::int AS variant_count,
              COUNT(*) FILTER (WHERE is_default)::int AS default_count,
              COALESCE(MAX(sort_order), 0)::int AS max_sort_order
         FROM package_variants
        WHERE package_id = $1`,
      [pkg.id],
    );

    // An aggregate over zero rows still returns one row, so this is never
    // undefined; it is read defensively because the alternative is deciding
    // a reservation's behaviour from an assumption.
    const existing = context.rows[0];

    if (!existing) {
      throw new Error('Variant context disappeared during a variant creation');
    }

    const variantCount = requireWholeNumber('variant_count', existing.variant_count);
    const defaultCount = requireWholeNumber('default_count', existing.default_count);
    const maxSortOrder = requireWholeNumber('max_sort_order', existing.max_sort_order);

    if (variantCount === 1 && defaultCount === 0) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'unsafe-default-state' };
    }

    // Compared rather than computed: `maxSortOrder + 1` would be the overflow
    // this is meant to prevent.
    if (maxSortOrder >= POSTGRES_INTEGER_MAX) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'order-exhausted' };
    }

    // Both server-owned. The first variant of a journey leads it, so a
    // reservation naming no variant keeps resolving once rates exist; every
    // later one is added behind whatever already leads, and changing which
    // that is is its own operation.
    const isDefault = variantCount === 0;
    const sortOrder = maxSortOrder + 1;

    await client.query(
      `INSERT INTO package_variants (
         package_id, key, label, is_default, sort_order,
         child_min_age, child_max_age, child_discount_percent
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        pkg.id,
        input.key,
        input.label,
        isDefault,
        sortOrder,
        input.childMinAge,
        input.childMaxAge,
        input.childDiscountPercent,
      ],
    );

    // The seed reconciles the whole variant set of a package it still owns,
    // and refuses outright when it finds a variant its brochure entry does
    // not list. A creation that did not take ownership would therefore either
    // be deleted or break the next seed run. Same transaction as the insert,
    // so the two cannot separate.
    await client.query(
      'UPDATE packages SET seed_managed = false, updated_at = now() WHERE id = $1',
      [pkg.id],
    );

    // Read inside the transaction, so it sees both writes above.
    const detail = await client.query<AdminPackageDetailRow>(
      `SELECT ${PACKAGE_DETAIL_COLUMNS}
         FROM packages p
        WHERE p.id = $1`,
      [pkg.id],
    );

    const row = detail.rows[0];

    if (!row) {
      throw new Error('Package disappeared during a variant creation');
    }

    const created = toAdminPackageDetail(row);

    // Cleared BEFORE the COMMIT is issued, not after. A COMMIT that throws
    // leaves an outcome nobody can know: the transaction may well have
    // been applied, so it is not ours to roll back, and the catch below
    // must not try. Clearing it first is what routes that case to the
    // discard-the-connection branch instead.
    transaction = false;
    await client.query('COMMIT');

    return { outcome: 'created', package: created };
  } catch (error) {
    if (transaction) {
      try {
        await client.query('ROLLBACK');
        transaction = false;
      } catch {
        discardClient = true;
      }

      // The unique constraint is the only place "is this key already taken"
      // can be answered without a race, so the insert asks it by trying. The
      // rollback above has already undone the attempt, so this is an ordinary
      // refusal rather than a fault. Every other constraint — the ordering
      // one, the single-default index, the child-pricing check — means this
      // function computed something it should not have, and stays a fault.
      if (!discardClient && violatedConstraint(error) === VARIANT_KEY_CONSTRAINT) {
        return { outcome: 'key-in-use' };
      }
    } else {
      // BEGIN never succeeded, or COMMIT itself threw. In the COMMIT case the
      // outcome is genuinely unknown, so no ROLLBACK is sent after the fact
      // and the connection is not reused.
      discardClient = true;
    }

    throw error;
  } finally {
    client.release(discardClient);
  }
}

// ---------------------------------------------------------------------------
// Replacing one variant's whole rate set
// ---------------------------------------------------------------------------

/** What the replacement found, before any HTTP meaning is attached to it. */
export type AdminPackageRatesReplaceResult =
  | { outcome: 'replaced'; package: AdminPackageDetailRecord }
  | { outcome: 'package-not-found' }
  | { outcome: 'variant-not-found' }
  | { outcome: 'overlapping-tiers' }
  | { outcome: 'rates-required' };

/** PostgreSQL raises this for the rate tiers' GiST exclusion constraint. */
const EXCLUSION_VIOLATION = '23P01';

function isExclusionViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === EXCLUSION_VIOLATION;
}

/**
 * Replaces every rate tier of one variant, and takes ownership of its package.
 *
 * One transaction on one connection taken from the pool explicitly. This is
 * the write where that matters most: between the DELETE and the INSERTs the
 * variant has no rates at all, and a public reservation reading that gap
 * would be refused for want of a rate on a journey that is perfectly well
 * priced. Inside a transaction the gap is invisible — no other session sees
 * any of it until COMMIT — which is the whole reason this is not three
 * statements on the pool.
 *
 * The parent package is locked with `FOR UPDATE` first and the variant row
 * second, so two administrators replacing the same set serialize rather than
 * interleaving their deletes and inserts. That order is the canonical one —
 * the catalogue seed, the public reservation path and every other write in
 * this module take the package before its children — and it is what this
 * function was changed to. Locking the variant first and only then writing
 * to its package, which the ownership flip below does, put this path in a
 * deadlock cycle with all of them.
 *
 * The empty-set rule is evaluated here, inside the transaction, against the
 * package row that lock protects: whether an empty set is allowed depends on
 * `is_active` and `requires_price_confirmation`, and reading those before the
 * lock would be a decision made on a state that could already have changed.
 * Nothing is deactivated on the administrator's behalf — the request is
 * refused and says what to do instead.
 *
 * Ownership moves only when the replacement actually happens. A missing
 * package, a missing variant or a refused empty set all leave `seed_managed`
 * exactly as it was.
 *
 * `currency` is written as the literal `'USD'`, never bound from input.
 */
export async function replaceAdminPackageVariantRates(
  slug: string,
  key: string,
  rates: readonly AdminPackageRateTierInput[],
): Promise<AdminPackageRatesReplaceResult> {
  const client = await acquireClient();
  let transaction = false;
  let discardClient = false;

  try {
    await client.query('BEGIN');
    transaction = true;

    // The parent first, then the variant: the canonical order this module,
    // the catalogue seed and the public reservation path all take. Locking
    // the variant first and only afterwards writing to its package — which
    // the ownership flip below does — would complete a deadlock cycle with
    // every path that takes them the other way round.
    //
    // The publication columns the empty-set rule turns on are read from this
    // locked row, so that decision is made against a state no concurrent
    // writer can move underneath it.
    const parent = await client.query<{
      id: string;
      is_active: boolean;
      requires_price_confirmation: boolean;
    }>(
      'SELECT id, is_active, requires_price_confirmation FROM packages WHERE slug = $1 FOR UPDATE',
      [slug],
    );

    const pkg = parent.rows[0];

    if (!pkg) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-not-found' };
    }

    const target = await client.query<{ id: string }>(
      `SELECT id
         FROM package_variants
        WHERE package_id = $1
          AND key = $2
        FOR UPDATE`,
      [pkg.id, key],
    );

    const found = target.rows[0];

    if (!found) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'variant-not-found' };
    }

    // An active journey priced from its tiers must keep at least one: without
    // them it stays on the website and refuses every reservation. Checked
    // after the variant is known to exist, so a mistyped key is still
    // reported as a mistyped key rather than as this refusal.
    if (rates.length === 0 && pkg.is_active && !pkg.requires_price_confirmation) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'rates-required' };
    }

    await client.query('DELETE FROM package_rate_tiers WHERE variant_id = $1', [found.id]);

    for (const tier of rates) {
      await client.query(
        `INSERT INTO package_rate_tiers (
           variant_id, min_party_size, max_party_size, adult_unit_rate, currency
         ) VALUES ($1, $2, $3, $4, 'USD')`,
        [found.id, tier.minPartySize, tier.maxPartySize, tier.adultUnitRate],
      );
    }

    // The seed replaces a variant's whole rate set for a package it still
    // owns, so a price change that did not take ownership would be undone on
    // the next run. Same transaction as the replacement.
    await client.query(
      'UPDATE packages SET seed_managed = false, updated_at = now() WHERE id = $1',
      [pkg.id],
    );

    // Read inside the transaction, so it sees the replacement above.
    const detail = await client.query<AdminPackageDetailRow>(
      `SELECT ${PACKAGE_DETAIL_COLUMNS}
         FROM packages p
        WHERE p.id = $1`,
      [pkg.id],
    );

    const row = detail.rows[0];

    if (!row) {
      throw new Error('Package disappeared during a rate replacement');
    }

    const replaced = toAdminPackageDetail(row);

    // Cleared BEFORE the COMMIT is issued, not after. A COMMIT that throws
    // leaves an outcome nobody can know: the transaction may well have
    // been applied, so it is not ours to roll back, and the catch below
    // must not try. Clearing it first is what routes that case to the
    // discard-the-connection branch instead.
    transaction = false;
    await client.query('COMMIT');

    return { outcome: 'replaced', package: replaced };
  } catch (error) {
    if (transaction) {
      try {
        await client.query('ROLLBACK');
        transaction = false;
      } catch {
        discardClient = true;
      }

      // The exclusion constraint is the final integrity guard. Reaching it
      // means two tiers overlapped in a way the pre-flight check did not
      // catch; the rollback above has already undone the delete, so the old
      // set is intact and this is an ordinary refusal rather than a fault.
      if (!discardClient && isExclusionViolation(error)) {
        return { outcome: 'overlapping-tiers' };
      }
    } else {
      // BEGIN never succeeded, or COMMIT itself threw. In the COMMIT case the
      // outcome is genuinely unknown, so no ROLLBACK is sent after the fact
      // and the connection is not reused.
      discardClient = true;
    }

    throw error;
  } finally {
    client.release(discardClient);
  }
}

// ---------------------------------------------------------------------------
// Choosing which variant leads a journey
// ---------------------------------------------------------------------------

/**
 * What the switch found. `unchanged` is kept apart from `updated` even though
 * both answer 200: one of them wrote nothing, and that difference decides
 * whether ownership moved.
 */
export type AdminPackageDefaultVariantResult =
  | { outcome: 'updated'; package: AdminPackageDetailRecord }
  | { outcome: 'unchanged'; package: AdminPackageDetailRecord }
  | { outcome: 'package-not-found' }
  | { outcome: 'package-active' }
  | { outcome: 'variant-not-found' };

/** One variant row, as the lock below reads it. */
type DefaultVariantRow = {
  id: string;
  key: string;
  is_default: boolean;
};

/**
 * Moves the default flag to one variant, and takes ownership of its journey.
 *
 * A transaction on one connection, and the write in this module where the
 * ORDER of statements is itself the correctness argument.
 *
 * `package_variants_one_default_per_package_idx` is a partial UNIQUE index on
 * `(package_id) WHERE is_default`. It is a bare index, not a constraint, so
 * it is not deferrable and no `SET CONSTRAINTS` can reach it: PostgreSQL
 * checks it as each row's index entry is written, mid-statement. That makes
 * two shapes of this write unsafe. Setting the new default before clearing
 * the old one always collides. Worse, a single combined statement — one
 * UPDATE setting `is_default = (key = $2)` across every row — collides only
 * SOMETIMES, depending on the physical order the executor happens to reach
 * the rows in. So the flag is cleared in its own statement and set in a
 * second one, exactly as the catalogue seed does, and the two must never be
 * merged for tidiness.
 *
 * The package row is locked first and the variant rows second, the same order
 * the seed and the public reservation path use, so no deadlock cycle exists
 * among the three writers. The package lock is also the choke point against
 * bookings: a reservation's first statement takes `FOR SHARE` on that row, so
 * one in flight blocks this switch and this switch blocks new ones.
 *
 * The publication rule is evaluated under that lock. Moving the default
 * changes which variant an unqualified reservation resolves to, and the new
 * one may price differently, cover different party sizes or carry a different
 * child rule — so it is allowed only while the journey is inactive. No
 * rate-coverage comparison is attempted here, and nothing is deactivated on
 * the administrator's behalf.
 *
 * Asking for the variant that already leads is an ordinary success that
 * writes nothing at all: no variant row, no package row, no `updated_at`, and
 * no ownership move. Nothing has diverged from the brochure, so there is
 * nothing for the seed to overwrite.
 */
export async function setAdminPackageDefaultVariant(
  slug: string,
  variantKey: string,
): Promise<AdminPackageDefaultVariantResult> {
  const client = await acquireClient();
  let transaction = false;
  let discardClient = false;

  try {
    await client.query('BEGIN');
    transaction = true;

    // The parent first, and before anything is decided from it.
    const parent = await client.query<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM packages WHERE slug = $1 FOR UPDATE',
      [slug],
    );

    const pkg = parent.rows[0];

    if (!pkg) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-not-found' };
    }

    if (pkg.is_active) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-active' };
    }

    // Every sibling is locked, not just the target: both statements below
    // write to this set, and which rows they touch depends on all of them.
    const variants = await client.query<DefaultVariantRow>(
      'SELECT id, key, is_default FROM package_variants WHERE package_id = $1 FOR UPDATE',
      [pkg.id],
    );

    const target = variants.rows.find((row) => row.key === variantKey);

    // A journey with no variants at all lands here too: no key can name one.
    if (!target) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'variant-not-found' };
    }

    if (requireBoolean('is_default', target.is_default)) {
      // Already leads. Read under the lock so the answer is the state that
      // was just verified, then end the transaction without writing — there
      // is nothing to commit.
      const current = await readPackageDetail(client, pkg.id);

      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'unchanged', package: current };
    }

    // Statement one: clear. Narrow WHERE so it touches at most the one row
    // that holds the flag, and correctly touches none when the journey has no
    // default yet — which is a state to repair, not an error.
    await client.query(
      'UPDATE package_variants SET is_default = false WHERE package_id = $1 AND is_default',
      [pkg.id],
    );

    // Statement two: set. Never merged with the one above.
    await client.query(
      'UPDATE package_variants SET is_default = true WHERE package_id = $1 AND key = $2',
      [pkg.id, variantKey],
    );

    // The seed clears every default and re-sets them from the brochure, so a
    // switch that did not take ownership would be undone on the next run.
    // Same transaction as the switch, so the two cannot separate. Two columns
    // and no others: `is_active` is not named here, and moving the default
    // never publishes or withdraws a journey.
    await client.query(
      'UPDATE packages SET seed_managed = false, updated_at = now() WHERE id = $1',
      [pkg.id],
    );

    // Read inside the transaction, so it sees every write above.
    const updated = await readPackageDetail(client, pkg.id);

    // Cleared BEFORE the COMMIT is issued, not after. A COMMIT that throws
    // leaves an outcome nobody can know: the transaction may well have
    // been applied, so it is not ours to roll back, and the catch below
    // must not try. Clearing it first is what routes that case to the
    // discard-the-connection branch instead.
    transaction = false;
    await client.query('COMMIT');

    return { outcome: 'updated', package: updated };
  } catch (error) {
    if (transaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discardClient = true;
      }
    } else {
      // BEGIN never succeeded, or COMMIT itself threw. In the COMMIT case the
      // outcome is genuinely unknown, so no ROLLBACK is sent after the fact
      // and the connection is not reused.
      discardClient = true;
    }

    throw error;
  } finally {
    client.release(discardClient);
  }
}

/** The detail projection, read through an open transaction's own client. */
async function readPackageDetail(
  client: ClientLike,
  packageId: string,
): Promise<AdminPackageDetailRecord> {
  const detail = await client.query<AdminPackageDetailRow>(
    `SELECT ${PACKAGE_DETAIL_COLUMNS}
       FROM packages p
      WHERE p.id = $1`,
    [packageId],
  );

  const row = detail.rows[0];

  if (!row) {
    throw new Error('Package disappeared during a default variant change');
  }

  return toAdminPackageDetail(row);
}

// ---------------------------------------------------------------------------
// Replacing a journey's itinerary
// ---------------------------------------------------------------------------

/**
 * What the replacement found. `unchanged` is kept apart from `replaced` even
 * though both answer 200: one of them wrote nothing, and that difference
 * decides whether ownership moved.
 */
export type AdminPackageItineraryReplaceResult =
  | { outcome: 'replaced'; package: AdminPackageDetailRecord }
  | { outcome: 'unchanged'; package: AdminPackageDetailRecord }
  | { outcome: 'package-not-found' };

/**
 * Reads the itinerary as it stands, in the order a guest reads it.
 *
 * Ordered by `sort_order`, the same ordering both the public catalogue and
 * the admin detail projection use, so what this compares against is exactly
 * what a caller was shown.
 */
async function readPackageItinerary(
  client: ClientLike,
  packageId: string,
): Promise<AdminPackageItinerarySection[]> {
  const { rows } = await client.query<{
    day_number: number | null;
    heading: string | null;
    body: string;
  }>(
    `SELECT day_number, heading, body
       FROM package_itinerary_sections
      WHERE package_id = $1
      ORDER BY sort_order`,
    [packageId],
  );

  return rows.map((row) => ({
    dayNumber: row.day_number === null ? null : asInteger(row.day_number),
    heading: asNullableText(row.heading),
    body: asText(row.body),
  }));
}

/** Whether two itineraries are the same sections in the same order. */
function itinerariesMatch(
  left: readonly AdminPackageItinerarySection[],
  right: readonly AdminPackageItinerarySection[],
): boolean {
  return left.length === right.length
    && left.every((section, index) => {
      const other = right[index]!;

      // Compared field by field, with null distinct from every value: a
      // section about the whole journey is not the same as one about day 1.
      return section.dayNumber === other.dayNumber
        && section.heading === other.heading
        && section.body === other.body;
    });
}

/**
 * Replaces a journey's itinerary, and takes ownership of it.
 *
 * Deliberately allowed while the journey is active. Nothing in the
 * reservation path reads these rows — not the rate lookup, not
 * `selectVariant`, not the operating-day check — so rewriting them cannot
 * change what a booking resolves to, what it costs, or whether it is
 * accepted. The itinerary is prose on the detail page, and requiring an
 * operator to withdraw a live journey to correct a day's wording would be a
 * real cost for no safety.
 *
 * The package is locked first, as every writer in this module does. No child
 * row is locked: they are about to be deleted outright, and the package lock
 * already serialises this against the seed, which holds the same row while it
 * reconciles.
 *
 * The write is a DELETE of the whole itinerary followed by fresh INSERTs,
 * which is what the catalogue seed does with this same table and for the same
 * reason: nothing references an itinerary section, so its id is not worth
 * preserving. That also removes the ordering hazard entirely — after the
 * delete the `(package_id, sort_order)` space is empty, so `1..n` cannot
 * collide with a row that has not moved. No parking is needed here, and the
 * variant parking helper must not be borrowed: it exists only because
 * reservations hold variant ids.
 *
 * Submitting the itinerary a journey already has writes nothing at all. A
 * replacement body is easy to resubmit unchanged from a form, and a blind
 * delete-and-reinsert would churn ids and move `updated_at` on every save.
 */
export async function replaceAdminPackageItinerary(
  slug: string,
  sections: readonly AdminPackageItinerarySection[],
): Promise<AdminPackageItineraryReplaceResult> {
  const client = await acquireClient();
  let transaction = false;
  let discardClient = false;

  try {
    await client.query('BEGIN');
    transaction = true;

    const parent = await client.query<{ id: string }>(
      'SELECT id FROM packages WHERE slug = $1 FOR UPDATE',
      [slug],
    );

    const pkg = parent.rows[0];

    if (!pkg) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-not-found' };
    }

    const current = await readPackageItinerary(client, pkg.id);

    if (itinerariesMatch(current, sections)) {
      // Already exactly this. Read under the lock so the answer is the state
      // just verified, then end the transaction without writing — there is
      // nothing to commit, and nothing has diverged from the brochure.
      const unchanged = await readPackageDetail(client, pkg.id);

      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'unchanged', package: unchanged };
    }

    await client.query('DELETE FROM package_itinerary_sections WHERE package_id = $1', [pkg.id]);

    if (sections.length > 0) {
      // `WITH ORDINALITY` numbers the rows 1..n in array order, so the
      // ordering the caller sent is the ordering stored — in one statement
      // rather than one per section. The three arrays are unnested together,
      // which pairs them positionally and carries every null through as a
      // null rather than as a gap.
      await client.query(
        `INSERT INTO package_itinerary_sections (
           package_id, day_number, heading, body, sort_order
         )
         SELECT $1, section.day_number, section.heading, section.body, section.position::int
           FROM unnest($2::int[], $3::text[], $4::text[])
                WITH ORDINALITY AS section(day_number, heading, body, position)`,
        [
          pkg.id,
          sections.map((section) => section.dayNumber),
          sections.map((section) => section.heading),
          sections.map((section) => section.body),
        ],
      );
    }

    // The seed deletes every itinerary section of a package it still owns and
    // re-inserts them from the brochure, so an edit that did not take
    // ownership would be undone on the next run. Same transaction as the
    // replacement, so the two cannot separate. `is_active` is in no statement
    // here: rewriting what a journey says never publishes or withdraws it.
    await client.query(
      'UPDATE packages SET seed_managed = false, updated_at = now() WHERE id = $1',
      [pkg.id],
    );

    // Read inside the transaction, so it sees every write above.
    const replaced = await readPackageDetail(client, pkg.id);

    // Cleared BEFORE the COMMIT is issued, not after. A COMMIT that throws
    // leaves an outcome nobody can know: the transaction may well have
    // been applied, so it is not ours to roll back, and the catch below
    // must not try. Clearing it first is what routes that case to the
    // discard-the-connection branch instead.
    transaction = false;
    await client.query('COMMIT');

    return { outcome: 'replaced', package: replaced };
  } catch (error) {
    if (transaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discardClient = true;
      }
    } else {
      // BEGIN never succeeded, or COMMIT itself threw. In the COMMIT case the
      // outcome is genuinely unknown, so no ROLLBACK is sent after the fact
      // and the connection is not reused.
      discardClient = true;
    }

    throw error;
  } finally {
    client.release(discardClient);
  }
}

// ---------------------------------------------------------------------------
// Replacing a journey's content lists
// ---------------------------------------------------------------------------

/**
 * What the replacement found. `unchanged` is kept apart from `replaced` even
 * though both answer 200: one of them wrote nothing, and that difference
 * decides whether ownership moved.
 */
export type AdminPackageContentReplaceResult =
  | { outcome: 'replaced'; package: AdminPackageDetailRecord }
  | { outcome: 'unchanged'; package: AdminPackageDetailRecord }
  | { outcome: 'package-not-found' };

/** The stored kind for each list this contract exposes. */
const CONTENT_KIND_BY_LIST = {
  included: 'included',
  excluded: 'excluded',
  notes: 'note',
} as const;

type ContentListKey = keyof typeof CONTENT_KIND_BY_LIST;

const CONTENT_LIST_KEYS = Object.keys(CONTENT_KIND_BY_LIST) as ContentListKey[];

/**
 * Reads the three lists as they stand, in the order a guest sees them.
 *
 * Ordered by kind then `sort_order`, the same ordering both the public
 * catalogue and the admin detail projection use, so what this compares
 * against is exactly what a caller was shown.
 */
async function readPackageContentLists(
  client: ClientLike,
  packageId: string,
): Promise<AdminPackageContentReplacementInput> {
  const { rows } = await client.query<{ kind: string; text: string }>(
    `SELECT kind, text
       FROM package_content_items
      WHERE package_id = $1
      ORDER BY kind, sort_order`,
    [packageId],
  );

  const lists: AdminPackageContentReplacementInput = {
    included: [],
    excluded: [],
    notes: [],
  };

  for (const row of rows) {
    // The one place the stored singular `note` becomes the contract's
    // plural `notes`; nothing else in this module translates it.
    if (row.kind === 'included') lists.included.push(asText(row.text));
    else if (row.kind === 'excluded') lists.excluded.push(asText(row.text));
    else if (row.kind === 'note') lists.notes.push(asText(row.text));
    else invalidRow();
  }

  return lists;
}

/** Whether two content sets are the same lists in the same order. */
function contentListsMatch(
  left: AdminPackageContentReplacementInput,
  right: AdminPackageContentReplacementInput,
): boolean {
  return CONTENT_LIST_KEYS.every((key) => {
    const a = left[key];
    const b = right[key];

    return a.length === b.length && a.every((entry, index) => entry === b[index]);
  });
}

/**
 * Replaces a journey's three content lists, and takes ownership of it.
 *
 * Deliberately allowed while the journey is active. Nothing in the
 * reservation path reads these rows — not the rate lookup, not
 * `selectVariant`, not the operating-day check — so editing them cannot
 * change what a booking resolves to, what it costs, or whether it is
 * accepted. They are prose on the detail page, and requiring an operator to
 * withdraw a live journey to fix a typo would be a real cost for no safety.
 *
 * The package is locked first, as every writer in this module does. No child
 * row is locked: they are about to be deleted outright, and the package lock
 * already serialises this against the seed, which holds the same row while it
 * reconciles.
 *
 * The write is a DELETE of the whole set followed by fresh INSERTs, which is
 * what the catalogue seed does with these same two tables and for the same
 * reason: nothing references a content item, so its id is not worth
 * preserving. That also removes the ordering hazard entirely — after the
 * delete the `(package_id, kind, sort_order)` space is empty, so `1..n`
 * cannot collide with a row that has not moved. No parking is needed here,
 * and the variant parking helper must not be borrowed: it exists only
 * because reservations hold variant ids.
 *
 * Each kind is numbered from 1 independently, because the uniqueness is
 * scoped per kind. A single global sequence would satisfy the constraint and
 * mean nothing.
 *
 * Submitting the content a journey already has writes nothing at all. A
 * replacement body is easy to resubmit unchanged from a form, and a blind
 * delete-and-reinsert would churn ids and move `updated_at` on every save.
 */
export async function replaceAdminPackageContent(
  slug: string,
  content: AdminPackageContentReplacementInput,
): Promise<AdminPackageContentReplaceResult> {
  const client = await acquireClient();
  let transaction = false;
  let discardClient = false;

  try {
    await client.query('BEGIN');
    transaction = true;

    const parent = await client.query<{ id: string }>(
      'SELECT id FROM packages WHERE slug = $1 FOR UPDATE',
      [slug],
    );

    const pkg = parent.rows[0];

    if (!pkg) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-not-found' };
    }

    const current = await readPackageContentLists(client, pkg.id);

    if (contentListsMatch(current, content)) {
      // Already exactly this. Read under the lock so the answer is the state
      // just verified, then end the transaction without writing — there is
      // nothing to commit, and nothing has diverged from the brochure.
      const unchanged = await readPackageDetail(client, pkg.id);

      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'unchanged', package: unchanged };
    }

    await client.query('DELETE FROM package_content_items WHERE package_id = $1', [pkg.id]);

    for (const key of CONTENT_LIST_KEYS) {
      const entries = content[key];

      if (entries.length === 0) {
        continue;
      }

      // `WITH ORDINALITY` numbers the rows 1..n in array order, so the
      // ordering the caller sent is the ordering stored, in one statement per
      // kind rather than one per row.
      await client.query(
        `INSERT INTO package_content_items (package_id, kind, text, sort_order)
         SELECT $1, $2, entry.text, entry.position::int
           FROM unnest($3::text[]) WITH ORDINALITY AS entry(text, position)`,
        [pkg.id, CONTENT_KIND_BY_LIST[key], entries],
      );
    }

    // The seed deletes every content item of a package it still owns and
    // re-inserts them from the brochure, so an edit that did not take
    // ownership would be undone on the next run. Same transaction as the
    // replacement, so the two cannot separate. `is_active` is in no statement
    // here: rewriting what a journey says never publishes or withdraws it.
    await client.query(
      'UPDATE packages SET seed_managed = false, updated_at = now() WHERE id = $1',
      [pkg.id],
    );

    // Read inside the transaction, so it sees every write above.
    const replaced = await readPackageDetail(client, pkg.id);

    // Cleared BEFORE the COMMIT is issued, not after. A COMMIT that throws
    // leaves an outcome nobody can know: the transaction may well have
    // been applied, so it is not ours to roll back, and the catch below
    // must not try. Clearing it first is what routes that case to the
    // discard-the-connection branch instead.
    transaction = false;
    await client.query('COMMIT');

    return { outcome: 'replaced', package: replaced };
  } catch (error) {
    if (transaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discardClient = true;
      }
    } else {
      // BEGIN never succeeded, or COMMIT itself threw. In the COMMIT case the
      // outcome is genuinely unknown, so no ROLLBACK is sent after the fact
      // and the connection is not reused.
      discardClient = true;
    }

    throw error;
  } finally {
    client.release(discardClient);
  }
}

// ---------------------------------------------------------------------------
// Removing one variant from a journey
// ---------------------------------------------------------------------------

/** What the removal found, before any HTTP meaning is attached to it. */
export type AdminPackageVariantDeleteResult =
  | { outcome: 'deleted'; package: AdminPackageDetailRecord }
  | { outcome: 'package-not-found' }
  | { outcome: 'package-active' }
  | { outcome: 'variant-not-found' }
  | { outcome: 'variant-is-default' }
  | { outcome: 'variant-has-reservations' };

/** PostgreSQL raises this when a RESTRICT reference blocks a delete. */
const FOREIGN_KEY_VIOLATION = '23503';
const RESERVATION_VARIANT_CONSTRAINT = 'package_reservations_variant_package_fkey';

/**
 * Whether this error is the reservations reference refusing the delete.
 *
 * Matched on the SQLSTATE and the constraint name `pg` attaches, never on the
 * message, which is localised and unversioned. Narrow on purpose: any OTHER
 * foreign key violation means something this function did not anticipate, and
 * reporting it as "this variant has bookings" would be a guess dressed as an
 * answer.
 */
function isReservationReferenceViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as { code?: unknown; constraint?: unknown };

  return candidate.code === FOREIGN_KEY_VIOLATION
    && candidate.constraint === RESERVATION_VARIANT_CONSTRAINT;
}

/**
 * Removes one variant from a journey, and takes ownership of it.
 *
 * Allowed only while the journey is inactive, and this is the write where
 * that matters most: removing a variant takes away the thing a booking
 * resolves to. On a live journey it would refuse a guest whose form was
 * already open, switch every unqualified booking to a variant priced
 * differently, or leave the journey unable to take a booking at all.
 *
 * The package is locked first and the variant second, the canonical order.
 * The package lock is doing real work here beyond serialising against other
 * administrators: the public reservation path takes `FOR SHARE` on that same
 * row before it reads anything, so no reservation for this journey can be
 * created while this transaction runs. That is what makes the pre-check below
 * an answer rather than a guess.
 *
 * Three refusals, all decided under that lock and all before anything is
 * written. The journey must be inactive. The variant must not be the one the
 * journey leads with while others remain — promoting a successor would decide
 * implicitly what every unqualified booking resolves to, which is its own
 * operation and its own consequence. And the variant must never have been
 * booked.
 *
 * Deleting the LAST variant is deliberately allowed even though it is almost
 * always the default: there is no successor to choose, so no choice is being
 * made, and a journey with no variants is a state creating one already
 * produces.
 *
 * Only the variant row is deleted. Its rate tiers go with it through
 * `package_rate_tiers_variant_id_fkey`, which is ON DELETE CASCADE; deleting
 * them here as well would be a second write that changes nothing. No
 * surviving variant is touched — no `is_default` is moved and no `sort_order`
 * is compacted, so the remaining positions simply carry a gap, which the
 * schema permits and the reordering endpoint normalises on demand.
 */
export async function deleteAdminPackageVariant(
  slug: string,
  key: string,
): Promise<AdminPackageVariantDeleteResult> {
  const client = await acquireClient();
  let transaction = false;
  let discardClient = false;

  try {
    await client.query('BEGIN');
    transaction = true;

    const parent = await client.query<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM packages WHERE slug = $1 FOR UPDATE',
      [slug],
    );

    const pkg = parent.rows[0];

    if (!pkg) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-not-found' };
    }

    if (pkg.is_active) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-active' };
    }

    const target = await client.query<{ id: string; is_default: boolean }>(
      `SELECT id, is_default
         FROM package_variants
        WHERE package_id = $1
          AND key = $2
        FOR UPDATE`,
      [pkg.id, key],
    );

    const found = target.rows[0];

    if (!found) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'variant-not-found' };
    }

    // Counted under the package lock, so "are there others" cannot change
    // between asking and acting.
    const siblings = await client.query<{ remaining: number }>(
      'SELECT COUNT(*)::int AS remaining FROM package_variants WHERE package_id = $1 AND id <> $2',
      [pkg.id, found.id],
    );

    const remaining = requireWholeNumber('remaining', siblings.rows[0]?.remaining);

    if (requireBoolean('is_default', found.is_default) && remaining > 0) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'variant-is-default' };
    }

    // The pre-check. Race-free because the package lock above bars any new
    // reservation for this journey, and existing ones are never removed —
    // the admin API only moves them between pending, confirmed and
    // cancelled. Status is not consulted: a cancelled booking is a record of
    // what was sold and holds the variant exactly as a confirmed one does.
    const booked = await client.query<{ exists: number }>(
      'SELECT 1 AS exists FROM package_reservations WHERE variant_id = $1 LIMIT 1',
      [found.id],
    );

    if (booked.rows.length > 0) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'variant-has-reservations' };
    }

    // Rate tiers cascade from this. Nothing else references a variant.
    await client.query('DELETE FROM package_variants WHERE id = $1', [found.id]);

    // The seed upserts every brochure variant by (package_id, key), so a
    // removal that did not take ownership would simply be re-created on the
    // next run — the delete would appear to work and then undo itself. Same
    // transaction as the delete, so the two cannot separate.
    await client.query(
      'UPDATE packages SET seed_managed = false, updated_at = now() WHERE id = $1',
      [pkg.id],
    );

    // Read inside the transaction, so it sees both writes above.
    const updated = await readPackageDetail(client, pkg.id);

    // Cleared BEFORE the COMMIT is issued, not after. A COMMIT that throws
    // leaves an outcome nobody can know: the transaction may well have
    // been applied, so it is not ours to roll back, and the catch below
    // must not try. Clearing it first is what routes that case to the
    // discard-the-connection branch instead.
    transaction = false;
    await client.query('COMMIT');

    return { outcome: 'deleted', package: updated };
  } catch (error) {
    if (transaction) {
      try {
        await client.query('ROLLBACK');
        transaction = false;
      } catch {
        discardClient = true;
      }

      // The backstop to the pre-check above. Reaching it would mean a
      // reservation appeared despite the package lock; the rollback has
      // already undone the delete, so the variant is intact and this is an
      // ordinary refusal rather than a fault. Any other foreign key
      // violation is something this function did not anticipate and stays a
      // fault.
      if (!discardClient && isReservationReferenceViolation(error)) {
        return { outcome: 'variant-has-reservations' };
      }
    } else {
      // BEGIN never succeeded, or COMMIT itself threw. In the COMMIT case the
      // outcome is genuinely unknown, so no ROLLBACK is sent after the fact
      // and the connection is not reused.
      discardClient = true;
    }

    throw error;
  } finally {
    client.release(discardClient);
  }
}

// ---------------------------------------------------------------------------
// Removing a whole journey
// ---------------------------------------------------------------------------

/**
 * What the removal found. There is no `package` on success: the journey is
 * gone, and returning a representation of something that no longer exists
 * would be the one dishonest answer this module could give.
 *
 * `mediaStorageKey` is the one exception to that, and it is not a
 * representation of the journey: it is the object key the committed
 * transaction has just orphaned, carried out so the caller can remove it from
 * storage afterwards. `null` when the journey had no image.
 *
 * Deliberately internal. The service consumes it and returns
 * `AdminPackageRemovalResult`, which has no such field, so an object key
 * cannot reach an HTTP response even by accident.
 */
export type AdminPackageDeleteResult =
  | { outcome: 'deleted'; mediaStorageKey: string | null }
  | { outcome: 'package-not-found' }
  | { outcome: 'package-active' }
  | { outcome: 'brochure-managed' }
  | { outcome: 'has-reservations' };

/**
 * Removes one journey and everything it owns.
 *
 * Three refusals, all decided under the package lock and all before anything
 * is written.
 *
 * The journey must be inactive. Deactivation is instant, reversible and
 * already the right tool for withdrawing something from sale, so requiring it
 * first costs almost nothing and makes a permanent removal a deliberate
 * second step.
 *
 * Its identity must not belong to the brochure. This is judged on the code
 * and slug read under the lock, NOT on `seed_managed`, and the difference is
 * the whole point: the ownership flag lives on the row, so deleting the row
 * destroys the only record that an administrator ever took ownership. The
 * catalogue seed looks each brochure journey up by code or slug, finds
 * nothing, and inserts a fresh seed-owned copy — so deleting a brochure
 * identity does not remove the journey, it launders it back to brochure
 * content under a new id and loses every admin edit in between. A journey
 * that was once the brochure's and has since become an administrator's is
 * refused for exactly that reason.
 *
 * And it must never have been booked. `package_reservations` references
 * variants with ON DELETE RESTRICT, so one booking against one variant blocks
 * the whole journey, whatever that booking's status — a cancelled reservation
 * is a record of what was sold and holds the row exactly as a confirmed one
 * does. Since nothing in this system ever deletes a reservation, that refusal
 * is permanent rather than a race to retry.
 *
 * The delete itself is one statement against `packages`. Itinerary sections,
 * content items and variants cascade from it, and rate tiers cascade from the
 * variants; naming any of them here would be extra writes that change
 * nothing. `seed_managed` and `updated_at` are not written either — every
 * other write in this module flips ownership because the row survives, and
 * here it does not, so such a write would exist only in the WAL.
 */
export async function deleteAdminPackage(slug: string): Promise<AdminPackageDeleteResult> {
  const client = await acquireClient();
  let transaction = false;
  let discardClient = false;

  try {
    await client.query('BEGIN');
    transaction = true;

    // The first lock taken, and the only one. Every child row is about to go
    // by cascade, and this row already serialises the transaction against the
    // seed, every other admin writer, and — because the public reservation
    // path takes `FOR SHARE` on it first — against any new booking. That last
    // one is what makes the pre-check below an answer rather than a guess.
    const parent = await client.query<{
      id: string;
      code: string;
      slug: string;
      is_active: boolean;
    }>(
      'SELECT id, code, slug, is_active FROM packages WHERE slug = $1 FOR UPDATE',
      [slug],
    );

    const pkg = parent.rows[0];

    if (!pkg) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-not-found' };
    }

    if (requireBoolean('is_active', pkg.is_active)) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-active' };
    }

    // Judged on the identity this row currently carries, which is why the
    // check reads the locked columns rather than trusting anything the caller
    // said or the ownership flag.
    if (isReservedBrochureCode(pkg.code) || isReservedBrochureSlug(pkg.slug)) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'brochure-managed' };
    }

    // Any booking on any variant of this journey. Status is deliberately not
    // consulted.
    const booked = await client.query<{ exists: number }>(
      `SELECT 1 AS exists
         FROM package_reservations r
         JOIN package_variants v ON v.id = r.variant_id
        WHERE v.package_id = $1
        LIMIT 1`,
      [pkg.id],
    );

    if (booked.rows.length > 0) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'has-reservations' };
    }

    // The journey's one image, if it has one. Read under the same lock that
    // every journey-media write takes first, so no upload can slip a row in
    // between this and the delete below.
    //
    // It has to be named explicitly, unlike the four cascading child tables:
    // `package_media.package_id` is ON DELETE RESTRICT, so the statement
    // after this would be refused outright while the relation stands. That
    // RESTRICT is deliberate. CASCADE would have been the quiet alternative
    // and the wrong one — it would drop the relation and leave the
    // `media_assets` row behind with no owner and no column naming one, so
    // nothing could ever find the object it describes.
    const media = await client.query<{ media_asset_id: string; storage_key: string }>(
      `SELECT pm.media_asset_id, ma.storage_key
         FROM package_media pm
         JOIN media_assets ma ON ma.id = pm.media_asset_id
        WHERE pm.package_id = $1`,
      [pkg.id],
    );

    const image = media.rows[0];
    // Captured before anything is deleted, because after the COMMIT the row
    // that named this object no longer exists to be asked.
    const mediaStorageKey = image ? requireText('storage_key', image.storage_key) : null;

    if (image) {
      // The relation first, then the asset it pointed at. `media_assets` is
      // RESTRICT on this side too, so it cannot go while the relation holds
      // it, and the asset row is shared schema — never deleted by cascade.
      await client.query('DELETE FROM package_media WHERE package_id = $1', [pkg.id]);
      await client.query('DELETE FROM media_assets WHERE id = $1', [image.media_asset_id]);
    }

    // One statement for the journey itself. Itinerary sections, content items
    // and variants cascade from here, and rate tiers cascade from the
    // variants.
    await client.query('DELETE FROM packages WHERE id = $1', [pkg.id]);

    // Cleared BEFORE the COMMIT is issued, not after. A COMMIT that throws
    // leaves an outcome nobody can know: the transaction may well have
    // been applied, so it is not ours to roll back, and the catch below
    // must not try. Clearing it first is what routes that case to the
    // discard-the-connection branch instead.
    transaction = false;
    await client.query('COMMIT');

    // Nothing is removed from object storage here, and must not be: this
    // function's whole contract is that the database is the truth and the
    // object follows. The key goes back to the service, which removes the
    // object after — and only after — this commit has answered.
    return { outcome: 'deleted', mediaStorageKey };
  } catch (error) {
    if (transaction) {
      try {
        await client.query('ROLLBACK');
        transaction = false;
      } catch {
        discardClient = true;
      }

      // The backstop to the pre-check above. Reaching it would mean a booking
      // appeared despite the package lock; the rollback has already undone
      // the delete, so the journey is intact and this is an ordinary refusal
      // rather than a fault. The constraint is the one the variant cascade
      // trips, which is how a package delete surfaces a reservation. Any
      // other foreign key violation is something this function did not
      // anticipate and stays a fault.
      if (!discardClient && isReservationReferenceViolation(error)) {
        return { outcome: 'has-reservations' };
      }
    } else {
      // BEGIN never succeeded, or COMMIT itself threw. In the COMMIT case the
      // outcome is genuinely unknown, so no ROLLBACK is sent after the fact
      // and the connection is not reused.
      discardClient = true;
    }

    throw error;
  } finally {
    client.release(discardClient);
  }
}

// ---------------------------------------------------------------------------
// Rearranging a journey's variants
// ---------------------------------------------------------------------------

/**
 * What the reorder found. `unchanged` is kept apart from `reordered` even
 * though both answer 200: one of them wrote nothing, and that difference
 * decides whether ownership moved.
 */
export type AdminPackageVariantOrderResult =
  | { outcome: 'reordered'; package: AdminPackageDetailRecord }
  | { outcome: 'unchanged'; package: AdminPackageDetailRecord }
  | { outcome: 'package-not-found' }
  | { outcome: 'variant-not-found' }
  | { outcome: 'set-mismatch' }
  | { outcome: 'order-exhausted' };

/** One variant row, as the lock below reads it. */
type VariantOrderRow = {
  id: string;
  key: string;
  sort_order: number;
};

/**
 * Writes a journey's variants into the order given, and takes ownership.
 *
 * Deliberately allowed while the journey is active, unlike adding a variant
 * or moving the default. Nothing in the reservation path reads a position:
 * `selectVariant` branches on how many variants there are and on the default
 * flag, the rate lookup is by variant id and party size, and the price comes
 * from the resolved variant. Order decides what a guest SEES, never what a
 * booking resolves to or what it costs — so there is nothing here that
 * withdrawing the journey would protect, and requiring it would mean taking a
 * live journey off sale to rearrange a dropdown.
 *
 * The package is locked first and the variants second, the canonical order
 * every writer in this module now takes.
 *
 * The submitted list must be the journey's whole variant set, each key once.
 * The two ways it can fail to be are answered differently because they need
 * different things from the administrator: a key naming no variant is a
 * mistake in the request, while a list that omits an existing variant nearly
 * always means the page was rendered before that variant was added. Neither
 * is repaired — inventing a position for an unlisted variant would move
 * something nobody chose to move.
 *
 * The renumber itself is two passes, because
 * `UNIQUE (package_id, sort_order)` is not deferrable and is checked as each
 * row's index entry is written. Every row is parked clear of the final range
 * first — by the shared helper the catalogue seed uses — and only then are
 * the final positions written. Rows are UPDATEd, never deleted and
 * re-inserted: `package_reservations` references `(variant_id, package_id)`
 * with ON DELETE RESTRICT, so variant ids have to survive, and a reservation
 * taken last year must still point at the variant it was taken against.
 *
 * `is_default` is in no statement here. Which variant leads a journey is its
 * own operation, and rearranging the list must not quietly change what an
 * unqualified booking resolves to.
 */
export async function reorderAdminPackageVariants(
  slug: string,
  variantKeys: readonly string[],
): Promise<AdminPackageVariantOrderResult> {
  const client = await acquireClient();
  let transaction = false;
  let discardClient = false;

  try {
    await client.query('BEGIN');
    transaction = true;

    const parent = await client.query<{ id: string }>(
      'SELECT id FROM packages WHERE slug = $1 FOR UPDATE',
      [slug],
    );

    const pkg = parent.rows[0];

    if (!pkg) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'package-not-found' };
    }

    // Every sibling is locked: all of them are about to be rewritten, and the
    // set the request is checked against must not change underneath it.
    // Ordered so `current` below is the journey's order as it stands.
    const variants = await client.query<VariantOrderRow>(
      `SELECT id, key, sort_order
         FROM package_variants
        WHERE package_id = $1
        ORDER BY sort_order, key
        FOR UPDATE`,
      [pkg.id],
    );

    const byKey = new Map(variants.rows.map((row) => [row.key, row]));

    // A listed key naming no variant: the request is wrong about this
    // journey. Told apart from the omission below, which is about staleness.
    if (variantKeys.some((key) => !byKey.has(key))) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'variant-not-found' };
    }

    // Every key exists and the validator already proved there are no repeats,
    // so equal counts is enough to prove the list is the whole set.
    if (variantKeys.length !== variants.rows.length) {
      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'set-mismatch' };
    }

    const current = variants.rows.map((row) => row.key);
    const unchanged = current.every((key, index) => key === variantKeys[index]);

    if (unchanged) {
      // Already in this order. Read under the lock so the answer is the state
      // just verified, then end the transaction without writing — there is
      // nothing to commit, and nothing has diverged from the brochure.
      const currentDetail = await readPackageDetail(client, pkg.id);

      await client.query('ROLLBACK');
      transaction = false;

      return { outcome: 'unchanged', package: currentDetail };
    }

    try {
      // Pass one. Raises before writing anything if the range cannot hold the
      // parked values.
      await parkPackageVariantSortOrders(client, pkg.id, variants.rows, variantKeys.length);
    } catch (error) {
      if (isVariantSortOrderExhaustedError(error) || isUnreadableVariantSortOrderError(error)) {
        await client.query('ROLLBACK');
        transaction = false;

        return { outcome: 'order-exhausted' };
      }

      throw error;
    }

    // Pass two. The final range is empty now, so each row can take its
    // position without meeting one that has not moved yet. Written by id,
    // which the lock above already resolved, so no row of another journey can
    // be reached.
    for (const [index, key] of variantKeys.entries()) {
      await client.query(
        'UPDATE package_variants SET sort_order = $2 WHERE id = $1',
        [byKey.get(key)!.id, index + 1],
      );
    }

    // The seed renumbers the whole variant set of a package it still owns
    // from the brochure's own order, so a reorder that did not take ownership
    // would be undone on the next run. Same transaction as the renumber.
    await client.query(
      'UPDATE packages SET seed_managed = false, updated_at = now() WHERE id = $1',
      [pkg.id],
    );

    // Read inside the transaction, so it sees every write above.
    const reordered = await readPackageDetail(client, pkg.id);

    // Cleared BEFORE the COMMIT is issued, not after. A COMMIT that throws
    // leaves an outcome nobody can know: the transaction may well have
    // been applied, so it is not ours to roll back, and the catch below
    // must not try. Clearing it first is what routes that case to the
    // discard-the-connection branch instead.
    transaction = false;
    await client.query('COMMIT');

    return { outcome: 'reordered', package: reordered };
  } catch (error) {
    if (transaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discardClient = true;
      }
    } else {
      // BEGIN never succeeded, or COMMIT itself threw. In the COMMIT case the
      // outcome is genuinely unknown, so no ROLLBACK is sent after the fact
      // and the connection is not reused.
      discardClient = true;
    }

    throw error;
  } finally {
    client.release(discardClient);
  }
}

// ---------------------------------------------------------------------------
// Offering a package to guests, or withdrawing it
// ---------------------------------------------------------------------------

/**
 * Sets whether one package is offered to guests, and answers with the whole
 * package as it now stands.
 *
 * ONE statement. The UPDATE is a CTE whose RETURNING feeds the same detail
 * projection a plain read uses, so there is no read-then-write window and no
 * second query that could observe a different row than the one just written.
 * No BEGIN/COMMIT: a single statement is already atomic, so this path has no
 * commit whose outcome could be unknown.
 *
 * The WHERE clause matches on slug alone, with no guard on the current state.
 * That is what makes the operation idempotent: asking for a state a package
 * is already in updates it to the value it already holds and returns it,
 * rather than matching zero rows and being mistaken for a missing package.
 * Zero rows therefore means exactly one thing — no package has that slug — so
 * no follow-up read is needed to tell the two apart.
 *
 * `updated_at` moves only when `is_active` actually changed. A repeated
 * request is a success that reports the same package, and it should not
 * rewrite when the offering last changed. `IS DISTINCT FROM` rather than `<>`
 * so the comparison is total, even though the column is NOT NULL.
 *
 * Two columns are written and no others. `seed_managed` is absent from the
 * SET clause, so publishing or withdrawing a brochure offering never takes
 * ownership of it — the seed keeps reconciling that package, and the
 * `is_active` written here survives the reseeding untouched, exactly as it
 * does today. Content, variants, rate tiers, itinerary and sort order are not
 * named here at all.
 */
export async function updateAdminPackageActiveState(
  slug: string,
  isActive: boolean,
): Promise<AdminPackageDetailRecord | null> {
  const { rows } = await queryable.query<AdminPackageDetailRow>(
    `WITH updated AS (
       UPDATE packages
          SET is_active = $2,
              updated_at = CASE WHEN is_active IS DISTINCT FROM $2 THEN now() ELSE updated_at END
        WHERE slug = $1
       RETURNING *
     )
     SELECT ${PACKAGE_DETAIL_COLUMNS}
       FROM updated p`,
    [slug, isActive],
  );

  const row = rows[0];

  return row ? toAdminPackageDetail(row) : null;
}
