import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isNotificationConfigurationError,
  loadNotificationConfig,
  retryDelaySecondsFor,
  NOTIFICATION_DEFAULTS,
  type EnvironmentLike,
} from '../src/modules/notifications/notifications.config';

// The notification configuration, which is pure: it takes an environment-shaped
// object and returns values or throws. Nothing here reads `process.env`, so
// these tests never touch the real one.
//
// The two things worth guarding are the default (off, and demanding nothing)
// and the refusals (loud, and never quoting a value).

const SECRET = 're_live_do_not_log_this';

const ENABLED: EnvironmentLike = {
  NOTIFICATIONS_ENABLED: 'true',
  RESEND_API_KEY: SECRET,
  NOTIFICATIONS_FROM_ADDRESS: 'Three Pyramids <stay@example.test>',
  NOTIFICATIONS_HOTEL_RECIPIENT: 'desk@example.test',
};

/** Loads and returns the error, or fails if none was raised. */
function refusal(env: EnvironmentLike): { variable: string; message: string } {
  try {
    loadNotificationConfig(env);
  } catch (error) {
    assert.ok(isNotificationConfigurationError(error), 'expected a configuration error');

    return { variable: error.variable, message: error.message };
  }

  throw new assert.AssertionError({ message: 'expected the configuration to be refused' });
}

describe('notifications are off unless asked for', () => {
  it('is disabled when the flag is absent', () => {
    assert.deepEqual(loadNotificationConfig({}), { enabled: false });
  });

  it('is disabled when the flag is empty or explicitly false', () => {
    for (const value of ['', 'false', '0']) {
      assert.deepEqual(
        loadNotificationConfig({ NOTIFICATIONS_ENABLED: value }),
        { enabled: false },
        `${JSON.stringify(value)} is off`,
      );
    }
  });

  it('requires no mail settings at all while disabled', () => {
    // The whole reason this config is lazy: a deployment that sends no email
    // must not need a provider key to start.
    assert.deepEqual(loadNotificationConfig({ NOTIFICATIONS_ENABLED: 'false' }), { enabled: false });
    assert.deepEqual(loadNotificationConfig({}), { enabled: false });
  });

  it('refuses a flag it cannot read rather than guessing off', () => {
    // Silently disabling notifications is the one failure nobody notices until
    // a guest complains.
    for (const value of ['yes', 'on', 'TRUE', 'true ', 'enabled']) {
      const { variable } = refusal({ NOTIFICATIONS_ENABLED: value });

      assert.equal(variable, 'NOTIFICATIONS_ENABLED', `${JSON.stringify(value)} is not a boolean`);
    }
  });

  it('accepts both spellings of on', () => {
    for (const value of ['true', '1']) {
      assert.equal(loadNotificationConfig({ ...ENABLED, NOTIFICATIONS_ENABLED: value }).enabled, true);
    }
  });
});

describe('an enabled configuration', () => {
  it('maps every setting, using the documented defaults', () => {
    const config = loadNotificationConfig(ENABLED);

    assert.ok(config.enabled);
    assert.equal(config.dispatchIntervalMs, NOTIFICATION_DEFAULTS.dispatchIntervalMs);
    assert.equal(config.settings.apiKey, SECRET);
    assert.equal(config.settings.fromAddress, 'Three Pyramids <stay@example.test>');
    assert.equal(config.settings.hotelRecipient, 'desk@example.test');
    assert.equal(config.settings.requestTimeoutMs, NOTIFICATION_DEFAULTS.requestTimeoutMs);
    assert.equal(config.settings.batchSize, NOTIFICATION_DEFAULTS.batchSize);
    assert.equal(config.settings.maxAttempts, NOTIFICATION_DEFAULTS.maxAttempts);
    assert.equal(typeof config.settings.retryDelaySecondsFor, 'function');
  });

  it('takes explicit numeric settings exactly as configured', () => {
    const config = loadNotificationConfig({
      ...ENABLED,
      NOTIFICATIONS_REQUEST_TIMEOUT_MS: '4000',
      NOTIFICATIONS_DISPATCH_INTERVAL_MS: '15000',
      NOTIFICATIONS_MAX_ATTEMPTS: '3',
      NOTIFICATIONS_BATCH_SIZE: '2',
    });

    assert.ok(config.enabled);
    assert.equal(config.settings.requestTimeoutMs, 4000);
    assert.equal(config.dispatchIntervalMs, 15000);
    assert.equal(config.settings.maxAttempts, 3);
    assert.equal(config.settings.batchSize, 2);
  });

  it('never trims a value it was given', () => {
    // A key with a stray newline is not the key; repairing it would mean
    // authenticating with something nobody configured.
    const config = loadNotificationConfig({ ...ENABLED, RESEND_API_KEY: ' re_padded ' });

    assert.ok(config.enabled);
    assert.equal(config.settings.apiKey, ' re_padded ');
  });
});

describe('an enabled configuration that is wrong', () => {
  it('names each missing required setting', () => {
    for (const variable of [
      'RESEND_API_KEY',
      'NOTIFICATIONS_FROM_ADDRESS',
      'NOTIFICATIONS_HOTEL_RECIPIENT',
    ]) {
      const missing = refusal({ ...ENABLED, [variable]: undefined });
      assert.equal(missing.variable, variable, `${variable} missing`);

      const blank = refusal({ ...ENABLED, [variable]: '' });
      assert.equal(blank.variable, variable, `${variable} blank`);
    }
  });

  it('never puts a configured value in the message', () => {
    // The key is a credential; the addresses are the hotel's mail setup.
    const { message } = refusal({ ...ENABLED, NOTIFICATIONS_FROM_ADDRESS: '' });

    assert.equal(message.includes(SECRET), false, 'the key must never appear');
    assert.equal(message.includes('desk@example.test'), false, 'nor the hotel recipient');
    assert.match(message, /NOTIFICATIONS_FROM_ADDRESS/, 'but the variable is named');
  });

  it('says nothing about the length of a secret', () => {
    const { message } = refusal({ ...ENABLED, RESEND_API_KEY: '' });

    assert.equal(message.includes(String(SECRET.length)), false);
    assert.match(message, /is required when notifications are enabled/);
  });

  it('refuses every non-positive or malformed number', () => {
    const numeric = [
      'NOTIFICATIONS_REQUEST_TIMEOUT_MS',
      'NOTIFICATIONS_DISPATCH_INTERVAL_MS',
      'NOTIFICATIONS_MAX_ATTEMPTS',
      'NOTIFICATIONS_BATCH_SIZE',
    ];

    for (const variable of numeric) {
      for (const value of ['0', '-1', '2.5', 'abc', '10abc', 'Infinity', 'NaN', ' ']) {
        const { variable: named } = refusal({ ...ENABLED, [variable]: value });

        assert.equal(named, variable, `${variable}=${JSON.stringify(value)} must be refused`);
      }
    }
  });

  it('refuses a batch window too large to schedule safely', () => {
    // Overflow past exact representation must never read as a workable lease.
    const { variable } = refusal({
      ...ENABLED,
      NOTIFICATIONS_BATCH_SIZE: String(Number.MAX_SAFE_INTEGER),
      NOTIFICATIONS_REQUEST_TIMEOUT_MS: '1000',
    });

    assert.equal(variable, 'NOTIFICATIONS_BATCH_SIZE');
  });
});

describe('the derived claim lease', () => {
  const leaseFor = (batchSize: number, requestTimeoutMs: number): number => {
    const config = loadNotificationConfig({
      ...ENABLED,
      NOTIFICATIONS_BATCH_SIZE: String(batchSize),
      NOTIFICATIONS_REQUEST_TIMEOUT_MS: String(requestTimeoutMs),
    });

    assert.ok(config.enabled);

    return config.settings.claimLeaseSeconds;
  };

  it('always satisfies the dispatcher invariant', () => {
    // The whole reason the lease is derived rather than configured: a separate
    // variable could silently contradict the two it depends on.
    const cases: ReadonlyArray<[number, number]> = [
      [1, 1000],
      [1, 10_000],
      [5, 10_000],
      [10, 5000],
      [3, 5000],
      [50, 30_000],
      [1, 1],
    ];

    for (const [batchSize, requestTimeoutMs] of cases) {
      const lease = leaseFor(batchSize, requestTimeoutMs);

      assert.ok(
        lease * 1000 >= batchSize * requestTimeoutMs,
        `lease ${lease}s must cover ${batchSize} x ${requestTimeoutMs}ms`,
      );
      assert.ok(Number.isSafeInteger(lease), 'and be a whole number of seconds');
    }
  });

  it('covers the whole batch, not a single request', () => {
    // 10 rows x 5s = 50s, plus the fixed buffer.
    assert.ok(leaseFor(10, 5000) >= 50, 'the tail of the batch is still protected');
    assert.ok(leaseFor(10, 5000) > leaseFor(1, 5000), 'a bigger batch means a longer lease');
  });

  it('grows with the timeout as well as the batch', () => {
    assert.ok(leaseFor(5, 20_000) > leaseFor(5, 10_000));
  });

  it('rounds up rather than down on a fractional second', () => {
    // 3 x 1500ms = 4.5s. Rounding down would leave the batch unprotected.
    assert.ok(leaseFor(3, 1500) * 1000 >= 4500);
  });
});

describe('the retry backoff', () => {
  it('doubles from sixty seconds and caps at an hour', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map(retryDelaySecondsFor),
      [60, 120, 240, 480, 960, 1920, 3600, 3600],
    );
  });

  it('never exceeds the cap however many attempts have happened', () => {
    for (const attempts of [9, 20, 64, 1000, Number.MAX_SAFE_INTEGER]) {
      assert.equal(retryDelaySecondsFor(attempts), 3600, `attempt ${attempts}`);
    }
  });

  it('is deterministic', () => {
    // No jitter in V1: the same attempt always gets the same delay, so two
    // readings of a queue agree about when a row is next due.
    for (const attempts of [1, 4, 9]) {
      assert.equal(retryDelaySecondsFor(attempts), retryDelaySecondsFor(attempts));
    }
  });

  it('returns a usable delay for nonsense input rather than NaN', () => {
    // A NaN reaching `make_interval` would abort the completion write on a row
    // that had just been sent.
    for (const attempts of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1.7]) {
      const delay = retryDelaySecondsFor(attempts);

      assert.ok(Number.isFinite(delay) && delay > 0, `attempt ${attempts} gave ${delay}`);
      assert.ok(delay <= 3600);
    }
  });
});

describe('the config module reads nothing on its own', () => {
  it('never touches process.env', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.config.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

    // The environment arrives as an argument, so a test never has to mutate the
    // real one and an import never demands a variable.
    assert.equal(code.includes('process.env'), false, 'the environment is a parameter');
    assert.equal(code.includes('dbPool'), false);
    assert.equal(code.includes('fetch('), false);
    assert.equal(code.includes('console.'), false);
  });
});
