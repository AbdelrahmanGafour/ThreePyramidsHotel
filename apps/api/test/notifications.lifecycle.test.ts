import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { loadNotificationConfig } from '../src/modules/notifications/notifications.config';
import type { NotificationDispatchReporter } from '../src/modules/notifications/notifications.lifecycle';
import type {
  DispatchSummary,
  DispatcherSettings,
} from '../src/modules/notifications/notifications.dispatcher';

type LifecycleModule = typeof import('../src/modules/notifications/notifications.lifecycle.js');

let startNotificationDispatch: LifecycleModule['startNotificationDispatch'];

before(async () => {
  // The runner imports the dispatcher for its production default, which reaches
  // `db/pool` and reads the environment at module load. Nothing here connects —
  // both the timer and the dispatcher are injected — so a placeholder is enough.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ startNotificationDispatch } = await import(
    '../src/modules/notifications/notifications.lifecycle.js'
  ));
});

// The recurring runner, with both the timer and the dispatcher injected.
//
// No real timer is created and no pass ever reaches a database or a provider,
// so the three properties worth proving are all observable: that ticks cannot
// overlap, that a failed pass does not end the schedule, and that `stop()`
// waits rather than abandoning work.

const SETTINGS: DispatcherSettings = {
  apiKey: 're_test_key',
  fromAddress: 'stay@example.test',
  hotelRecipient: 'desk@example.test',
  requestTimeoutMs: 5000,
  batchSize: 2,
  maxAttempts: 5,
  claimLeaseSeconds: 15,
  retryDelaySecondsFor: () => 60,
};

const CONFIG = { enabled: true, settings: SETTINGS, dispatchIntervalMs: 30_000 } as const;

const summary = (overrides: Partial<DispatchSummary> = {}): DispatchSummary => ({
  claimed: 0,
  accepted: 0,
  retryScheduled: 0,
  abandoned: 0,
  stale: 0,
  stateErrors: 0,
  ...overrides,
});

/** A controllable clock: `tick()` fires whatever the runner scheduled. */
function fakeTimer() {
  let scheduled: (() => void) | null = null;
  let cancelled = false;
  let intervalMs = 0;

  return {
    get intervalMs() {
      return intervalMs;
    },
    get cancelled() {
      return cancelled;
    },
    tick(): void {
      assert.ok(scheduled, 'nothing was scheduled');
      scheduled();
    },
    schedule: ((callback: () => void, ms: number) => {
      scheduled = callback;
      intervalMs = ms;

      return 'handle' as unknown as NodeJS.Timeout;
    }) as NonNullable<Parameters<LifecycleModule['startNotificationDispatch']>[0]['schedule']>,
    cancel: (() => {
      cancelled = true;
    }) as NonNullable<Parameters<LifecycleModule['startNotificationDispatch']>[0]['cancel']>,
  };
}

/** A dispatcher whose passes finish only when the test says so. */
function controllableDispatch() {
  const state = {
    calls: 0,
    concurrent: 0,
    maxConcurrent: 0,
    resolvers: [] as Array<(value: DispatchSummary) => void>,
    rejecters: [] as Array<(reason: unknown) => void>,
  };

  const dispatch = (async () => {
    state.calls += 1;
    state.concurrent += 1;
    state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);

    try {
      return await new Promise<DispatchSummary>((resolve, reject) => {
        state.resolvers.push(resolve);
        state.rejecters.push(reject);
      });
    } finally {
      state.concurrent -= 1;
    }
  }) as unknown as NonNullable<Parameters<LifecycleModule['startNotificationDispatch']>[0]['dispatch']>;

  return {
    state,
    dispatch,
    /** Finishes the oldest outstanding pass. */
    finish(value: DispatchSummary = summary()): void {
      const resolve = state.resolvers.shift();
      state.rejecters.shift();
      assert.ok(resolve, 'no pass was waiting');
      resolve(value);
    },
    fail(reason: unknown = new Error('simulated pass failure')): void {
      const reject = state.rejecters.shift();
      state.resolvers.shift();
      assert.ok(reject, 'no pass was waiting');
      reject(reason);
    },
  };
}

/** Lets already-queued microtasks run. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('a disabled deployment never dispatches', () => {
  it('starts nothing, because nothing calls the runner', () => {
    // The runner only accepts an enabled config; the decision not to start it
    // lives in `server.ts`, and this is what that decision looks like.
    const config = loadNotificationConfig({});

    assert.equal(config.enabled, false);
    // Nothing else to assert: with `enabled: false` there is no settings object
    // to hand to `startNotificationDispatch`, so it cannot be called by mistake.
  });
});

describe('an enabled deployment dispatches', () => {
  it('runs a pass at once and schedules the interval', async () => {
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });

    assert.equal(dispatcher.state.calls, 1, 'a queued confirmation is not made to wait an interval');
    assert.equal(timer.intervalMs, 30_000, 'and the interval is the configured one');

    dispatcher.finish();
    await lifecycle.stop();
  });

  it('can be told not to run immediately', async () => {
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
      runImmediately: false,
    });

    assert.equal(dispatcher.state.calls, 0);

    timer.tick();
    assert.equal(dispatcher.state.calls, 1);

    dispatcher.finish();
    await lifecycle.stop();
  });

  it('runs a pass per tick once the previous one has finished', async () => {
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
      runImmediately: false,
    });

    for (let pass = 1; pass <= 3; pass += 1) {
      timer.tick();
      assert.equal(dispatcher.state.calls, pass);
      dispatcher.finish();
      await settle();
    }

    await lifecycle.stop();
  });

  it('passes the validated settings straight through', async () => {
    const timer = fakeTimer();
    let seen: DispatcherSettings | null = null;

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: (async (settings: DispatcherSettings) => {
        seen = settings;
        return summary();
      }) as NonNullable<Parameters<LifecycleModule['startNotificationDispatch']>[0]['dispatch']>,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });

    await settle();
    await lifecycle.stop();

    assert.equal(seen, SETTINGS, 'the same object, unmodified');
  });
});

describe('passes never overlap', () => {
  it('drops a tick that arrives while a pass is still running', async () => {
    // A pass can outlast its interval: five sequential sends at a ten-second
    // timeout take most of a minute.
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });

    assert.equal(dispatcher.state.calls, 1, 'the immediate pass is running');

    timer.tick();
    timer.tick();
    timer.tick();

    assert.equal(dispatcher.state.calls, 1, 'three ticks, no second pass');
    assert.equal(dispatcher.state.maxConcurrent, 1, 'and never two at once');

    dispatcher.finish();
    await settle();

    // Once it has finished, the next tick runs normally.
    timer.tick();
    assert.equal(dispatcher.state.calls, 2);

    dispatcher.finish();
    await lifecycle.stop();
  });

  it('does not queue the dropped ticks up to run later', async () => {
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });

    for (let skipped = 0; skipped < 5; skipped += 1) {
      timer.tick();
    }

    dispatcher.finish();
    await settle();

    // A queue of five deferred passes would guarantee the overlap it was
    // avoiding, one interval later.
    assert.equal(dispatcher.state.calls, 1, 'the dropped ticks are gone, not deferred');

    await lifecycle.stop();
  });
});

describe('a failed pass does not end the schedule', () => {
  it('reports the failure and keeps the timer', async () => {
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();
    const failures: unknown[] = [];

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
      reporter: { onFailure: (error) => failures.push(error) },
    });

    dispatcher.fail(new Error('claim failed'));
    await settle();

    assert.equal(failures.length, 1, 'the failure was reported');
    assert.equal(timer.cancelled, false, 'and the schedule survived it');

    timer.tick();
    assert.equal(dispatcher.state.calls, 2, 'the next tick ran');

    dispatcher.finish();
    await lifecycle.stop();
  });

  it('survives several consecutive failures', async () => {
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
      runImmediately: false,
    });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      timer.tick();
      assert.equal(dispatcher.state.calls, attempt, `tick ${attempt} still runs`);
      dispatcher.fail();
      await settle();
    }

    await lifecycle.stop();
  });

  it('does not throw out of the tick', async () => {
    // An unhandled rejection from a timer callback would take the process down.
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });

    dispatcher.fail();
    await assert.doesNotReject(async () => {
      await settle();
    });

    await lifecycle.stop();
  });
});

describe('stopping', () => {
  it('cancels the schedule and prevents further passes', async () => {
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
      runImmediately: false,
    });

    await lifecycle.stop();

    assert.equal(timer.cancelled, true);

    // Even a tick that somehow fires after cancellation starts nothing.
    timer.tick();
    assert.equal(dispatcher.state.calls, 0, 'no pass after stop');
  });

  it('waits for a pass that is still in flight', async () => {
    // The reason this matters: a pass that has sent an email but not yet
    // recorded it must finish before the pool closes underneath it.
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });

    assert.equal(dispatcher.state.calls, 1);

    let stopped = false;
    const stopping = lifecycle.stop().then(() => {
      stopped = true;
    });

    await settle();
    assert.equal(stopped, false, 'stop is still waiting on the pass');

    dispatcher.finish();
    await stopping;

    assert.equal(stopped, true, 'and resolves once it has finished');
  });

  it('waits even when the in-flight pass fails', async () => {
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });

    const stopping = lifecycle.stop();
    dispatcher.fail();

    await assert.doesNotReject(() => stopping, 'a failed pass must not reject stop');
  });

  it('is safe to call twice, and before any pass has run', async () => {
    const timer = fakeTimer();
    const dispatcher = controllableDispatch();

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: dispatcher.dispatch,
      schedule: timer.schedule,
      cancel: timer.cancel,
      runImmediately: false,
    });

    await lifecycle.stop();
    await lifecycle.stop();

    assert.equal(dispatcher.state.calls, 0);
  });
});

describe('what the reporter is allowed to see', () => {
  it('receives counts and nothing else', async () => {
    const timer = fakeTimer();
    const seen: DispatchSummary[] = [];
    const reporter: NotificationDispatchReporter = { onPass: (value) => seen.push(value) };

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: (async () =>
        summary({ claimed: 3, accepted: 2, abandoned: 1 })) as NonNullable<
        Parameters<LifecycleModule['startNotificationDispatch']>[0]['dispatch']
      >,
      schedule: timer.schedule,
      cancel: timer.cancel,
      reporter,
    });

    await settle();
    await lifecycle.stop();

    assert.equal(seen.length, 1);
    assert.deepEqual(Object.keys(seen[0] ?? {}).sort(), [
      'abandoned',
      'accepted',
      'claimed',
      'retryScheduled',
      'stale',
      'stateErrors',
    ]);
  });

  it('cannot be handed the api key or an address', async () => {
    const timer = fakeTimer();
    const seen: string[] = [];

    const lifecycle = startNotificationDispatch({
      config: CONFIG,
      dispatch: (async () => summary({ claimed: 1 })) as NonNullable<
        Parameters<LifecycleModule['startNotificationDispatch']>[0]['dispatch']
      >,
      schedule: timer.schedule,
      cancel: timer.cancel,
      reporter: { onPass: (value) => seen.push(JSON.stringify(value)) },
    });

    await settle();
    await lifecycle.stop();

    const serialised = seen.join('');
    for (const withheld of [SETTINGS.apiKey, SETTINGS.fromAddress, SETTINGS.hotelRecipient]) {
      assert.equal(serialised.includes(withheld), false, `must not carry ${withheld}`);
    }
  });
});

describe('the lifecycle is wired from the server and nowhere else', () => {
  it('is not reachable from createApp', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync('src/app.ts', 'utf8');

    // Every HTTP test in the suite builds an app. A timer started there would
    // have the whole run polling a database.
    assert.equal(app.includes('notifications.lifecycle'), false, 'app.ts must not import it');
    assert.equal(app.includes('startNotificationDispatch'), false);
    assert.equal(app.includes('notifications.config'), false);
  });

  it('is started from src/server.ts only', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const path = await import('node:path');

    const callers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);

        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith('.ts')) {
          continue;
        }
        // The definition itself is not a caller.
        if (full.endsWith('notifications.lifecycle.ts')) {
          continue;
        }
        if (readFileSync(full, 'utf8').includes('startNotificationDispatch')) {
          callers.push(path.relative('src', full).split(path.sep).join('/'));
        }
      }
    };

    walk('src');

    assert.deepEqual(callers, ['server.ts'], 'exactly one production bootstrap point');
  });

  it('stops notifications before the pool closes in server.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const server = readFileSync('src/server.ts', 'utf8');

    // Newline-agnostic on purpose: this file is CRLF on disk, so a literal \n
    // boundary would pass or fail depending on how it was last checked out.
    assert.match(
      server,
      /await stopNotifications\(\);\s*await closeDatabasePool\(\);/,
      'the drain happens immediately before the pool closes',
    );
    // And the failed-listen path drains too, so a timer cannot outlive a
    // process that never finished starting.
    assert.equal(server.match(/await stopNotifications\(\)/g)?.length, 2);
  });

  it('keeps the runner free of environment reads and network calls', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.lifecycle.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

    assert.equal(code.includes('process.env'), false, 'settings arrive validated');
    assert.equal(code.includes('fetch('), false);
    assert.equal(code.includes('closeDatabasePool'), false, 'it does not own the pool');
    assert.equal(code.includes('dbPool'), false);
  });
});
