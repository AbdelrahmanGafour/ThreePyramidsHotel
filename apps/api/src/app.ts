import express from 'express';
import type { Express } from 'express';
import { availabilityRouter } from './modules/availability/availability.routes';
import { healthRouter } from './modules/health/health.routes';
import { reservationsRouter } from './modules/reservations/reservations.routes';
import { roomsRouter } from './modules/rooms/rooms.routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.use('/health', healthRouter);
  app.use('/api/v1/rooms', roomsRouter);
  app.use('/api/v1/availability', availabilityRouter);
  app.use('/api/v1/reservations', reservationsRouter);

  return app;
}
