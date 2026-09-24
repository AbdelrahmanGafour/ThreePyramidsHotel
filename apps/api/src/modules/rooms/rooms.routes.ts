import { Router } from 'express';
import { createLazyPublicMediaBaseUrlProvider, type PublicMediaBaseUrlProvider } from '../media/media.delivery';
import { createGetRoomTypeBySlugHandler, createListRoomTypesHandler } from './rooms.controller';

/**
 * The public room-type routes, built with the deployment's public media base
 * provider — the same shape `createAdminRoomTypeMediaRouter` already takes.
 *
 * Built per app rather than exported as a single shared router so a test can
 * hand it its own provider without perturbing any other route. The default
 * exists so nothing is forced to care: creating the provider reads no
 * environment variable, and the value behind it is read only when a response
 * actually contains an image.
 */
export function createRoomsRouter(
  getPublicMediaBaseUrl: PublicMediaBaseUrlProvider = createLazyPublicMediaBaseUrlProvider(),
): Router {
  const router = Router();

  router.get('/', createListRoomTypesHandler(getPublicMediaBaseUrl));
  router.get('/:slug', createGetRoomTypeBySlugHandler(getPublicMediaBaseUrl));

  return router;
}
