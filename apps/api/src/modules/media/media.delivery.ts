import { parsePublicMediaBaseUrl, type EnvironmentLike } from './media.config';
import { mediaStorageKey } from './media.validation';
import type { MediaReference } from './media.types';

/**
 * Turning a stored image's identity into the URL a browser may use to display
 * it.
 *
 * This module knows exactly two things: a canonical `MediaReference`, and the
 * public base URL a deployment serves media from. It does not know about R2,
 * the AWS SDK, PostgreSQL, Express, or a room type — nothing here imports any
 * of them, and nothing here ever will, because the same two facts are all a
 * future package-media feature would need from it too.
 *
 * `R2_PUBLIC_BASE_URL` is read by `parsePublicMediaBaseUrl`, reused wholesale
 * from the T03-E configuration module rather than re-parsed here — the
 * absolute-https, no-credentials, no-query, no-fragment rules live in exactly
 * one place, and this module is not a second one.
 */

/**
 * Something that hands back the public base URL, resolved only when asked.
 *
 * Deliberately `() => string` rather than `(reference) => string`: the base is
 * the one piece of configuration this deployment has to get right, and it is
 * also the one thing an upload's preflight check needs to confirm before any
 * byte reaches storage — before a reference even exists to build a URL from.
 * Composing a reference into a full URL is a separate, pure step
 * (`composePublicMediaUrl`) that needs no injection at all, because it cannot
 * fail for a reason a test would ever need to fake.
 *
 * Calling this can throw `MediaConfigurationError` from `media.config.ts` —
 * the same error `createR2MediaStorage` throws for the storage variables. It
 * is not caught here; the HTTP boundary decides what an administrator is
 * told, and it must not be told `MEDIA_STORAGE_UNAVAILABLE` for a delivery
 * misconfiguration that has nothing to do with whether object storage works.
 */
export type PublicMediaBaseUrlProvider = () => string;

/**
 * The production provider: resolve `R2_PUBLIC_BASE_URL` the first time it is
 * asked for, and remember it.
 *
 * Only a *successful* resolution is memoized, matching
 * `createLazyR2MediaStorageProvider`: an invalid or missing value leaves
 * nothing cached, so a deployment fixed without a restart recovers on its own
 * rather than being stuck on the first answer.
 *
 * Calling this factory reads no environment variable. Only calling the
 * function it returns does, and only the first time that succeeds — so
 * `app.ts`, every controller, every router and the service can all import
 * this module with `R2_PUBLIC_BASE_URL` entirely absent.
 */
export function createLazyPublicMediaBaseUrlProvider(
  environment: EnvironmentLike = process.env,
): PublicMediaBaseUrlProvider {
  let cachedBase: string | null = null;

  return () => {
    if (cachedBase === null) {
      cachedBase = parsePublicMediaBaseUrl(environment);
    }

    return cachedBase;
  };
}

/**
 * The one public URL for one stored image.
 *
 * `base` is expected already resolved and normalized — no trailing slash, as
 * `parsePublicMediaBaseUrl` returns it. Exactly one is added back before the
 * key is resolved against it: the WHATWG `URL` resolution rules treat
 * everything after the final `/` in a base's path as a replaceable "file"
 * when the base has no trailing slash, which would silently drop a
 * configured path segment such as `/assets`. Restoring the one slash that was
 * stripped is what makes `new URL(key, base)` join rather than replace.
 *
 * The key comes from `mediaStorageKey(reference)`, never from anything an
 * HTTP caller supplied and never rebuilt by a second implementation of that
 * rule. Because the key is always exactly `media/<uuid>.webp` — no slash, no
 * `?`, no `#`, no space — resolving it through `URL` can only ever join it
 * onto the base's path; it cannot inject a query, a fragment, or escape the
 * base's own host.
 *
 * The result is the whole of the URL: no cache-busting query string, no
 * token, no filename, no room-type slug. The object is immutable under this
 * key forever — a new upload always gets a new reference and a new key — so
 * the URL needs nothing appended to stay correct.
 */
export function composePublicMediaUrl(base: string, reference: MediaReference): string {
  return new URL(mediaStorageKey(reference), `${base}/`).href;
}
