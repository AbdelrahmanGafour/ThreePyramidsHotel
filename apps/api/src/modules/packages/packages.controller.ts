import type { Request, RequestHandler, Response } from 'express';
import type { PublicMediaBaseUrlProvider } from '../media/media.delivery';
import { getPackageBySlug, listPackages, type MediaBaseResolver } from './packages.service';
import { InvalidPackageSlugError, PackageNotFoundError } from './packages.types';

/**
 * Resolves the public media base at most once per request, and only if an
 * image actually needs a URL.
 *
 * The same helper shape the public room-type handlers use, and the same
 * reason: a catalogue of journeys with no images must not require media to
 * be configured, and a journey that HAS one must not be served as though it
 * had none when the base is missing.
 *
 * No `MediaStorage` anywhere in this file. Reading the catalogue touches no
 * object, so there is no provider to resolve and nothing that could PUT or
 * DELETE.
 */
function createMediaBaseResolver(getPublicMediaBaseUrl: PublicMediaBaseUrlProvider): MediaBaseResolver {
  let resolved: string | null = null;

  return () => {
    if (resolved === null) resolved = getPublicMediaBaseUrl();
    return resolved;
  };
}

export function createListPackagesHandler(getPublicMediaBaseUrl: PublicMediaBaseUrlProvider): RequestHandler {
  return async function listPackagesHandler(_req: Request, res: Response): Promise<void> {
    // Composed in full BEFORE the response is touched. `res.status(200)`
    // mutates the response even though nothing is sent yet, so composing
    // inside the `json()` argument would leave a half-configured 200 behind
    // on a media configuration failure.
    const data = await listPackages(createMediaBaseResolver(getPublicMediaBaseUrl));

    res.status(200).json({ data });
  };
}

export function createGetPackageHandler(getPublicMediaBaseUrl: PublicMediaBaseUrlProvider): RequestHandler {
  return async function getPackageHandler(req: Request, res: Response): Promise<void> {
    try {
      const data = await getPackageBySlug(
        (req.params as { slug: string }).slug,
        createMediaBaseResolver(getPublicMediaBaseUrl),
      );

      res.status(200).json({ data });
    } catch (error) {
      if (error instanceof InvalidPackageSlugError || error instanceof PackageNotFoundError) {
        res.status(error instanceof InvalidPackageSlugError ? 400 : 404)
          .json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  };
}
