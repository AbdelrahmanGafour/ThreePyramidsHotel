import "server-only";

import { AdminAuthConfigurationError } from "./adminAuthApi";

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
  const misconfigured = error instanceof AdminAuthConfigurationError;

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
