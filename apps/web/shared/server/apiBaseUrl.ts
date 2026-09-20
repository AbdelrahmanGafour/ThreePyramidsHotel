import "server-only";

// Where the hotel API lives, resolved once for every server-side caller.
//
// The import above is the boundary: importing this module from client code
// fails the build, so the API address can never reach the browser bundle. It is
// deliberately not a NEXT_PUBLIC_ variable — the browser talks to this app, and
// this app talks to the API.
//
// This file answers one question and nothing else. It is not a configuration
// framework, and no other setting belongs here just because it is also config.

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4000";

/**
 * The API address is wrong or missing. Distinct from an outage: it is a
 * deployment fault, and never an answer about who is signed in.
 */
export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConfigurationError";
  }
}

/**
 * Resolves the API base URL without a trailing slash, so paths join cleanly.
 *
 * The localhost default is a development convenience only; production must say
 * where its API lives rather than quietly calling itself. Messages never
 * include the configured value.
 */
export function resolveApiBaseUrl(): string {
  const configured = process.env.API_BASE_URL?.trim();

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiConfigurationError("API_BASE_URL must be set in production");
    }

    return DEFAULT_API_BASE_URL;
  }

  let url: URL;

  try {
    url = new URL(configured);
  } catch {
    throw new ApiConfigurationError("API_BASE_URL must be an absolute http:// or https:// URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiConfigurationError("API_BASE_URL must use http:// or https://");
  }

  // A base URL is an address, not a request: credentials, a query string or a
  // fragment would either leak into every call or be silently dropped.
  if (url.username || url.password) {
    throw new ApiConfigurationError("API_BASE_URL must not contain credentials");
  }
  if (url.search) {
    throw new ApiConfigurationError("API_BASE_URL must not contain a query string");
  }
  if (url.hash) {
    throw new ApiConfigurationError("API_BASE_URL must not contain a fragment");
  }

  return configured.replace(/\/+$/, "");
}
