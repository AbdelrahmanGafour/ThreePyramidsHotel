import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

// Runs the Express API inside this Node process.
//
// Some hosts (Hostinger's shared Node.js hosting) sandbox listening sockets: a
// second HTTP server cannot be reached, even from its own process. There the
// API is therefore not a separate service. API_BASE_URL points at the reserved
// host below, and every server-side `fetch` to it is answered by the Express
// app in memory — same routes, same middleware, no socket.
//
// Off unless API_BASE_URL's host is `api.internal`, so local development and
// any deployment with a real API URL behave exactly as before.

export const EMBEDDED_API_HOST = "api.internal";

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

const ENTRY_CANDIDATES = [
  // Placed next to the server by scripts/postbuild.js.
  "embedded-api/dist/app.js",
  // Monorepo checkout, after `npm run build -w @hotel-reservation/api`.
  "../api/dist/app.js",
];

function loadApiApp(): RequestListener {
  // Secrets may live in a file outside the deploy folder instead of in the
  // panel's environment (Docker-secrets style).
  const urlFile = process.env.DATABASE_URL_FILE;
  if (!process.env.DATABASE_URL && urlFile) {
    process.env.DATABASE_URL = readFileSync(urlFile, "utf8").trim();
  }

  const entry = ENTRY_CANDIDATES.map((candidate) => path.resolve(process.cwd(), candidate)).find(
    (candidate) => existsSync(candidate),
  );
  if (!entry) {
    throw new Error("Embedded API build not found");
  }

  // A runtime require on purpose: the bundler must not try to follow it (it
  // also mangles `createRequire`, so the chunk's own `require` is used).
  // eslint-disable-next-line no-eval
  const nodeRequire = eval("require") as NodeRequire;
  const { createApp } = nodeRequire(entry) as { createApp: () => RequestListener };
  return createApp();
}

export function isEmbeddedApiConfigured(): boolean {
  const base = process.env.API_BASE_URL?.trim();
  if (!base) return false;
  try {
    return new URL(base).hostname === EMBEDDED_API_HOST;
  } catch {
    return false;
  }
}

export async function installEmbeddedApi(): Promise<void> {
  if (!isEmbeddedApiConfigured()) return;

  const { default: inject } = (await import("light-my-request")) as unknown as {
    default: (
      app: RequestListener,
      options: Record<string, unknown>,
    ) => Promise<{ statusCode: number; headers: Record<string, string | string[] | number | undefined>; rawPayload: Buffer }>;
  };

  const app = loadApiApp();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.hostname !== EMBEDDED_API_HOST) {
      return originalFetch(input, init);
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const payload = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;

    const result = await inject(app, {
      method: request.method,
      url: `${url.pathname}${url.search}`,
      headers,
      payload,
      remoteAddress: "127.0.0.1",
    });

    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(result.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) responseHeaders.append(key, item);
      } else {
        responseHeaders.set(key, String(value));
      }
    }

    const noBody = result.statusCode === 204 || result.statusCode === 205 || result.statusCode === 304;
    return new Response(noBody ? null : new Uint8Array(result.rawPayload), {
      status: result.statusCode,
      headers: responseHeaders,
    });
  };
}
