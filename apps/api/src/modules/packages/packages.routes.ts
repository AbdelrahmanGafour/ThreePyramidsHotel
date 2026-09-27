import { Router, type ErrorRequestHandler } from 'express';
import { createLazyPublicMediaBaseUrlProvider, type PublicMediaBaseUrlProvider } from '../media/media.delivery';
import { createGetPackageHandler, createListPackagesHandler } from './packages.controller';

/**
 * The public journey routes, built with the deployment's public media base
 * provider — the same shape `createRoomsRouter` already takes, and the same
 * provider instance in `app.ts`.
 *
 * Built per app rather than exported as one shared router so a test can hand
 * it its own provider without perturbing any other route. The default exists
 * so nothing is forced to care: creating the provider reads no environment
 * variable, and the value behind it is read only when a response actually
 * contains an image.
 */
export function createPackagesRouter(
  getPublicMediaBaseUrl: PublicMediaBaseUrlProvider = createLazyPublicMediaBaseUrlProvider(),
): Router {
  const router = Router();

  router.get('/', createListPackagesHandler(getPublicMediaBaseUrl));
  router.get('/:slug', createGetPackageHandler(getPublicMediaBaseUrl));

  const packageErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    // Express can reject malformed URI escapes before the controller runs.
    if (error instanceof URIError) {
      res.status(400).json({ error: { code: 'INVALID_PACKAGE_SLUG', message: 'Invalid package slug encoding' } });
      return;
    }
    // Never expose PostgreSQL errors, a media configuration message, or turn
    // an outage into a missing package. A malformed public media base lands
    // here as the same sanitized 500 every other server fault does — the
    // variable it names stays server-side.
    res.status(500).json({ error: { code: 'PACKAGES_UNAVAILABLE', message: 'Package catalogue unavailable' } });
  };
  router.use(packageErrorHandler);

  return router;
}

/**
 * The router as a value, built with the default provider.
 *
 * Preserved because it is what existed before this route needed a provider,
 * and because a caller that does not care about injection should not have
 * to. `app.ts` uses the factory and passes the shared provider.
 */
export const packagesRouter = createPackagesRouter();
