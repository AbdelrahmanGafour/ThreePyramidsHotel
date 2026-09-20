import "server-only";

import { ApiConfigurationError, resolveApiBaseUrl } from "@/shared/server/apiBaseUrl";

// Server-only client for the hotel API's admin authentication endpoints.
//
// The import above is the boundary: importing this module from client code
// fails the build, so the API address can never reach the browser bundle.
//
// Express plus PostgreSQL remain the single source of truth: this module holds
// no session state, mints nothing, and decides nothing about authentication. It
// forwards the caller's Cookie header and reports what the API said.
//
// It talks to Express directly and never to this app's own route handlers.

const ADMIN_AUTH_BASE_PATH = "/api/v1/admin/auth";

/** The only endpoints this client may reach; never a caller-supplied URL. */
export type AdminAuthPath = "/login" | "/logout" | "/session";

export type AdminSessionAdministrator = {
  email: string;
  displayName: string;
};

/**
 * Three outcomes, kept apart on purpose: an API that cannot be reached is a
 * server problem, not a signed-out administrator.
 */
export type AdminSessionResult =
  | { state: "authenticated"; administrator: AdminSessionAdministrator }
  | { state: "unauthenticated" }
  | { state: "unavailable"; reason: string };

type AdminAuthRequest = {
  method: "GET" | "POST";
  /** The incoming request's raw Cookie header, forwarded verbatim. */
  cookie?: string | undefined;
  /** JSON body, encoded by this helper. Ignored when `rawBody` is given. */
  body?: unknown;
  /**
   * A browser request's body, forwarded byte for byte. Proxied logins use this
   * so malformed JSON still reaches the API and gets the API's own answer,
   * rather than being re-encoded (or rejected) on the way through.
   */
  rawBody?: string | undefined;
  /** Content-Type to send with `rawBody`, normally the browser's own. */
  contentType?: string | undefined;
};

/**
 * Performs one admin-auth request against Express.
 *
 * Returns the upstream `Response` untouched and unread, so a route handler can
 * later relay its status, body and Set-Cookie without this module having to
 * restate the API's rules. The session cookie is forwarded as an opaque header
 * and never parsed.
 */
export async function requestAdminAuth(path: AdminAuthPath, request: AdminAuthRequest): Promise<Response> {
  const headers: Record<string, string> = {};
  const forwardsRawBody = request.rawBody !== undefined;

  if (request.cookie) {
    headers.Cookie = request.cookie;
  }
  if (forwardsRawBody) {
    if (request.contentType) {
      headers["Content-Type"] = request.contentType;
    }
  } else if (request.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const body = forwardsRawBody
    ? request.rawBody
    : request.body === undefined
      ? undefined
      : JSON.stringify(request.body);

  return fetch(`${resolveApiBaseUrl()}${ADMIN_AUTH_BASE_PATH}${path}`, {
    method: request.method,
    headers,
    body,
    // Authentication state is never cacheable.
    cache: "no-store",
  });
}

function toAdministrator(payload: unknown): AdminSessionAdministrator | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const administrator = (payload as { data?: { administrator?: unknown } }).data?.administrator;

  if (typeof administrator !== "object" || administrator === null) {
    return null;
  }

  const { email, displayName } = administrator as { email?: unknown; displayName?: unknown };

  if (typeof email !== "string" || typeof displayName !== "string") {
    return null;
  }

  // Only the two safe fields are carried forward, whatever else the payload holds.
  return { email, displayName };
}

/**
 * Asks the API who the forwarded cookie belongs to.
 *
 * Never redirects: pages and layouts decide what to do with the answer.
 */
export async function fetchAdminSession(cookie?: string): Promise<AdminSessionResult> {
  let response: Response;

  try {
    response = await requestAdminAuth("/session", { method: "GET", cookie });
  } catch (error) {
    // A misconfigured API address is a server fault: it must surface as an
    // error, not be softened into an outage or a signed-out administrator.
    if (error instanceof ApiConfigurationError) {
      throw error;
    }

    // Unreachable API: deliberately not reported as signed out.
    return { state: "unavailable", reason: "The hotel API could not be reached." };
  }

  if (response.status === 401) {
    return { state: "unauthenticated" };
  }

  if (!response.ok) {
    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return { state: "unavailable", reason: "The hotel API returned an unreadable response." };
  }

  const administrator = toAdministrator(payload);

  if (!administrator) {
    return { state: "unavailable", reason: "The hotel API returned an unexpected session response." };
  }

  return { state: "authenticated", administrator };
}
