// Turns MEDIA_PUBLIC_BASE_URL into the one thing next.config.ts needs: a
// narrow images.remotePatterns entry, or nothing at all.
//
// This is build-time configuration, not browser runtime code, and it is
// deliberately NOT guarded by `server-only`: that package enforces the
// server/client boundary *inside* the Next app, and next.config.ts sits
// outside that boundary entirely — it is plain Node, evaluated once when the
// build or dev server starts, never bundled for either side. Importing
// `server-only` here would be a boundary this file does not need and next.config.ts
// cannot honour.
//
// Deliberately independent of anything on the API side. The API's own
// `parsePublicMediaBaseUrl` (apps/api/src/modules/media/media.config.ts)
// validates the same shape of value for a different purpose — composing the
// URL a browser actually fetches — and the two packages do not share code
// across the workspace boundary. Re-implementing five lines of URL validation
// here is cheaper than coupling this app's build to the API's internals for
// it.
//
// The name is locked and provider-neutral: MEDIA_PUBLIC_BASE_URL, never
// R2_PUBLIC_BASE_URL or anything Cloudflare-specific. This app does not know,
// and must not need to know, what serves the bytes at that origin.

const VARIABLE_NAME = "MEDIA_PUBLIC_BASE_URL";

/**
 * `MEDIA_PUBLIC_BASE_URL` is set but is not a value this app can use.
 *
 * The message names the variable and the rule it broke, never the value: the
 * value is a real, potentially-unpublished hostname, and echoing it into a
 * build log or an error report is not this function's decision to make.
 */
export class MediaConfigurationError extends Error {
  constructor(problem: string) {
    super(`${VARIABLE_NAME} ${problem}`);
    this.name = "MediaConfigurationError";
  }
}

export function isMediaConfigurationError(error: unknown): error is MediaConfigurationError {
  return error instanceof MediaConfigurationError;
}

/**
 * Shaped to be spread directly into one entry of `images.remotePatterns` —
 * `protocol`, `hostname` and `port` exactly as Next's own `RemotePattern`
 * type wants them, so `next.config.ts` does no further transformation.
 */
export type MediaRemotePattern = {
  protocol: "https";
  hostname: string;
  /** A literal port, or `""` meaning none — Next's own convention. */
  port: string;
  pathname: string;
};

/**
 * Resolves the one remote pattern this app's images may load from, or `null`
 * when public media delivery has not been configured yet.
 *
 * `undefined` — the variable is simply absent — is not an error: a
 * development environment with no media host configured yet must still be
 * able to build and run, with `next/image` correctly refusing any remote
 * `src` until this is set. Every other kind of unusable value throws.
 *
 * Validation mirrors the API's own rules for the same shape of value, stated
 * fresh rather than imported: absolute, `https:` only, no embedded
 * credentials, no query, no fragment, no leading/trailing whitespace `new
 * URL()` would otherwise silently strip. The host is never checked against a
 * fixed list — no `r2.dev`, no Cloudflare hostname, no hotel domain is
 * hard-coded here — because this app has no business knowing who a future
 * deployment's media provider is.
 *
 * The derived `pathname` is `<base's own path>/media/**`, which is narrower
 * than a blanket `/**`: it allows exactly the shape
 * `mediaStorageKey()`/`composePublicMediaUrl()` ever produce on the API side
 * (`media/<uuid>.webp`) and nothing else the configured origin might also
 * serve.
 */
export function resolveMediaRemotePattern(value: string | undefined): MediaRemotePattern | null {
  if (value === undefined) {
    return null;
  }

  if (value !== value.trim()) {
    throw new MediaConfigurationError("must not have leading or trailing whitespace");
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new MediaConfigurationError("must be an absolute URL");
  }

  if (url.protocol !== "https:") {
    throw new MediaConfigurationError("must use https");
  }

  if (url.username !== "" || url.password !== "") {
    throw new MediaConfigurationError("must not embed a username or password");
  }

  // Both the parsed form and the raw text are checked: `https://host#` parses
  // to an empty hash, and a value carrying a stray `#` is still not this.
  if (url.search !== "" || value.includes("?")) {
    throw new MediaConfigurationError("must not have a query string");
  }

  if (url.hash !== "" || value.includes("#")) {
    throw new MediaConfigurationError("must not have a fragment");
  }

  // Trailing-slash normalization only: `/assets` and `/assets/` must derive
  // the identical pattern, and nothing else about the configured path is
  // rewritten.
  const configuredPath = url.pathname.replace(/\/+$/, "");

  return {
    protocol: "https",
    hostname: url.hostname,
    port: url.port,
    pathname: `${configuredPath}/media/**`,
  };
}
