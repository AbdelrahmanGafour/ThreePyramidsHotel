import type { QueryResult, QueryResultRow } from './pool';

/**
 * Moving package variants into new positions without tripping the unique
 * index that guards them.
 *
 * `package_variants_package_sort_key` is `UNIQUE (package_id, sort_order)` and
 * is NOT DEFERRABLE, so PostgreSQL checks it as each row's index entry is
 * written rather than at statement end. That makes every obvious way of
 * renumbering unsafe:
 *
 *   - a direct swap collides the moment the first row takes the value the
 *     second still holds;
 *   - a row-by-row renumber collides whenever a target position is still held
 *     by a row that has not moved yet;
 *   - a single multi-row UPDATE collides only SOMETIMES, depending on the
 *     physical order the executor happens to reach the rows in — which is the
 *     worst kind, because it passes in testing.
 *
 * The one safe shape is two passes: move every existing row out of the way
 * first, into a range nothing will finish in, then write the final positions
 * into the range that is now empty. This module owns that first pass.
 *
 * It was extracted from the catalogue seed, which is where the algorithm was
 * first worked out, so the admin reordering endpoint could use exactly the
 * same mechanics rather than a second implementation that would have to be
 * kept in step. Only the mechanics live here. Everything about WHY a caller
 * is reordering — which keys it expects, what it does about an unexpected
 * one, how it words its errors, what it writes afterwards — stays with the
 * caller, and the errors below are raised as types so each can say it in its
 * own voice.
 */

/** `package_variants.sort_order` is an int4. */
export const POSTGRES_INTEGER_MAX = 2147483647;

/** What this module needs from a connection inside a transaction. */
type Queryable = {
  query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

/** Only the column the parking mechanics read. */
export type VariantSortOrderRow = {
  sort_order: number;
};

/**
 * A stored `sort_order` that is not a value the column can hold.
 *
 * Raised rather than softened: a row like this means a data or migration
 * problem, and parking around it would compute a base from a number nobody
 * can trust.
 */
export class UnreadableVariantSortOrderError extends Error {
  constructor() {
    super('A package variant has an unreadable sort order');
    this.name = 'UnreadableVariantSortOrderError';
  }
}

export function isUnreadableVariantSortOrderError(
  error: unknown,
): error is UnreadableVariantSortOrderError {
  return error instanceof UnreadableVariantSortOrderError;
}

/**
 * There is no room above the values in use to park the existing rows.
 *
 * Raised before the first mutation, so an impossible reorder is refused
 * rather than surfacing mid-statement as a 22003 nobody can act on.
 */
export class VariantSortOrderExhaustedError extends Error {
  constructor() {
    super('Package variants cannot be reordered without exceeding the sort order range');
    this.name = 'VariantSortOrderExhaustedError';
  }
}

export function isVariantSortOrderExhaustedError(
  error: unknown,
): error is VariantSortOrderExhaustedError {
  return error instanceof VariantSortOrderExhaustedError;
}

function isPostgresInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= 0 && value <= POSTGRES_INTEGER_MAX;
}

/**
 * Where the existing rows will be parked, and whether they fit.
 *
 * The base sits above BOTH the highest value currently in use and the final
 * range `1..targetCount`, so a parked row can collide with neither a row that
 * has not moved yet nor a position about to be written.
 *
 * The int4 check is written as a subtraction so the comparison itself cannot
 * overflow, and it runs before any caller has written anything.
 *
 * Exported separately from the write below so a caller can refuse an
 * impossible reorder without opening the door to one.
 */
export function planVariantParking(
  existing: readonly VariantSortOrderRow[],
  targetCount: number,
): { base: number; existingCount: number } {
  const existingCount = existing.length;

  const maxExistingSortOrder = existing.reduce((max, row) => {
    if (!isPostgresInteger(row.sort_order)) {
      throw new UnreadableVariantSortOrderError();
    }

    return Math.max(max, row.sort_order);
  }, 0);

  const base = Math.max(maxExistingSortOrder, targetCount);

  if (base > POSTGRES_INTEGER_MAX - existingCount) {
    throw new VariantSortOrderExhaustedError();
  }

  return { base, existingCount };
}

/**
 * Moves every existing variant of one package out of the final range.
 *
 * The caller must already hold the rows under `FOR UPDATE` and pass them in:
 * the read stays with the caller because each one needs different columns
 * alongside `sort_order`, and because the lock is the caller's to order
 * relative to its own package lock.
 *
 * Existing rows are UPDATEd, never deleted and re-inserted.
 * `package_reservations` references `(variant_id, package_id)` with
 * ON DELETE RESTRICT, so variant ids have to survive a reorder — and a
 * reservation taken last year must still point at the variant it was taken
 * against.
 *
 * A package with no variants is a no-op rather than an error.
 */
export async function parkPackageVariantSortOrders(
  client: Queryable,
  packageId: string,
  existing: readonly VariantSortOrderRow[],
  targetCount: number,
): Promise<void> {
  const { base, existingCount } = planVariantParking(existing, targetCount);

  if (existingCount === 0) {
    return;
  }

  await client.query(
    // ROW_NUMBER() is bigint, so the addition is performed in bigint and
    // cannot overflow; the narrowing cast to int4 is safe because the guard
    // above already proved base + e fits. ORDER BY id only makes the
    // assignment reproducible — correctness does not depend on which row
    // receives which temporary position.
    `WITH parked AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
         FROM package_variants
        WHERE package_id = $1
     )
     UPDATE package_variants AS pv
        SET sort_order = ($2::int + parked.rn)::int
       FROM parked
      WHERE pv.id = parked.id`,
    [packageId, base],
  );
}
