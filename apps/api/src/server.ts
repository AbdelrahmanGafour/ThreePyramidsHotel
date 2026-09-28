import { createApp } from './app';
import { env } from './config/env';
import { closeDatabasePool, verifyDatabaseConnection } from './db/pool';
import { loadNotificationConfig } from './modules/notifications/notifications.config';
import {
  consoleNotificationReporter,
  startNotificationDispatch,
  type NotificationLifecycle,
} from './modules/notifications/notifications.lifecycle';

async function start(): Promise<void> {
  await verifyDatabaseConnection();
  console.log('Database connection verified');

  // Read here and nowhere else in the request path. Disabled is the default and
  // costs nothing: no key, no addresses, no timer, and therefore not a single
  // outbox row claimed on a deployment that has not opted in.
  //
  // An enabled deployment whose settings are wrong throws out of this call and
  // the process fails to start, which is the intent. A hotel that believes it
  // is emailing guests and is not is worse off than one that refuses to boot.
  const notificationConfig = loadNotificationConfig(process.env);

  // This is the ONLY place notifications are started. `createApp()` must never
  // reach it: every HTTP test in the suite builds an app, and a timer started
  // there would have the whole run polling the database.
  const notifications: NotificationLifecycle | null = notificationConfig.enabled
    ? startNotificationDispatch({
        config: notificationConfig,
        reporter: consoleNotificationReporter,
      })
    : null;

  console.log(
    notificationConfig.enabled
      ? `Notification dispatch running every ${notificationConfig.dispatchIntervalMs}ms`
      : 'Notification dispatch disabled',
  );

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

    await stopNotifications();

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
        // Before the pool closes, and before the process exits: a pass that has
        // sent an email but not yet recorded it must be allowed to finish, or
        // the row returns on the next start and the provider's idempotency key
        // becomes the only thing between a guest and a duplicate.
        await stopNotifications();
        await closeDatabasePool();
        process.exit(0);
      } catch (error) {
        console.error('Failed to close database pool:', error);
        process.exit(1);
      }
    });
  }

  /** Drains the dispatcher. A failure here must not prevent the pool closing. */
  async function stopNotifications(): Promise<void> {
    if (!notifications) {
      return;
    }

    try {
      await notifications.stop();
    } catch (error) {
      console.error(
        'Failed to stop notification dispatch:',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
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
