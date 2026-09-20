import {
  adminAuthGatewayResponse,
  relayAdminAuthResponse,
} from "@/features/admin/server/adminAuthProxy";
import { requestAdminAuth } from "@/features/admin/server/adminAuthApi";

// Same-origin front door for admin logout.
//
// The browser cannot read the HttpOnly session cookie, so it cannot sign itself
// out; it asks this route, which hands the cookie to the API. Express ends the
// session in PostgreSQL and clears the cookie, and its answer is relayed as-is.
//
// Only POST is exported, so every other method gets Next's own 405.

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // The raw header, opaque: this route never parses the cookie, never checks
  // whether it is valid, and never asks the API who it belongs to first.
  // Logout is idempotent upstream, so a missing or stale cookie is fine.
  const cookie = request.headers.get("cookie") ?? undefined;

  let upstream: Response;

  try {
    upstream = await requestAdminAuth("/logout", { method: "POST", cookie });
  } catch (error) {
    // The session may well still be live upstream, so this cannot report a
    // successful sign-out.
    return adminAuthGatewayResponse(error);
  }

  return relayAdminAuthResponse(upstream);
}
