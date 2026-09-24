// Generic browser-safe transport for the same-origin Next bridge
// (apps/web/app/api/v1/**). Mirrors apps/web/lib/api/proxy.ts's role but runs
// in the browser: it never knows API_BASE_URL and only ever calls a
// relative, same-origin path. No domain/room/availability knowledge belongs
// here — callers interpret status/body themselves, exactly as the
// server-side Route Handlers already preserve Express's real status and
// body (including backend error.code/message) unchanged.

export type ClientResponse<T> = {
  status: number;
  body: T | null;
};

/**
 * Enforces the same-origin API boundary this module documents: `path` must
 * be a relative app API path (`/api/...`), never an absolute URL or a
 * protocol-relative `//host` path that could target a different origin.
 */
function assertSameOriginApiPath(path: string): void {
  if (!path.startsWith("/api/")) {
    throw new Error(`requestJson: path must be a relative "/api/..." path, got: "${path}"`);
  }
}

export async function requestJson<T = unknown>(path: string, init?: RequestInit): Promise<ClientResponse<T>> {
  assertSameOriginApiPath(path);

  const response = await fetch(path, init);

  let body: T | null = null;
  try {
    body = (await response.json()) as T;
  } catch {
    body = null;
  }

  return { status: response.status, body };
}
