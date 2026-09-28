import type { DispatcherSettings } from './notifications.dispatcher';

/**
 * Whether this deployment sends notification emails, and with what.
 *
 * Deliberately not part of `config/env.ts`. That object is evaluated at import
 * and throws for anything missing, so putting a provider key in it would make
 * every module that transitively reaches it — which is every service, and the
 * app itself — demand mail credentials to load. Unit tests would each need a
 * fabricated API key, and a deployment that does not send email would fail to
 * start. The same reasoning that keeps R2 out of it keeps Resend out of it.
 *
 * So these are read inside a function, exactly as `media.config.ts` does.
 * Importing this file requires nothing.
 *
 * Pure: it takes an environment-shaped object and returns values or throws. No
 * network, no database, no clock, no randomness. Nothing here logs, and no
 * message it produces ever contains a configured value.
 */

/** An environment, as this module needs to see it. `process.env` satisfies it. */
export type EnvironmentLike = Record<string, string | undefined>;

/**
 * A notification setting is missing or unusable.
 *
 * The message names the variable and states the rule it broke, never the value.
 * `RESEND_API_KEY` is a credential; the two addresses identify the hotel's mail
 * setup. Naming the rule is enough for whoever is fixing a deployment and is
 * safe in a log, a stack trace or an error report.
 *
 * `variable` is exposed separately so a caller can act on which one failed
 * without parsing English.
 */
export class NotificationConfigurationError extends Error {
  readonly variable: string;

  constructor(variable: string, problem: string) {
    super(`${variable} ${problem}`);
    this.name = 'NotificationConfigurationError';
    this.variable = variable;
  }
}

export function isNotificationConfigurationError(
  error: unknown,
): error is NotificationConfigurationError {
  return error instanceof NotificationConfigurationError;
}

export const NOTIFICATIONS_ENABLED = 'NOTIFICATIONS_ENABLED';
export const NOTIFICATIONS_FROM_ADDRESS = 'NOTIFICATIONS_FROM_ADDRESS';
export const NOTIFICATIONS_HOTEL_RECIPIENT = 'NOTIFICATIONS_HOTEL_RECIPIENT';
export const NOTIFICATIONS_REQUEST_TIMEOUT_MS = 'NOTIFICATIONS_REQUEST_TIMEOUT_MS';
export const NOTIFICATIONS_DISPATCH_INTERVAL_MS = 'NOTIFICATIONS_DISPATCH_INTERVAL_MS';
export const NOTIFICATIONS_MAX_ATTEMPTS = 'NOTIFICATIONS_MAX_ATTEMPTS';
export const NOTIFICATIONS_BATCH_SIZE = 'NOTIFICATIONS_BATCH_SIZE';
export const RESEND_API_KEY = 'RESEND_API_KEY';

/**
 * Defaults for the numeric settings. Every one is documented here and nowhere
 * else, so there is one place to look.
 *
 *   request timeout    10s — generous for one HTTPS call, short enough that a
 *                      hung provider does not hold a batch open for minutes.
 *   dispatch interval  30s — a notification that arrives half a minute after a
 *                      booking is timely; polling faster buys nothing.
 *   max attempts       8   — with the backoff below, roughly three hours of
 *                      trying before a row is abandoned.
 *   batch size         5   — small on purpose. The batch is sent sequentially
 *                      and its size drives the claim lease, so a large batch
 *                      means a long lease and a long wait before a stuck row
 *                      can be retried.
 */
const DEFAULTS = {
  requestTimeoutMs: 10_000,
  dispatchIntervalMs: 30_000,
  maxAttempts: 8,
  batchSize: 5,
} as const;

/** Backoff floor and ceiling. No randomness: V1 is deterministic. */
const RETRY_BASE_SECONDS = 60;
const RETRY_CAP_SECONDS = 3600;

/**
 * Added to the derived claim lease.
 *
 * The lease must cover the whole batch's worst-case send window. This buffer
 * covers what that arithmetic does not: the rendering between sends, the
 * completion write after each, and the round trip to claim in the first place.
 * Fixed and deterministic — nothing here jitters.
 */
const LEASE_BUFFER_SECONDS = 5;

/**
 * Deterministic exponential backoff: 60s, 120s, 240s … capped at 3600s.
 *
 * Exported so the lifecycle hands the same function to every pass and a test
 * can check the schedule directly. Total for `attempts` 1: the delay before
 * attempt 2 — the argument is the attempt that just happened.
 *
 * Safe for any input. An attempt below 1, or a value that is not a finite
 * number, yields the base delay rather than `NaN`, because a `NaN` reaching
 * `make_interval` would abort a completion write on a row that had just been
 * sent.
 */
export function retryDelaySecondsFor(attempts: number): number {
  if (!Number.isFinite(attempts)) {
    return RETRY_BASE_SECONDS;
  }

  const steps = Math.max(0, Math.floor(attempts) - 1);

  // Guarded before the shift so a large attempt count cannot overflow into
  // Infinity on its way to being capped.
  if (steps >= 32) {
    return RETRY_CAP_SECONDS;
  }

  return Math.min(RETRY_CAP_SECONDS, RETRY_BASE_SECONDS * 2 ** steps);
}

/** Notifications are off, and nothing about mail is required. */
export type NotificationsDisabled = { readonly enabled: false };

/** Notifications are on, fully validated, and ready to hand to a dispatcher. */
export type NotificationsEnabled = {
  readonly enabled: true;
  readonly settings: DispatcherSettings;
  readonly dispatchIntervalMs: number;
};

export type NotificationConfig = NotificationsDisabled | NotificationsEnabled;

/**
 * A present, non-empty value, taken exactly as given.
 *
 * Nothing is trimmed. An API key with a stray newline from a copy-paste is not
 * the key, and repairing it would mean authenticating with something the
 * operator never configured. Length is never mentioned, because the length of a
 * secret is information about the secret.
 */
function requireValue(env: EnvironmentLike, variable: string): string {
  const value = env[variable];

  if (value === undefined || value === '') {
    throw new NotificationConfigurationError(variable, 'is required when notifications are enabled');
  }

  return value;
}

/** A positive whole number, or the documented default when unset. */
function readPositiveInteger(env: EnvironmentLike, variable: string, fallback: number): number {
  const raw = env[variable];

  if (raw === undefined || raw === '') {
    return fallback;
  }

  // Deliberately strict. `Number('10abc')` is NaN but `parseInt` would say 10,
  // and a setting that was half-read is a setting nobody configured.
  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new NotificationConfigurationError(variable, 'must be a positive whole number');
  }

  return parsed;
}

/**
 * Off unless explicitly switched on.
 *
 * Only the four spellings below are accepted. A typo — `yes`, `on`, `True `
 * with a space — raises rather than being read as false, because silently
 * disabling notifications is the one failure nobody would notice until a guest
 * complained.
 */
function readEnabled(env: EnvironmentLike): boolean {
  const raw = env[NOTIFICATIONS_ENABLED];

  if (raw === undefined || raw === '') {
    return false;
  }

  if (raw === 'true' || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === '0') {
    return false;
  }

  throw new NotificationConfigurationError(
    NOTIFICATIONS_ENABLED,
    "must be 'true', 'false', '1' or '0'",
  );
}

/**
 * The claim lease, derived rather than configured.
 *
 * There is no lease environment variable on purpose. The dispatcher's
 * invariant ties the lease to `batchSize * requestTimeoutMs`, and a separately
 * configured lease would be a second number that could silently contradict the
 * first two. Deriving it means the only way to get a longer lease is to ask for
 * a bigger batch or a longer timeout — which is exactly what a longer lease
 * would be protecting.
 *
 * Overflow is checked rather than assumed: both inputs are safe integers, so a
 * product that is not one has run past exact representation and cannot be
 * compared meaningfully. Refused, never clamped.
 */
function deriveClaimLeaseSeconds(batchSize: number, requestTimeoutMs: number): number {
  const windowMs = batchSize * requestTimeoutMs;

  if (!Number.isSafeInteger(windowMs)) {
    throw new NotificationConfigurationError(
      NOTIFICATIONS_BATCH_SIZE,
      `multiplied by ${NOTIFICATIONS_REQUEST_TIMEOUT_MS} is too large to schedule safely`,
    );
  }

  const leaseSeconds = Math.ceil(windowMs / 1000) + LEASE_BUFFER_SECONDS;

  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds * 1000 < windowMs) {
    throw new NotificationConfigurationError(
      NOTIFICATIONS_BATCH_SIZE,
      `multiplied by ${NOTIFICATIONS_REQUEST_TIMEOUT_MS} is too large to schedule safely`,
    );
  }

  return leaseSeconds;
}

/**
 * Reads the notification configuration.
 *
 * Disabled is the default and costs nothing: no key, no addresses, no numbers
 * are read or required, and the caller starts no dispatcher — so no outbox row
 * is ever claimed on a deployment that has not opted in.
 *
 * Enabled validates everything up front and throws
 * `NotificationConfigurationError` on the first problem. Failing at startup is
 * the point: a deployment that thinks it is sending email and is not is worse
 * than one that refuses to boot.
 */
export function loadNotificationConfig(env: EnvironmentLike): NotificationConfig {
  if (!readEnabled(env)) {
    return { enabled: false };
  }

  const apiKey = requireValue(env, RESEND_API_KEY);
  const fromAddress = requireValue(env, NOTIFICATIONS_FROM_ADDRESS);
  const hotelRecipient = requireValue(env, NOTIFICATIONS_HOTEL_RECIPIENT);

  const requestTimeoutMs = readPositiveInteger(
    env,
    NOTIFICATIONS_REQUEST_TIMEOUT_MS,
    DEFAULTS.requestTimeoutMs,
  );
  const dispatchIntervalMs = readPositiveInteger(
    env,
    NOTIFICATIONS_DISPATCH_INTERVAL_MS,
    DEFAULTS.dispatchIntervalMs,
  );
  const maxAttempts = readPositiveInteger(env, NOTIFICATIONS_MAX_ATTEMPTS, DEFAULTS.maxAttempts);
  const batchSize = readPositiveInteger(env, NOTIFICATIONS_BATCH_SIZE, DEFAULTS.batchSize);

  return {
    enabled: true,
    dispatchIntervalMs,
    settings: {
      apiKey,
      fromAddress,
      hotelRecipient,
      requestTimeoutMs,
      batchSize,
      maxAttempts,
      claimLeaseSeconds: deriveClaimLeaseSeconds(batchSize, requestTimeoutMs),
      retryDelaySecondsFor,
    },
  };
}

/** The documented defaults, exported for tests and for anybody reading them. */
export const NOTIFICATION_DEFAULTS = DEFAULTS;
