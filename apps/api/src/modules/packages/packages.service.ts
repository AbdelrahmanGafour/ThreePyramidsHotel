import { composePublicMediaUrl } from '../media/media.delivery';
import { parseMediaReference } from '../media/media.validation';
import { findActivePackageBySlug, findActivePackages } from './packages.repository';
import { parsePackageSlug } from './packages.validation';
import { PackageNotFoundError, type PackageCard, type PackageCardRecord, type PackageDetail, type PackageImage, type PackageImageRecord } from './packages.types';

/**
 * The public media base, resolved at most once per request and only when an
 * image actually needs a URL.
 *
 * Exactly the rule the public room-type endpoints already follow. A
 * catalogue of journeys that have no images is served without the base ever
 * being read, so a deployment that has not configured media yet still serves
 * the catalogue.
 *
 * The other half matters as much: when an image DOES exist and the base is
 * missing or malformed, the `MediaConfigurationError` propagates. It is not
 * caught, and an image is never quietly reported as `null`. Answering "this
 * journey has no picture" because the server cannot work out where its
 * pictures live would be a lie that looks exactly like the truth.
 */
export type MediaBaseResolver = () => string;

/**
 * The default for a caller that supplied no resolver: refuse, rather than
 * invent a base.
 *
 * Never reached by a journey with no image, which is what lets the pure
 * mapping tests call `toPackageCard` with one argument. It is not a fallback
 * URL and must never become one — there is no safe guess for where a
 * deployment serves its media from.
 */
const requireMediaBase: MediaBaseResolver = () => {
  throw new Error('A journey image needs the public media base, and none was provided');
};

/**
 * One image's public form: the stored identity turned into an address.
 *
 * A reference that is not canonical is this system's own data being wrong,
 * not anything the guest did, so it surfaces rather than being dressed up as
 * a journey with no picture. The offending value is deliberately not in the
 * message — this is a public endpoint, and an internal identifier does not
 * belong in an error a guest's request produced.
 */
function toPublicImage(record: PackageImageRecord, resolveMediaBase: MediaBaseResolver): PackageImage {
  const reference = parseMediaReference(record.reference);
  if (reference === null) throw new Error('Persisted journey media reference is not canonical');
  return { url: composePublicMediaUrl(resolveMediaBase(), reference), altText: record.altText,
    width: record.width, height: record.height };
}

export function toPackageCard(record: PackageCardRecord, resolveMediaBase: MediaBaseResolver = requireMediaBase): PackageCard {
  const status = record.requiresPriceConfirmation ? 'requires_confirmation' : record.fromRate ? 'from' : 'unavailable';
  return {
    code: record.code, slug: record.slug, title: record.title, summary: record.summary,
    durationLabel: record.durationLabel, scheduleLabel: record.scheduleLabel, operatingDays: record.operatingDays,
    currency: record.currency, requiresPriceConfirmation: record.requiresPriceConfirmation,
    pricing: { status, unit: 'per_person', from: status === 'unavailable' ? null : record.fromRate },
    // `null` stays null: the API reports what is stored, and a website's
    // fallback picture is that website's decision, not this layer's.
    image: record.image === null ? null : toPublicImage(record.image, resolveMediaBase),
  };
}

export async function listPackages(resolveMediaBase: MediaBaseResolver = requireMediaBase): Promise<PackageCard[]> {
  return (await findActivePackages()).map(record => toPackageCard(record, resolveMediaBase));
}

export async function getPackageBySlug(input: unknown, resolveMediaBase: MediaBaseResolver = requireMediaBase): Promise<PackageDetail> {
  const slug = parsePackageSlug(input);
  const record = await findActivePackageBySlug(slug);
  if (!record) throw new PackageNotFoundError();
  return { ...toPackageCard(record, resolveMediaBase), description: record.description, itinerary: record.itinerary,
    included: record.included, excluded: record.excluded, notes: record.notes, variants: record.variants };
}
