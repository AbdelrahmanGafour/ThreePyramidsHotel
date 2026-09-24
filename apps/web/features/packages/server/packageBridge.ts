import "server-only";

import { resolveApiBaseUrl } from "@/shared/server/apiBaseUrl";

export type PackageBridgeResult = {
  status: number;
  body: unknown;
};

const bridgeError = (code: string, message: string, status: number): PackageBridgeResult => ({
  status,
  body: { error: { code, message } },
});

async function fixedRequest(path: string, init: RequestInit): Promise<PackageBridgeResult> {
  let baseUrl: string;
  try {
    baseUrl = resolveApiBaseUrl();
  } catch {
    return bridgeError("PACKAGE_BRIDGE_CONFIGURATION_ERROR", "Package API bridge is not configured.", 500);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, cache: "no-store" });
  } catch {
    return bridgeError("PACKAGE_UPSTREAM_UNREACHABLE", "Package API could not be reached.", 502);
  }

  let body: unknown;
  try {
    body = JSON.parse(await response.text()) as unknown;
  } catch {
    return bridgeError("PACKAGE_UPSTREAM_INVALID_RESPONSE", "Package API returned an unusable response.", 502);
  }

  return { status: response.status, body };
}

export function bridgePackageList(): Promise<PackageBridgeResult> {
  return fixedRequest("/api/v1/packages", { method: "GET" });
}

export function bridgePackageDetail(slug: string): Promise<PackageBridgeResult> {
  return fixedRequest(`/api/v1/packages/${encodeURIComponent(slug)}`, { method: "GET" });
}

export function bridgePackageReservation(rawBody: string, contentType: string | null): Promise<PackageBridgeResult> {
  const headers: Record<string, string> = {};
  if (contentType !== null) headers["content-type"] = contentType;
  return fixedRequest("/api/v1/package-reservations", {
    method: "POST",
    headers,
    body: rawBody,
  });
}
