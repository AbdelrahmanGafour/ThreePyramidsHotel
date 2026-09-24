import { closeDatabasePool, dbPool } from '../pool';
import { BROCHURE_PACKAGE_CATALOGUE } from './packageCatalogue';
import { runPackageCatalogueSeed, safeMessage } from './packageCatalogueRunner';
import { seedBrochurePackageCatalogue } from './packageCatalogueSeed';

/**
 * Seeds and reconciles the brochure package catalogue. Run deliberately by an
 * operator:
 *
 *   npm run seed:packages -w apps/api
 *
 * It is not wired into startup, migrations, postinstall, build, CI or the
 * development seed, because a catalogue write is an intentional act with a
 * production blast radius, not a side effect of running something else.
 *
 * Safe to re-run: reconciliation upserts by the brochure's own code/slug
 * identity, preserves row ids so existing reservations keep pointing at the
 * right variant, and refuses ambiguous or unexpected state rather than
 * deleting its way out of it. Nothing here truncates the catalogue.
 *
 * Output is operational only: counts, a stage name, and a message. The
 * database URL, credentials, statement parameters and raw error objects are
 * never printed.
 */

const EXIT_OK = 0;
const EXIT_FAILED = 1;
/** Distinct from a plain failure so an operator can see the outcome is unknown. */
const EXIT_UNCERTAIN = 2;

async function seedPackages(): Promise<number> {
  let client;

  try {
    client = await dbPool.connect();
  } catch (error) {
    console.error(`Package catalogue seed could not open a database connection: ${safeMessage(error)}`);
    return EXIT_FAILED;
  }

  const result = await runPackageCatalogueSeed({
    client,
    catalogue: BROCHURE_PACKAGE_CATALOGUE,
    seed: seedBrochurePackageCatalogue,
  });

  if (result.outcome === 'seeded') {
    console.log(`Package catalogue reconciled: ${result.offerings} offerings.`);
    return EXIT_OK;
  }

  if (result.outcome === 'uncertain') {
    console.error(
      'Package catalogue seed could not confirm its outcome: the commit was not acknowledged. ' +
        'The catalogue may or may not have been updated. Inspect the packages tables before running this again.',
    );
    console.error(`Reason: ${result.message}`);
    return EXIT_UNCERTAIN;
  }

  console.error(
    result.stage === 'begin'
      ? 'Package catalogue seed could not start a transaction. Nothing was written.'
      : 'Package catalogue seed failed and was rolled back. Nothing was written.',
  );
  console.error(`Reason: ${result.message}`);
  return EXIT_FAILED;
}

seedPackages()
  .then(async (exitCode) => {
    try {
      await closeDatabasePool();
    } catch (error) {
      console.error(`Failed to close the database pool: ${safeMessage(error)}`);
    }

    if (exitCode !== EXIT_OK) {
      process.exit(exitCode);
    }
  })
  .catch(async (error) => {
    console.error(`Package catalogue seed failed unexpectedly: ${safeMessage(error)}`);

    try {
      await closeDatabasePool();
    } catch (closeError) {
      console.error(`Failed to close the database pool: ${safeMessage(closeError)}`);
    }

    process.exit(EXIT_FAILED);
  });
