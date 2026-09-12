import { createApp } from './app';
import { env } from './config/env';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`API listening on port ${env.port}`);
});

server.on('error', (error) => {
  console.error('API server failed to start:', error);
  process.exit(1);
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} received, shutting down API`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
