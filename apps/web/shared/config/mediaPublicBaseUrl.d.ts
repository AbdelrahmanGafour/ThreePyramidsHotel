// The TypeScript contract for mediaPublicBaseUrl.js. The implementation, and
// the reasoning behind every rule it enforces, lives there; this file only
// states the shapes TypeScript callers see.

/**
 * `MEDIA_PUBLIC_BASE_URL` is set but is not a value this app can use. The
 * message names the variable and the rule it broke, never the value.
 */
export declare class MediaConfigurationError extends Error {
  constructor(problem: string);
}

export declare function isMediaConfigurationError(error: unknown): error is MediaConfigurationError;

/**
 * Shaped to be spread directly into one entry of `images.remotePatterns` —
 * `protocol`, `hostname` and `port` exactly as Next's own `RemotePattern`
 * type wants them, so `next.config.mjs` does no further transformation.
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
 * when public media delivery has not been configured yet. Every other kind of
 * unusable value throws a `MediaConfigurationError`.
 */
export declare function resolveMediaRemotePattern(value: string | undefined): MediaRemotePattern | null;
