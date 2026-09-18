import express from 'express';
import type { Express } from 'express';
import { availabilityRouter } from './modules/availability/availability.routes';
import { healthRouter } from './modules/health/health.routes';
import { roomsRouter } from './modules/rooms/rooms.routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use('/health', healthRouter);
  app.use('/api/v1/rooms', roomsRouter);
  app.use('/api/v1/availability', availabilityRouter);

  return app;
}
