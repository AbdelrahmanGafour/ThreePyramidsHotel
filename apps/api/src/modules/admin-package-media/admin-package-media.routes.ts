import { Router } from 'express';
import { requireAdminSession } from '../admin-auth/admin-auth.middleware';
import { createLazyR2MediaStorageProvider, type MediaStorageProvider } from '../media/media.storage';
import {
  createDeletePackageImageHandler,
  createReplacePackageImageHandler,
  createUploadPackageImageHandler,
  rawImageBodyParser,
  updatePackageImageAltTextHandler,
} from './admin-package-media.controller';

/**
 * The journey media routes, split into two routers mounted as siblings of
 * `adminPackagesRouter` under the same `/api/v1/admin/packages` prefix —
 * never at any other path. Neither router creates a generic
 * `/:slug/:action` route; every route below is one exact, named path.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO ROUTERS
 *
 * The same reason `admin-room-type-media.routes.ts` is split, and the same
 * hazard. `app.ts` mounts `express.json()` globally, before most routers.
 * For a JSON body that is exactly right. For the raw binary POST and PUT it
 * is exactly wrong: a request declaring `Content-Type: application/json` —
 * or any other type body-parser's `json()` middleware is willing to attempt —
 * would have its body read, and on malformed JSON rejected with
 * `INVALID_JSON`, before `requireAdminSession` on this router ever ran. That
 * defeats these routes' own content-type rules and, worse, lets an
 * unauthenticated request cause body parsing to happen at all.
 *
 * So the two binary routes are not mounted where the rest of this feature
 * is. They are mounted in `app.ts` BEFORE `express.json()`, and
 * `createAdminPackageMediaUploadRouter` contains those two routes and
 * nothing else. `DELETE` has no body to parse and stays in
 * `createAdminPackageMediaRouter`, mounted after `express.json()` alongside
 * every other admin route.
 * ---------------------------------------------------------------------------
 *
 * Both factories default `getStorage` to a lazy provider that reads no
 * environment variable until it is called. `app.ts` passes the one shared
 * provider instead, so upload, replace, delete and the room-type media
 * routes all resolve the same client rather than each memoizing one of
 * their own.
 *
 * The guard is repeated on every route rather than hoisted to
 * `router.use()`, matching `admin-packages.routes.ts` and
 * `admin-room-type-media.routes.ts`: every route states its own protection,
 * and none can be read as inheriting it by accident.
 *
 * Route ordering cannot collide with `adminPackagesRouter`'s own `/:slug`,
 * `/:slug/status` or `/:slug/variants/:key`: every path below has an
 * `/image` segment none of those do, so Express's segment matching keeps the
 * routers disjoint regardless of mount order.
 */

/**
 * The two binary routes: `POST /:slug/image` and `PUT /:slug/image`.
 *
 * Mounted in `app.ts` before `express.json()`. For any request reaching
 * either, the effective order is fixed and total:
 *
 *     requireAdminSession  ->  rawImageBodyParser  ->  controller
 *
 * with no app-level body parser of any kind running first. An
 * unauthenticated caller cannot make Express touch the body at all — not to
 * parse it as JSON, not to buffer it as raw bytes.
 */
export function createAdminPackageMediaUploadRouter(
  getStorage: MediaStorageProvider = createLazyR2MediaStorageProvider(),
): Router {
  const router = Router();

  // Adding the one image a journey does not have yet. Refuses with 409 when
  // it already has one, rather than silently replacing it.
  router.post(
    '/:slug/image',
    requireAdminSession,
    rawImageBodyParser(),
    createUploadPackageImageHandler(getStorage),
  );

  // Swapping that image for another, atomically. The new object is written
  // before the transaction opens and the old one removed only after it
  // commits, so the journey is never without a usable image.
  router.put(
    '/:slug/image',
    requireAdminSession,
    rawImageBodyParser(),
    createReplacePackageImageHandler(getStorage),
  );

  return router;
}

/**
 * The journey media routes that want the JSON parser, or no body at all:
 * `PATCH /:slug/image/alt-text` and `DELETE /:slug/image`.
 *
 * Mounted after `express.json()`, where every other admin route lives.
 * `DELETE` needs storage because the object is removed after the commit, but
 * nothing about its request is parsed. `PATCH` is the opposite: it wants the
 * parsed body and touches no object at all, so
 * `updatePackageImageAltTextHandler` is not a factory and `getStorage` is
 * never passed to it — describing an image cannot reach object storage
 * because there is no provider in its hands to reach it with.
 */
export function createAdminPackageMediaRouter(
  getStorage: MediaStorageProvider = createLazyR2MediaStorageProvider(),
): Router {
  const router = Router();

  // More specific first, though Express matches on segment count so the two
  // paths below could not collide in either order. Stated so it stays that
  // way if an optional segment is ever introduced.
  router.patch('/:slug/image/alt-text', requireAdminSession, updatePackageImageAltTextHandler);

  router.delete('/:slug/image', requireAdminSession, createDeletePackageImageHandler(getStorage));

  return router;
}
