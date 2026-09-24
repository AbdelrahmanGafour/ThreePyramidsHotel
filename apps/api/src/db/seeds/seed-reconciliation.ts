/**
 * Pure decision logic for reconciling the development room-type seed
 * (dev.ts) against a database that may already hold rows under the OLD
 * demo-* slugs (`demo-standard`, `demo-deluxe`, `demo-suite`) from before
 * the canonical `room-concept-0N` slugs existed.
 *
 * `rooms` and `reservations` both hold `room_type_id`, not a slug — so the
 * only reconciliation dev.ts ever performs for an already-legacy-seeded row
 * is an UPDATE of that row's own slug/content, by its existing id. Nothing
 * here inserts a second row for the same inventory, and nothing here
 * touches `rooms` or `reservations`.
 *
 * Kept dependency-free (no pg, no I/O) so the decision matrix can be
 * unit-tested directly.
 */

export type SeedReconciliationAction =
  /** No legacy row for this concept. Plain upsert-by-canonical-slug (covers both a clean DB and an already-migrated/idempotent re-run). */
  | "upsert-canonical"
  /** Only the legacy slug exists. Rename/update that row in place, preserving its id (and therefore every room/reservation FK into it). */
  | "migrate-legacy";

/**
 * Both a canonical row AND a legacy row exist for the same room concept.
 * Which one (if either) truly owns the live physical rooms can't be proven
 * from slugs alone — merging them would risk silently reassigning a room or
 * leaving duplicate bookable inventory. dev.ts throws rather than guessing.
 */
export class AmbiguousSeedStateError extends Error {
  constructor(
    readonly canonicalSlug: string,
    readonly legacySlug: string,
  ) {
    super(
      `Development seed conflict: both '${canonicalSlug}' and legacy '${legacySlug}' room types exist. ` +
        `Reconcile them manually (decide which one owns the live rooms, then drop or merge the other) before re-running the seed.`,
    );
    this.name = "AmbiguousSeedStateError";
  }
}

/**
 * Decides how to reconcile one room-type concept given only whether a row
 * already exists under its canonical slug and/or its legacy slug.
 *
 * Throws `AmbiguousSeedStateError` for the one case that can't be resolved
 * without guessing — both rows present at once.
 */
export function decideSeedReconciliation(input: {
  canonicalSlug: string;
  legacySlug: string;
  canonicalExists: boolean;
  legacyExists: boolean;
}): SeedReconciliationAction {
  const { canonicalSlug, legacySlug, canonicalExists, legacyExists } = input;

  if (canonicalExists && legacyExists) {
    throw new AmbiguousSeedStateError(canonicalSlug, legacySlug);
  }

  if (legacyExists) {
    return "migrate-legacy";
  }

  return "upsert-canonical";
}
