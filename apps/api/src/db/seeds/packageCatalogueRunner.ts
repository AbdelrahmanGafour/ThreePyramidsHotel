import type { BrochurePackageSeed } from './packageCatalogueSeed';

/**
 * Transaction orchestration for the package catalogue seed, kept apart from
 * the entry point so it can be exercised without a PostgreSQL server — and,
 * just as importantly, so importing it never evaluates the database
 * configuration the way importing the pool would.
 *
 * This module owns the transaction, which is the contract
 * `seedBrochurePackageCatalogue` states: it reconciles rows and leaves BEGIN,
 * COMMIT and ROLLBACK entirely to its caller. Nothing here retries, and
 * nothing here deletes or truncates the catalogue — reconciliation refuses
 * ambiguous state rather than resolving it destructively.
 */

/** The little of a `pg` client this runner needs, so a test can stand in for one. */
export type TransactionalClient = {
  query(queryText: string): Promise<unknown>;
  release(destroy?: boolean): void;
};

export type CatalogueSeeder<TClient> = (
  client: TClient,
  catalogue: readonly BrochurePackageSeed[],
) => Promise<void>;

/**
 * Where the attempt stopped. `commit` is deliberately distinct: a COMMIT that
 * throws leaves the outcome unknown rather than failed.
 */
export type PackageSeedStage = 'begin' | 'seed';

export type PackageSeedOutcome =
  /** The transaction committed. The catalogue is exactly the seeded one. */
  | { outcome: 'seeded'; offerings: number }
  /**
   * The attempt failed before COMMIT was issued, so nothing was written:
   * either BEGIN never succeeded, or the seed threw and the transaction was
   * rolled back.
   */
  | { outcome: 'failed'; stage: PackageSeedStage; message: string }
  /**
   * COMMIT itself threw. The database may or may not have applied the
   * transaction, and this runner has no way to find out. It is never reported
   * as a rollback, and no ROLLBACK is sent after the fact.
   */
  | { outcome: 'uncertain'; message: string };

/**
 * Reduces an unknown throwable to a single safe line.
 *
 * Only `message` is read. A `pg` error also carries `detail`, `where` and
 * `internalQuery`, which can echo the values a statement was given; none of
 * those is ever surfaced, and the error object itself is never logged.
 */
export function safeMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : 'unknown error';
}

export async function runPackageCatalogueSeed<TClient extends TransactionalClient>(options: {
  client: TClient;
  catalogue: readonly BrochurePackageSeed[];
  seed: CatalogueSeeder<TClient>;
}): Promise<PackageSeedOutcome> {
  const { client, catalogue, seed } = options;

  let stage: PackageSeedStage | 'commit' = 'begin';
  // A connection whose transaction state is unknown or broken is discarded
  // rather than handed back to the pool for the next caller to inherit.
  let discardConnection = false;

  try {
    await client.query('BEGIN');

    stage = 'seed';
    await seed(client, catalogue);

    stage = 'commit';
    await client.query('COMMIT');

    return { outcome: 'seeded', offerings: catalogue.length };
  } catch (error) {
    if (stage === 'commit') {
      // The acknowledgement was lost, not the work. Rolling back here would
      // be meaningless against an already-resolved transaction, and calling
      // it "rolled back" would assert something nobody knows.
      discardConnection = true;
      return { outcome: 'uncertain', message: safeMessage(error) };
    }

    if (stage === 'seed') {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The transaction is unresolved on a connection that no longer
        // answers; it must not be reused.
        discardConnection = true;
      }
    } else {
      // BEGIN never succeeded, so there is no transaction to end — but the
      // connection that refused it is not trustworthy either.
      discardConnection = true;
    }

    return { outcome: 'failed', stage, message: safeMessage(error) };
  } finally {
    client.release(discardConnection);
  }
}
