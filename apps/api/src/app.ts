import express from 'express';
import type { Express } from 'express';
import { healthRouter } from './modules/health/health.routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use('/health', healthRouter);

  return app;
}
