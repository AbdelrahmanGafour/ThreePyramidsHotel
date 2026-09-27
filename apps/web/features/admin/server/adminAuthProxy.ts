import "server-only";

import { ApiConfigurationError } from "@/shared/server/apiBaseUrl";

// Shared relay behaviour for the two browser-facing admin auth routes.
//
// These routes are transport only: they carry a request to the API and the
// API's answer back. Nothing here interprets credentials, session state or the
// meaning of a status code, and nothing redirects.

const NO_STORE = "no-store";

/** Statuses that must not carry a body, so a 204 stays a true 204. */
const BODILESS_STATUSES = new Set([204, 205, 304]);

/**
 * Returns the API's response to the browser with its status, body and
 * Set-Cookie intact.
 *
 * Set-Cookie is copied header by header, never parsed or rebuilt, so the
 * session cookie keeps the attributes the API set - HttpOnly included - and the
 * token itself stays out of reach of client JavaScript.
 *
 * This is how the login and logout routes own the cookie: whatever Express
 * sets or clears, the browser receives unchanged, and this module never needs
 * to know what the cookie is called. `adminSessionCookie` states the name for
 * the one case that cannot work this way - a Server Action, which has no
 * upstream response to relay - and the two are pinned together by test.
 */
export function relayAdminAuthResponse(upstream: Response): Response {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");

  if (contentType) {
    headers.set("content-type", contentType);
  }

  // getSetCookie keeps multiple cookies separate; joining them would corrupt them.
  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }

  headers.set("cache-control", NO_STORE);

  if (BODILESS_STATUSES.has(upstream.status)) {
    return new Response(null, { status: upstream.status, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

/**
 * The API could not be asked at all. Deliberately not 401: nothing was learned
 * about the caller's credentials or session. The reason stays generic so no
 * address, network detail or stack trace reaches the browser.
 */
export function adminAuthGatewayResponse(error: unknown): Response {
  const misconfigured = error instanceof ApiConfigurationError;

  return Response.json(
    {
      error: {
        code: misconfigured ? "ADMIN_AUTH_MISCONFIGURED" : "ADMIN_AUTH_UNAVAILABLE",
        message: "The hotel system is unavailable. Please try again.",
      },
    },
    {
      // A configuration fault is this server's problem; an unreachable API is a
      // bad gateway.
      status: misconfigured ? 500 : 502,
      headers: { "cache-control": NO_STORE },
    },
  );
}

/** A proxy chain may send a list; the first entry is the client-facing value. */
function firstToken(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();

  return first && first.length > 0 ? first : null;
}

/**
 * An origin reduced to its canonical form: scheme, host, and port only when it
 * is not that scheme's default.
 *
 * `URL.origin` does the normalising, so `https://a.com:443` and `https://a.com`
 * compare equal while `https://a.com:8443` does not, and case differences in
 * the host stop mattering. Anything that is not an absolute http(s) URL —
 * including the literal `null` an opaque origin sends — returns null.
 */
function canonicalOrigin(value: string): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  return url.origin;
}

/**
 * The public origin this request was actually addressed to — scheme, host and
 * port, not just the host.
 *
 * Two deployment shapes, handled separately rather than blended:
 *
 *   Behind a proxy, `host` carries the internal address and the connection
 *   arrives as plain HTTP even when the browser used HTTPS, so the public
 *   origin can only come from `x-forwarded-host` + `x-forwarded-proto`. Both
 *   are required together: taking the forwarded host while inferring the
 *   scheme from the internal connection would reconstruct an origin that was
 *   never real, so a half-configured proxy fails closed instead.
 *
 *   Directly exposed, there are no forwarded headers, and `host` plus the
 *   scheme of the request itself is the public origin.
 *
 * On trusting the forwarded headers: they are only consulted when present, and
 * a browser cannot put them on a cross-site request — `Host` is a forbidden
 * header name, and adding `x-forwarded-*` to a cross-origin fetch makes it
 * non-simple, so it is preflighted and this app approves no CORS preflight.
 * A cross-site form post cannot set headers at all. They are therefore not a
 * path a browser-driven login CSRF can take, which is the threat this check
 * exists for. A deployment that terminates TLS at a proxy must still be the
 * one setting them; if anything upstream lets a client pass them through, that
 * is a proxy misconfiguration with consequences well beyond this route.
 */
function effectiveRequestOrigin(request: Request): string | null {
  const forwardedHost = firstToken(request.headers.get("x-forwarded-host"));

  if (forwardedHost) {
    const forwardedProto = firstToken(request.headers.get("x-forwarded-proto"));

    if (!forwardedProto) {
      return null;
    }

    return canonicalOrigin(`${forwardedProto}://${forwardedHost}`);
  }

  const host = request.headers.get("host");

  if (!host) {
    return null;
  }

  let protocol: string;

  try {
    protocol = new URL(request.url).protocol;
  } catch {
    return null;
  }

  return canonicalOrigin(`${protocol}//${host}`);
}

/**
 * Whether this request came from the administration site itself.
 *
 * Exists because `SameSite=Lax` governs when a cookie is *sent*, not whether a
 * `Set-Cookie` is *stored*: without this check another site could POST its own
 * credentials here and leave the browser holding a session belonging to
 * someone else's account.
 *
 * Whole origins are compared — scheme, host and port — after both sides are
 * canonicalised, never by substring, prefix or suffix. So `evil-hotel.com` and
 * `hotel.com.evil.com` both fail against `hotel.com`, an `http://` origin
 * fails against an `https://` request, and a different port fails even on the
 * same host. A default port is not a difference: `https://host:443` and
 * `https://host` are the same origin.
 *
 * A missing, opaque (`null`) or unparseable `Origin` is refused, as is a
 * request whose own public origin cannot be established. Browsers attach
 * `Origin` to every POST, same-origin ones included, so nothing a browser
 * sends to this route can lack it — only a non-browser client can, and this
 * route exists for browsers.
 */
export function isSameOriginRequest(request: Request): boolean {
  const header = request.headers.get("origin");

  if (!header) {
    return false;
  }

  const origin = canonicalOrigin(header);
  const expected = effectiveRequestOrigin(request);

  return origin !== null && expected !== null && origin === expected;
}

/**
 * The one body this route sends for a cross-site login attempt.
 *
 * The rejected `Origin` is deliberately not echoed, and the message says
 * nothing about credentials: nothing was read from the body, and nothing was
 * asked of the API.
 */
export function crossOriginLoginResponse(): Response {
  return Response.json(
    {
      error: {
        code: "CROSS_ORIGIN_REQUEST",
        message: "Login must be submitted from the administration site.",
      },
    },
    { status: 403, headers: { "cache-control": NO_STORE } },
  );
}
