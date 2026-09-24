// Server-only Express API origin for the WFI-T02 transport bridge.
//
// This value is read lazily, on demand, rather than at module import time.
// Route Handlers are imported and type-checked during `next build` regardless
// of whether a request ever reaches them, so validating eagerly at the top of
// this module would make the build itself depend on a runtime environment
// variable. Reading it only when a request actually needs to reach Express
// keeps build/typecheck independent of the runtime API environment while
// still failing clearly and safely the moment a real request needs it.
//
// Never import this from client-executed code: it is only meant to be
// reached through apps/web/lib/api/proxy.ts, from Route Handlers.
//
// Thrown messages are deliberately generic and never include the configured
// value itself: apps/web/lib/api/proxy.ts surfaces configuration failures to
// the browser, so nothing thrown here may assume it stays server-log-only.

export function getApiBaseUrl(): string {
  const raw = process.env.API_BASE_URL;

  if (raw === undefined || raw.trim() === "") {
    throw new Error("API_BASE_URL is not configured.");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("API_BASE_URL is not configured correctly.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API_BASE_URL is not configured correctly.");
  }

  // Must be a bare origin (e.g. "http://localhost:4000" or
  // "https://api.example.com") — not a URL carrying a path, query,
  // fragment, or embedded credentials. Any of those would change how the
  // fixed /api/v1/... paths are constructed below, so they are rejected
  // rather than silently accepted. A trailing slash alone is fine: it
  // parses to an empty/"/" pathname, which is accepted and normalized away
  // by `.origin`.
  const hasPath = parsed.pathname !== "" && parsed.pathname !== "/";
  const hasQueryOrFragment = parsed.search !== "" || parsed.hash !== "";
  const hasCredentials = parsed.username !== "" || parsed.password !== "";

  if (hasPath || hasQueryOrFragment || hasCredentials) {
    throw new Error("API_BASE_URL is not configured correctly.");
  }

  // `.origin` is already normalized: scheme + host + port, no trailing slash.
  return parsed.origin;
}
