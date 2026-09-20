// THE ONE NEXT -> EXPRESS TRANSPORT IMPLEMENTATION (WFI-T02).
//
// Generic transport only. This file has no knowledge of rooms, availability,
// or reservation response/request shapes, and no knowledge of any business
// rule (capacity, pricing, allocation, status, currency, booking references).
// It forwards a fixed target path supplied by a trusted Route Handler to the
// existing Express API, and reports back either:
//
//   - a transport success: an upstream HTTP status plus a syntactically valid
//     JSON body, forwarded exactly as received (whether that JSON body is a
//     success payload or one of Express's own domain error bodies is not
//     this file's concern), or
//   - a transport failure: a ProxyError, used only when Express could not be
//     reached, its response was not usable, or this bridge's own
//     configuration was invalid. A ProxyError never impersonates a backend
//     domain error code, and its message never includes the configured
//     API_BASE_URL, a stack trace, or any other internal error object.

import { getApiBaseUrl } from "./config";
import { ProxyError } from "./errors";

export type ProxySuccess = {
  ok: true;
  /** The exact HTTP status Express returned, whatever it was. */
  status: number;
  /** The exact parsed JSON body Express returned, unexamined and unmodified. */
  body: unknown;
};

export type ProxyFailure = {
  ok: false;
  error: ProxyError;
};

export type ProxyResult = ProxySuccess | ProxyFailure;

type ForwardToExpressInput = {
  method: "GET" | "POST";
  /** Fixed target path on the Express API, e.g. "/api/v1/rooms". Never built from untrusted input. */
  path: string;
  /** Forwarded verbatim as the outbound query string, if provided. Never inspected or altered. */
  searchParams?: URLSearchParams;
  /** Forwarded verbatim as the outbound request body, if provided. Never parsed or reconstructed. */
  body?: string;
  /**
   * The original request's Content-Type, forwarded only when the caller
   * actually supplied one. Never defaulted or invented by this bridge — a
   * body sent without a Content-Type is forwarded without one too, exactly
   * as received.
   */
  contentType?: string | null;
};

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * A non-2xx upstream status is meaningful and is preserved as-is. A 2xx
 * upstream status cannot be forwarded alongside a proxy error body — the
 * browser must never see a 200 paired with an error — so it is replaced with
 * a proxy-owned failure status instead.
 */
function invalidResponseStatus(upstreamStatus: number): number {
  return isSuccessStatus(upstreamStatus) ? 502 : upstreamStatus;
}

export async function forwardToExpress(input: ForwardToExpressInput): Promise<ProxyResult> {
  let baseUrl: string;

  try {
    baseUrl = getApiBaseUrl();
  } catch {
    // The underlying config error's message is deliberately not forwarded:
    // this response reaches the browser, and only a fixed, generic message
    // is safe to expose regardless of what config.ts happens to throw.
    return {
      ok: false,
      error: new ProxyError(
        "PROXY_CONFIGURATION_ERROR",
        500,
        "The API bridge is not configured correctly.",
      ),
    };
  }

  const url = new URL(`${baseUrl}${input.path}`);
  if (input.searchParams) {
    url.search = input.searchParams.toString();
  }

  // Only ever forwards a Content-Type the caller actually sent — never
  // manufactures one. A body with no Content-Type reaches Express with no
  // Content-Type, exactly as the caller sent it.
  const headers: Record<string, string> = {};
  if (input.body !== undefined && input.contentType !== undefined && input.contentType !== null) {
    headers["content-type"] = input.contentType;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: input.method,
      headers,
      body: input.body,
      // Availability and reservation data are live; nothing forwarded
      // through this bridge may be served from a cached snapshot.
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      error: new ProxyError("UPSTREAM_UNREACHABLE", 502, "The API could not be reached."),
    };
  }

  let rawText: string;

  try {
    rawText = await response.text();
  } catch {
    return {
      ok: false,
      error: new ProxyError(
        "UPSTREAM_INVALID_RESPONSE",
        invalidResponseStatus(response.status),
        "The API returned a response this bridge could not interpret.",
      ),
    };
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawText);
  } catch {
    // A real HTTP response exists, but its body is not usable JSON (for
    // example, an unhandled failure answered by Express's own default HTML
    // error page). Never invent a domain error body for it either way.
    return {
      ok: false,
      error: new ProxyError(
        "UPSTREAM_INVALID_RESPONSE",
        invalidResponseStatus(response.status),
        "The API returned a response this bridge could not interpret.",
      ),
    };
  }

  return { ok: true, status: response.status, body: parsedBody };
}
