import { createApp } from './app';
import { env } from './config/env';
import { closeDatabasePool, verifyDatabaseConnection } from './db/pool';

async function start(): Promise<void> {
  await verifyDatabaseConnection();
  console.log('Database connection verified');

  const app = createApp();

  const server = app.listen(env.port, () => {
    console.log(`API listening on port ${env.port}`);
  });

  // Declared before the error listener below so both paths share one guard.
  let shuttingDown = false;

  // `listen()` reports failures (EADDRINUSE and friends) asynchronously here, so the
  // pool would otherwise stay open and keep the process alive after a failed start.
  server.on('error', async (error) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.error('API server failed to start:', error);

    try {
      await closeDatabasePool();
    } catch (closeError) {
      console.error('Failed to close database pool:', closeError);
    }

    process.exit(1);
  });

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`${signal} received, shutting down API`);

    server.close(async () => {
      try {
        await closeDatabasePool();
        process.exit(0);
      } catch (error) {
        console.error('Failed to close database pool:', error);
        process.exit(1);
      }
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch(async (error) => {
  console.error('API failed to start:', error);

  try {
    await closeDatabasePool();
  } catch (closeError) {
    console.error('Failed to close database pool:', closeError);
  }

  process.exit(1);
});
