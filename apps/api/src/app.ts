import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { adminAuthRouter } from './modules/admin-auth/admin-auth.routes';
import { adminReservationsRouter } from './modules/admin-reservations/admin-reservations.routes';
import {
  createAdminRoomTypeMediaRouter,
  createAdminRoomTypeMediaUploadRouter,
} from './modules/admin-room-type-media/admin-room-type-media.routes';
import { adminRoomTypesRouter } from './modules/admin-room-types/admin-room-types.routes';
import { adminRoomsRouter } from './modules/admin-rooms/admin-rooms.routes';
import { availabilityRouter } from './modules/availability/availability.routes';
import { healthRouter } from './modules/health/health.routes';
import { createLazyPublicMediaBaseUrlProvider, type PublicMediaBaseUrlProvider } from './modules/media/media.delivery';
import { createLazyR2MediaStorageProvider, type MediaStorageProvider } from './modules/media/media.storage';
import { reservationsRouter } from './modules/reservations/reservations.routes';
import { createRoomsRouter } from './modules/rooms/rooms.routes';
import { packagesRouter } from './modules/packages/packages.routes';
import { packageReservationsRouter } from './modules/package-reservations/package-reservations.routes';

/**
 * What a caller may configure about the app it builds.
 *
 * `mediaStorageProvider` exists for tests: passing one swaps the real,
 * lazily-constructed R2 adapter for a double, and every other route is
 * unaffected. `publicMediaBaseUrlProvider` is its delivery-side twin: passing
 * one swaps the real `R2_PUBLIC_BASE_URL` resolution for a fake base, without
 * touching storage at all — the two are unrelated configuration and a test
 * can exercise either failing on its own.
 *
 * Left unset, `createApp` builds its own production default for each and
 * hands the SAME instance of each to both the upload and the JSON media
 * routers, so the two routers share one lazily-memoized value per concern
 * instead of each holding one of their own. Resolving either default reads no
 * environment variable until an upload, a delete, or a response that needs a
 * `url` actually asks for it.
 */
export type CreateAppOptions = {
  mediaStorageProvider?: MediaStorageProvider;
  publicMediaBaseUrlProvider?: PublicMediaBaseUrlProvider;
};

/**
 * Recognizes only a body-parser JSON failure, by the marker express.json()
 * attaches. A bare SyntaxError from anywhere else is not a malformed request
 * body and must not be reported as one.
 */
function isJsonParseError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { type?: unknown; status?: unknown; statusCode?: unknown };

  return (
    candidate.type === 'entity.parse.failed' && (candidate.status === 400 || candidate.statusCode === 400)
  );
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');

  // Two providers, each shared by the upload router below and the JSON media
  // router further down, so both resolve the same lazily-memoized value per
  // concern instead of each building — and each separately caching — one of
  // their own. Storage and public delivery are unrelated configuration:
  // resolving one never requires or touches the other.
  const mediaStorageProvider = options.mediaStorageProvider ?? createLazyR2MediaStorageProvider();
  const publicMediaBaseUrlProvider =
    options.publicMediaBaseUrlProvider ?? createLazyPublicMediaBaseUrlProvider();

  // The one binary route, mounted BEFORE express.json() and before every
  // other router. This is deliberate and load-bearing: express.json() is a
  // global parser that would otherwise see this route's body first, on every
  // Content-Type it is willing to attempt — including a request that merely
  // DECLARES application/json — and either parse it or reject malformed JSON
  // with INVALID_JSON before this route's own `requireAdminSession` ever ran.
  // Mounting the upload router here means no app-level body parser of any
  // kind touches this route's request before its own guard does; the router
  // contains exactly one route, POST /:slug/images, and nothing else, so no
  // other admin-room-types path is affected by where it sits.
  app.use(
    '/api/v1/admin/room-types',
    createAdminRoomTypeMediaUploadRouter(mediaStorageProvider, publicMediaBaseUrlProvider),
  );

  app.use(express.json());

  app.use('/health', healthRouter);
  // Public room types, built with the shared public-media provider above so a
  // room's images carry real URLs. Resolving that base is still lazy: a room
  // type with no images never reads it.
  app.use('/api/v1/rooms', createRoomsRouter(publicMediaBaseUrlProvider));
  app.use('/api/v1/packages', packagesRouter);
  app.use('/api/v1/package-reservations', packageReservationsRouter);
  app.use('/api/v1/availability', availabilityRouter);
  app.use('/api/v1/reservations', reservationsRouter);
  app.use('/api/v1/admin/auth', adminAuthRouter);
  // Administration reads, guarded inside the router itself.
  app.use('/api/v1/admin/reservations', adminReservationsRouter);
  app.use('/api/v1/admin/room-types', adminRoomTypesRouter);
  // A third router at the identical prefix, not a new top-level namespace:
  // the JSON-bodied and no-body room-type media routes, mounted after
  // express.json() exactly like every other admin route. Every path it
  // defines carries an `/images` segment that `adminRoomTypesRouter` has none
  // of, and the upload router above owns the one path this router does not
  // define (POST), so none of the three ever compete for the same request.
  // Built fresh per app so a test can hand it its own storage provider
  // without perturbing every other route.
  app.use(
    '/api/v1/admin/room-types',
    createAdminRoomTypeMediaRouter(mediaStorageProvider, publicMediaBaseUrlProvider),
  );
  // Physical rooms, addressed by room number. A different namespace from the
  // public /api/v1/rooms above, which serves room types to guests.
  app.use('/api/v1/admin/rooms', adminRoomsRouter);

  // Malformed JSON is a client mistake, so it gets a clear 400 instead of the
  // default HTML error page. Everything else continues to Express.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (isJsonParseError(error)) {
      res.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Request body contains invalid JSON',
        },
      });
      return;
    }

    next(error);
  });

  return app;
}
