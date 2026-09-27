import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { composePublicMediaUrl, type PublicMediaBaseUrlProvider } from '../media/media.delivery';
import { parseMediaReference } from '../media/media.validation';
import type {
  AdminPackageDetail,
  AdminPackageDetailRecord,
  AdminPackageImage,
  AdminPackageImageRecord,
} from './admin-packages.types';

// Turning a stored journey into the one an administrator is answered with.
//
// There is exactly one difference between the two, and it is the image: the
// repository reads a media *reference*, and a response carries a *URL*.
// Composing that URL needs the deployment's public media base, which is
// configuration — so it happens here, at the HTTP boundary, and never in the
// repository, which stays PostgreSQL and row-mapping only.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A MIDDLEWARE AND A HELPER RATHER THAN TWELVE FACTORIES
//
// Twelve admin endpoints answer with a whole journey — the read, the create,
// the edits, and every variant, content, itinerary and rate operation. All of
// them return the same shape, so all of them need the same projection, and
// writing it at twelve response sites would be twelve places to get it wrong.
//
// So the router installs `attachMediaBaseResolver` once, which puts a
// per-request resolver on `res.locals`, and every one of those twelve sites
// calls `respondWithAdminPackage`. One projection, one injection point, and
// the provider arrives explicitly through the router factory rather than
// through a module-level variable anything could reassign.
//
// The resolver is per request and memoized within it, so a response carrying
// several journeys — none do today — would still resolve the base once.
// ---------------------------------------------------------------------------

/** Where a journey image's URL is composed from, resolved on demand. */
export type MediaBaseResolver = () => string;

/**
 * Resolves the public media base at most once, and only if something asks.
 *
 * The same rule the public catalogue and the public room-type endpoints
 * follow. A journey with no image is answered without the media
 * configuration ever being read, so a deployment that has not set it up
 * still serves the admin catalogue.
 *
 * The other half matters as much: when an image DOES exist and the base is
 * missing or malformed, the `MediaConfigurationError` propagates. It is not
 * caught here, and an image is never quietly reported as `null` — answering
 * "this journey has no picture" because the server cannot work out where its
 * pictures live would be a lie that looks exactly like the truth. Express
 * turns it into the same sanitized 500 every other server fault becomes.
 */
export function createMediaBaseResolver(provider: PublicMediaBaseUrlProvider): MediaBaseResolver {
  let resolved: string | null = null;

  return () => {
    if (resolved === null) {
      resolved = provider();
    }

    return resolved;
  };
}

/** Where the per-request resolver lives between the middleware and the helper. */
const RESOLVER_KEY = 'adminPackageMediaBaseResolver';

/**
 * Attaches one resolver per request.
 *
 * Installed by `createAdminPackagesRouter` with the provider `app.ts`
 * already shares with the media routers and the public catalogue.
 *
 * Deliberately NOT a guard, and not to be read as one: `requireAdminSession`
 * stays stated on every individual route, as this module's routes always
 * have. This middleware carries a value, not permission, and a request that
 * never reaches a handler simply never uses it.
 */
export function attachMediaBaseResolver(provider: PublicMediaBaseUrlProvider): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.locals[RESOLVER_KEY] = createMediaBaseResolver(provider);
    next();
  };
}

/**
 * The resolver this request was given.
 *
 * Throws when a route was mounted without the middleware — a wiring mistake,
 * and one that must be loud rather than silently producing a journey with no
 * picture. Only ever called when there is actually an image to address, so a
 * handler invoked directly in a test with a bare response object still works
 * for every journey that has none.
 */
function mediaBaseResolverOf(res: Response): MediaBaseResolver {
  const resolver = (res.locals as Record<string, unknown>)[RESOLVER_KEY];

  if (typeof resolver !== 'function') {
    throw new Error('Admin package route is missing its public media base resolver');
  }

  return resolver as MediaBaseResolver;
}

/**
 * One stored image's public form: identity turned into an address.
 *
 * The reference is re-proved rather than trusted. It arrives from the
 * repository, which already parsed it, so a failure here means something
 * between the two changed it — and that is this system's own data being
 * wrong, not anything the administrator did.
 */
export function toAdminPackageImage(
  record: AdminPackageImageRecord | null,
  resolveMediaBase: MediaBaseResolver,
): AdminPackageImage | null {
  if (record === null) {
    return null;
  }

  const reference = parseMediaReference(record.reference);

  if (reference === null) {
    throw new Error('Persisted journey media reference is not canonical');
  }

  return {
    reference,
    url: composePublicMediaUrl(resolveMediaBase(), reference),
    altText: record.altText,
    width: record.width,
    height: record.height,
  };
}

/**
 * The stored journey as an administrator is answered with it.
 *
 * Every field but `image` is carried through unchanged; the image is the one
 * thing a response says differently from a row.
 */
export function toAdminPackageDetail(
  record: AdminPackageDetailRecord,
  resolveMediaBase: MediaBaseResolver,
): AdminPackageDetail {
  return { ...record, image: toAdminPackageImage(record.image, resolveMediaBase) };
}

/**
 * The one way this module answers with a journey.
 *
 * Every endpoint that returns a whole journey goes through here, so the
 * projection exists once. The resolver is read lazily — inside
 * `toAdminPackageImage`, and only past the null check — which is what keeps
 * a journey with no image from touching the media configuration at all.
 */
export function respondWithAdminPackage(
  res: Response,
  status: number,
  record: AdminPackageDetailRecord,
): void {
  const data = toAdminPackageDetail(record, () => mediaBaseResolverOf(res)());

  res.status(status).json({ data });
}
