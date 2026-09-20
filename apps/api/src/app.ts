import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { adminAuthRouter } from './modules/admin-auth/admin-auth.routes';
import { availabilityRouter } from './modules/availability/availability.routes';
import { healthRouter } from './modules/health/health.routes';
import { reservationsRouter } from './modules/reservations/reservations.routes';
import { roomsRouter } from './modules/rooms/rooms.routes';

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

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.use('/health', healthRouter);
  app.use('/api/v1/rooms', roomsRouter);
  app.use('/api/v1/availability', availabilityRouter);
  app.use('/api/v1/reservations', reservationsRouter);
  app.use('/api/v1/admin/auth', adminAuthRouter);

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
