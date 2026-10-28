/**
 * Small helpers for the MySQL integration tests of the core modules.
 *
 * MySQL has no `RETURNING` and no `::int` cast, and the pool adapter returns
 * every BIGINT (including `COUNT(*)`) as a string, as `pg` used to for int8.
 */

/** Converts every value of a counts row to a number, for `deepEqual` checks. */
export function toNumbers<T extends Record<string, unknown>>(row: T): { [K in keyof T]: number } {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])) as {
    [K in keyof T]: number;
  };
}

/** The generated key of an INSERT, replacing `RETURNING id`. */
export function insertedId(result: { insertId?: string }): string {
  if (!result.insertId) {
    throw new Error('INSERT produced no generated id');
  }

  return result.insertId;
}
