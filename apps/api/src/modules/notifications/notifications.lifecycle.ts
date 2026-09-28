import { dispatchNotificationBatch, type DispatchSummary } from './notifications.dispatcher';
import type { NotificationsEnabled } from './notifications.config';

/**
 * The recurring half of notification delivery: a timer, and the discipline
 * around it.
 *
 * The dispatcher knows how to run one pass. This file decides when, and it
 * exists mostly to make three things impossible.
 *
 *   1. TWO PASSES AT ONCE. A pass can outlast its interval — five sequential
 *      sends at a ten-second timeout can take most of a minute — and a second
 *      pass starting on top of it would claim rows the first one is still
 *      sending to. `SKIP LOCKED` and the lease would blunt the damage, but
 *      within one process there is no reason to allow it at all: a tick that
 *      arrives while a pass is running is dropped.
 *
 *   2. ONE BAD PASS STOPPING EVERYTHING. A thrown claim — a dropped
 *      connection, a database restart — must not end the timer. It is caught,
 *      counted as one failed pass, and the next tick happens as usual.
 *
 *   3. SHUTTING DOWN MID-SEND. `stop()` prevents new passes and then WAITS for
 *      the one in flight, so the process does not close the database pool
 *      underneath a completion write that is about to record an email as
 *      accepted.
 *
 * It does not own the pool and never closes it. It reads no environment: the
 * settings arrive already validated.
 */

/** What the timer reports, per pass. Counts only — never a row or an address. */
export type NotificationDispatchReporter = {
  /** A pass finished. `summary` carries counts and nothing else. */
  readonly onPass?: (summary: DispatchSummary) => void;
  /** A pass threw. Only the claim can do this; row faults are counted inside. */
  readonly onFailure?: (error: unknown) => void;
};

export type NotificationLifecycle = {
  /**
   * Stops scheduling and resolves once any in-flight pass has finished.
   *
   * Safe to call more than once and safe to call before the first pass.
   */
  readonly stop: () => Promise<void>;
};

export type StartNotificationDispatchOptions = {
  readonly config: NotificationsEnabled;
  readonly reporter?: NotificationDispatchReporter;
  /** Replaced in tests. Production uses the real dispatcher. */
  readonly dispatch?: typeof dispatchNotificationBatch;
  /** Replaced in tests so no real timer is created. */
  readonly schedule?: (callback: () => void, ms: number) => NodeJS.Timeout;
  readonly cancel?: (handle: NodeJS.Timeout) => void;
  /**
   * Whether to run a pass at once rather than waiting a whole interval.
   *
   * On by default: a hotel that restarts its API should not wait thirty seconds
   * to send the confirmation that was queued while it was down.
   */
  readonly runImmediately?: boolean;
};

/**
 * Starts the recurring dispatcher.
 *
 * Only ever called from `src/server.ts`. `createApp()` must not reach this
 * file: an app instance is created by every HTTP test in the suite, and a timer
 * started there would have the whole test run polling a database and,
 * eventually, a provider.
 */
export function startNotificationDispatch(
  options: StartNotificationDispatchOptions,
): NotificationLifecycle {
  const dispatch = options.dispatch ?? dispatchNotificationBatch;
  const schedule = options.schedule ?? setInterval;
  const cancel = options.cancel ?? clearInterval;
  const reporter = options.reporter ?? {};

  let stopped = false;
  /** The pass currently running, or null. Both the guard and what `stop` awaits. */
  let inFlight: Promise<void> | null = null;

  const runPass = (): Promise<void> => {
    // A tick that lands on a running pass is dropped rather than queued.
    // Queueing would only guarantee the overlap it was avoiding, one interval
    // later, and a backlog is already the dispatcher's to drain a batch at a
    // time.
    if (inFlight || stopped) {
      return inFlight ?? Promise.resolve();
    }

    const pass = (async () => {
      try {
        const summary = await dispatch(options.config.settings);

        reporter.onPass?.(summary);
      } catch (error) {
        // Only a failed claim reaches here; the dispatcher counts row-level
        // faults and returns. Either way the timer survives it.
        reporter.onFailure?.(error);
      } finally {
        inFlight = null;
      }
    })();

    inFlight = pass;

    return pass;
  };

  const handle = schedule(() => {
    void runPass();
  }, options.config.dispatchIntervalMs);

  if (options.runImmediately !== false) {
    void runPass();
  }

  return {
    async stop(): Promise<void> {
      if (!stopped) {
        stopped = true;
        cancel(handle);
      }

      // Awaited, not abandoned. A pass that has sent an email but not yet
      // recorded it must be allowed to finish, or the row comes back on the
      // next deployment's first claim and the idempotency key becomes the only
      // thing standing between a guest and a duplicate.
      await inFlight;
    },
  };
}

/**
 * A console reporter in the project's existing style.
 *
 * Counts only. The summary type carries no address, subject, body, payload or
 * booking reference, so there is nothing here that could leak one — and the API
 * key never enters this module at all.
 *
 * A failure prints the error's message but never its `detail`: a PostgreSQL
 * `detail` can quote the offending row's values, and a notification row's
 * values include a guest's address.
 */
export const consoleNotificationReporter: NotificationDispatchReporter = {
  onPass(summary) {
    if (summary.configError) {
      console.error(`Notification dispatch refused its settings: ${summary.configError}`);
      return;
    }

    // Silence is the normal state of a healthy empty queue.
    if (summary.claimed === 0) {
      return;
    }

    console.log(
      'Notification dispatch pass: ' +
        `claimed=${summary.claimed} accepted=${summary.accepted} ` +
        `retryScheduled=${summary.retryScheduled} abandoned=${summary.abandoned} ` +
        `stale=${summary.stale} stateErrors=${summary.stateErrors}`,
    );
  },
  onFailure(error) {
    console.error(
      'Notification dispatch pass failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
  },
};
