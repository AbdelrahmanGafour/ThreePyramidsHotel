import { Router } from 'express';
import { requireAdminSession } from '../admin-auth/admin-auth.middleware';
import { createLazyPublicMediaBaseUrlProvider, type PublicMediaBaseUrlProvider } from '../media/media.delivery';
import { createLazyR2MediaStorageProvider, type MediaStorageProvider } from '../media/media.storage';
import {
  createDeleteRoomTypeImageHandler,
  createListRoomTypeImagesHandler,
  createUploadRoomTypeImageHandler,
  rawImageBodyParser,
  setRoomTypeImageCoverHandler,
  updateRoomTypeImageAltTextHandler,
  updateRoomTypeImageOrderHandler,
} from './admin-room-type-media.controller';

/**
 * The room-type media routes, split into two routers mounted as siblings of
 * `adminRoomTypesRouter` under the same `/api/v1/admin/room-types` prefix
 * rather than as a second top-level namespace — never at any other path.
 * Neither router creates a generic `/:slug/:action` route; every route below
 * is one exact, named path.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO ROUTERS
 *
 * `app.ts` mounts `express.json()` globally, before any router. For a JSON
 * body that global parser is exactly right — every other admin route wants
 * its body parsed before it runs. For the raw binary upload it is exactly
 * wrong: a request declaring `Content-Type: application/json` (or any other
 * type body-parser's `json()` middleware is willing to attempt) would have
 * its body read, and on malformed JSON rejected with `INVALID_JSON`, before
 * `requireAdminSession` on this router ever ran. That both defeats the upload
 * route's own content-type rules and — worse — lets an unauthenticated
 * request cause body parsing to happen at all.
 *
 * So the upload route is not mounted where the rest of this feature is. It is
 * mounted on its own, in `app.ts`, BEFORE `express.json()`, and everything
 * below `createAdminRoomTypeMediaUploadRouter` is that one route and nothing
 * else. The five JSON-consuming routes stay in
 * `createAdminRoomTypeMediaRouter`, mounted where they always were — after
 * `express.json()`, same as every other admin route — and their behavior is
 * unchanged by any of this.
 * ---------------------------------------------------------------------------
 *
 * Both factories are called once per `createApp()`, so each app gets its own
 * routers, and a test app can be handed its own fake storage. `getStorage`
 * defaults to the production lazy R2 provider in each; `app.ts` passes one
 * shared instance to both, so upload and delete resolve the same underlying
 * client rather than each memoizing one of its own.
 *
 * The guard is repeated on the route rather than hoisted to `router.use()`,
 * matching `admin-room-types.routes.ts`: every route states its own
 * protection, and none can be read as inheriting it by accident.
 *
 * Route ordering here cannot collide with `adminRoomTypesRouter`'s own
 * `/:slug`, `/:slug/rooms` or `/:slug/capacity`: every path below has an
 * `/images` segment none of those do, so Express's segment-count matching
 * keeps the routers' routes disjoint regardless of mount order.
 */

/**
 * The one binary route: `POST /:slug/images`, and nothing else.
 *
 * Mounted in `app.ts` before `express.json()`. For any request reaching this
 * route, the effective order is fixed and total:
 *
 *     requireAdminSession  ->  rawImageBodyParser  ->  controller
 *
 * with no app-level body parser of any kind running first. An unauthenticated
 * caller cannot make Express touch the body at all — not to parse it as JSON,
 * not to buffer it as raw bytes — because `requireAdminSession` is the first
 * thing in this router's own chain and this router is the first thing `app.ts`
 * gives the request to.
 */
export function createAdminRoomTypeMediaUploadRouter(
  getStorage: MediaStorageProvider = createLazyR2MediaStorageProvider(),
  getPublicMediaBaseUrl: PublicMediaBaseUrlProvider = createLazyPublicMediaBaseUrlProvider(),
): Router {
  const router = Router();

  router.post(
    '/:slug/images',
    requireAdminSession,
    rawImageBodyParser(),
    createUploadRoomTypeImageHandler(getStorage, getPublicMediaBaseUrl),
  );

  return router;
}

/**
 * Every other room-type media route: the JSON-bodied ones, and the ones with
 * no body at all. Mounted in `app.ts` after `express.json()`, exactly where
 * this whole feature was mounted before this router was split — nothing about
 * their position, their guard, or their handlers changed.
 */
export function createAdminRoomTypeMediaRouter(
  getStorage: MediaStorageProvider = createLazyR2MediaStorageProvider(),
  getPublicMediaBaseUrl: PublicMediaBaseUrlProvider = createLazyPublicMediaBaseUrlProvider(),
): Router {
  const router = Router();

  router.get('/:slug/images', requireAdminSession, createListRoomTypeImagesHandler(getPublicMediaBaseUrl));

  router.patch('/:slug/images/:imageReference/alt-text', requireAdminSession, updateRoomTypeImageAltTextHandler);
  router.patch('/:slug/images/:imageReference/cover', requireAdminSession, setRoomTypeImageCoverHandler);
  router.patch('/:slug/images/:imageReference/order', requireAdminSession, updateRoomTypeImageOrderHandler);

  router.delete(
    '/:slug/images/:imageReference',
    requireAdminSession,
    createDeleteRoomTypeImageHandler(getStorage),
  );

  return router;
}
