/**
 * Where the hotel's media lives, resolved only when something asks.
 *
 * Deliberately not part of `config/env.ts`. That object is evaluated at import
 * and throws for anything missing, so every module that transitively reaches
 * it — which is every service, and the app itself — would start demanding R2
 * credentials the moment they were added to it. Unit tests would need five
 * fabricated secrets each, `next build` would need them in CI, and a
 * deployment that never uploads an image would fail to start. None of that is
 * a price worth paying for configuration only the upload path reads.
 *
 * So these are read inside functions, the way `ADMIN_SESSION_TTL_HOURS`
 * already is, and the way the web app's `resolveApiBaseUrl()` is. Importing
 * this file requires nothing.
 *
 * Pure: it takes an environment-shaped object and returns values or throws. No
 * network, no SDK, no filesystem, no clock. Nothing here logs, and no message
 * it produces ever contains a configured value.
 */

/** An environment, as this module needs to see it. `process.env` satisfies it. */
export type EnvironmentLike = Record<string, string | undefined>;

/**
 * A media configuration variable is missing or unusable.
 *
 * The message names the variable and states the rule it broke. It never
 * contains the value: an endpoint identifies the account, a bucket name is
 * infrastructure detail, and a key or secret is a credential. Naming the rule
 * is enough for whoever is fixing a deployment, and is safe in a log, a stack
 * trace or an error report.
 *
 * `variable` is exposed separately so a caller can act on which one failed
 * without parsing English.
 */
export class MediaConfigurationError extends Error {
  readonly variable: string;

  constructor(variable: string, problem: string) {
    super(`${variable} ${problem}`);
    this.name = 'MediaConfigurationError';
    this.variable = variable;
  }
}

export function isMediaConfigurationError(error: unknown): error is MediaConfigurationError {
  return error instanceof MediaConfigurationError;
}

/** What the private storage adapter needs, and the whole of what it needs. */
export type R2StorageConfig = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export const R2_ENDPOINT = 'R2_ENDPOINT';
export const R2_ACCESS_KEY_ID = 'R2_ACCESS_KEY_ID';
export const R2_SECRET_ACCESS_KEY = 'R2_SECRET_ACCESS_KEY';
export const R2_BUCKET = 'R2_BUCKET';
export const R2_PUBLIC_BASE_URL = 'R2_PUBLIC_BASE_URL';

/**
 * A present, non-empty value, taken exactly as given.
 *
 * Nothing is trimmed. A secret with a stray newline from a copy-paste is not
 * the secret — repairing it would mean signing requests with something the
 * operator never configured, and succeeding by accident is worse than failing
 * clearly. Length is never mentioned, because the length of a secret is
 * information about the secret.
 */
function requireValue(environment: EnvironmentLike, variable: string): string {
  const value = environment[variable];

  if (typeof value !== 'string' || value.length === 0) {
    throw new MediaConfigurationError(variable, 'must be set');
  }

  return value;
}

/**
 * An absolute https URL with nothing attached to it.
 *
 * Refused, each for its own reason:
 *
 *   - not a URL at all, or a relative one — there is nothing to resolve it
 *     against
 *   - any scheme but https — credentials are signed into these requests, and
 *     http would put them on the wire in the clear
 *   - an embedded `user:password@` — a second, invisible place for a
 *     credential to live, and not one this system reads
 *   - a query string or a fragment — neither has any meaning for an object
 *     storage endpoint or a media host, so one appearing means the value was
 *     copied from somewhere it should not have been
 *   - leading or trailing whitespace — `new URL()` would silently strip it,
 *     which is exactly the kind of quiet repair this project does not do
 *
 * The host is deliberately not checked against anything. Pinning a Cloudflare
 * hostname here would make it impossible to run this against MinIO or any
 * other S3-compatible endpoint in a future test, and it would not prevent a
 * single real mistake.
 */
function requireHttpsUrl(environment: EnvironmentLike, variable: string): URL {
  const raw = requireValue(environment, variable);

  if (raw !== raw.trim()) {
    throw new MediaConfigurationError(variable, 'must not have leading or trailing whitespace');
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new MediaConfigurationError(variable, 'must be an absolute URL');
  }

  if (url.protocol !== 'https:') {
    throw new MediaConfigurationError(variable, 'must use https');
  }

  if (url.username !== '' || url.password !== '') {
    throw new MediaConfigurationError(variable, 'must not embed a username or password');
  }

  // Both the parsed form and the raw text are checked: `https://host#` parses
  // to an empty hash, and a value carrying a stray `#` is still not this.
  if (url.search !== '' || raw.includes('?')) {
    throw new MediaConfigurationError(variable, 'must not have a query string');
  }

  if (url.hash !== '' || raw.includes('#')) {
    throw new MediaConfigurationError(variable, 'must not have a fragment');
  }

  return url;
}

/**
 * The private storage configuration: four variables, and only four.
 *
 * `R2_PUBLIC_BASE_URL` is not among them on purpose. Writing an object and
 * serving one to a guest are different concerns with different lifetimes — the
 * public host will change when a custom domain replaces the development one —
 * and an upload has no reason to fail because public delivery has not been
 * set up yet. It has its own resolver below, and the adapter never calls it.
 */
export function parseR2StorageConfig(environment: EnvironmentLike): R2StorageConfig {
  // The endpoint is validated as a URL and then passed on exactly as
  // configured. No trailing slash is added or removed: the SDK builds its own
  // request paths, and rewriting an operator's value is not this function's
  // job.
  requireHttpsUrl(environment, R2_ENDPOINT);

  return {
    endpoint: environment[R2_ENDPOINT] as string,
    accessKeyId: requireValue(environment, R2_ACCESS_KEY_ID),
    secretAccessKey: requireValue(environment, R2_SECRET_ACCESS_KEY),
    bucket: requireValue(environment, R2_BUCKET),
  };
}

/**
 * Where stored media is served from, without a trailing slash so that keys
 * join cleanly onto it.
 *
 * That normalization is the only one performed, and it is the one the join
 * needs — `${base}/${key}` has to produce one slash whether or not the
 * operator typed a trailing one. Nothing else about the value is changed.
 *
 * Nothing is fetched. The URL is not assumed to be an `r2.dev` address, and no
 * production custom domain is written into this repository; a deployment says
 * where its media is served from, the same way it says where its API lives.
 *
 * Separate from the storage configuration and never called by the adapter, so
 * uploads, unit tests, API startup and a real-bucket smoke run all work with
 * this variable absent. It is required only when public delivery is.
 */
export function parsePublicMediaBaseUrl(environment: EnvironmentLike): string {
  const url = requireHttpsUrl(environment, R2_PUBLIC_BASE_URL);

  return url.href.replace(/\/+$/, '');
}
