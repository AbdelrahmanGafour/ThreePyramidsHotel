import type { PoolClient } from 'pg';
import { dbPool } from '../../db/pool';
import { generatePackageBookingReference } from './booking-reference';
import { calculatePackagePrice, selectVariant, validateOperatingDay } from './package-reservations.pricing';
import { findReservationPackage, findReservationRate, findReservationVariants, insertPackageReservation } from './package-reservations.repository';
import {
  PackageReservationError,
  PackageReservationOutcomeUncertainError,
  type CreatedPackageReservation,
} from './package-reservations.types';
import { parsePackageReservationInput } from './package-reservations.validation';

/**
 * How this service gets its client.
 *
 * A seam, not a framework. It exists so a test can hand the service a client
 * whose `COMMIT` throws — the one failure that cannot be provoked against a
 * real, healthy PostgreSQL connection, and the one whose handling matters
 * most. Production never replaces it, so runtime behaviour is unchanged.
 */
type ClientFactory = () => Promise<PoolClient>;

const defaultClientFactory: ClientFactory = () => dbPool.connect();

let acquireClient: ClientFactory = defaultClientFactory;

/** Test seam. Passing `null` restores the pool. */
export function __setClientFactoryForTests(factory: ClientFactory | null): void {
  acquireClient = factory ?? defaultClientFactory;
}

export async function createPackageReservation(body: unknown): Promise<CreatedPackageReservation> {
  const input = parsePackageReservationInput(body);
  const client = await acquireClient();
  let transaction = false;
  let discardClient = false;
  try {
    // Consistent catalogue snapshot plus shared row locks: no package/variant/
    // selected-rate edits can overtake this creation. No hotel tables involved.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    transaction = true;
    const pkg = await findReservationPackage(client, input.packageSlug);
    if (!pkg) throw new PackageReservationError('PACKAGE_NOT_FOUND', 'Package not found', 404);
    const variant = selectVariant(await findReservationVariants(client, pkg.id), input.variantKey);
    validateOperatingDay(pkg, input.tourDate);
    const rate = await findReservationRate(client, variant.id, input.adults + input.children);
    if (!rate) throw new PackageReservationError('PACKAGE_RATE_UNAVAILABLE', 'No rate is defined for the selected party size', 409);
    const price = calculatePackagePrice(input, pkg, variant, rate.adultUnitRate);
    const bookingReference = generatePackageBookingReference();
    await insertPackageReservation(client, input, pkg, variant, price, bookingReference);
    const confirmation: CreatedPackageReservation = {
      bookingReference, status: 'pending', package: { code: pkg.code, slug: pkg.slug, title: pkg.title },
      variant: { key: variant.key, label: variant.label }, tourDate: input.tourDate,
      adults: input.adults, children: input.children, pricingStatus: price.pricingStatus,
      currency: 'USD', adultUnitRate: price.adultUnitRate, childUnitRate: price.childUnitRate, totalAmount: price.totalAmount,
    };
    try {
      await client.query('COMMIT');
    } catch (error) {
      // From here the transaction's fate is unknown, so nothing may be
      // inferred and nothing may be undone. `transaction` is cleared first so
      // the handler below does not attempt the ROLLBACK that would prove
      // nothing, and the connection is poisoned rather than returned to the
      // pool with a session whose state nobody can describe.
      transaction = false;
      discardClient = true;
      throw new PackageReservationOutcomeUncertainError(error);
    }
    transaction = false;
    return confirmation;
  } catch (error) {
    if (transaction) {
      // A definite pre-commit failure: the transaction is still open and
      // ending it proves the reservation was not written.
      try { await client.query('ROLLBACK'); }
      catch { discardClient = true; }
    } else {
      // Either BEGIN never succeeded, or COMMIT was attempted and did not
      // answer. Neither leaves a transaction this code may end, and neither
      // leaves a connection worth reusing.
      discardClient = true;
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}
