import { dbPool } from '../../db/pool';
import { generatePackageBookingReference } from './booking-reference';
import { calculatePackagePrice, selectVariant, validateOperatingDay } from './package-reservations.pricing';
import { findReservationPackage, findReservationRate, findReservationVariants, insertPackageReservation } from './package-reservations.repository';
import { PackageReservationError, type CreatedPackageReservation } from './package-reservations.types';
import { parsePackageReservationInput } from './package-reservations.validation';

export async function createPackageReservation(body: unknown): Promise<CreatedPackageReservation> {
  const input = parsePackageReservationInput(body);
  const client = await dbPool.connect();
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
      currency: 'EGP', adultUnitRate: price.adultUnitRate, childUnitRate: price.childUnitRate, totalAmount: price.totalAmount,
    };
    await client.query('COMMIT');
    transaction = false;
    return confirmation;
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK'); }
      catch { discardClient = true; }
    } else {
      // A failed BEGIN may indicate a broken connection; never reuse it.
      discardClient = true;
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}
