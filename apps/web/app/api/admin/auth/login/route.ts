import {
  adminAuthGatewayResponse,
  crossOriginLoginResponse,
  isSameOriginRequest,
  relayAdminAuthResponse,
} from "@/features/admin/server/adminAuthProxy";
import { requestAdminAuth } from "@/features/admin/server/adminAuthApi";

// Same-origin front door for admin login.
//
// It exists so the browser posts to this app rather than to the API directly:
// the session cookie is then a first-party cookie, and the API's address stays
// on the server. Authentication itself is decided entirely by Express.
//
// Only POST is exported, so every other method gets Next's own 405.

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // First, before the body is even read. A cross-site page must not be able to
  // post its own credentials here and leave the browser holding a session for
  // an account the visitor never chose — SameSite=Lax stops a cookie being
  // sent cross-site, but not one being set. Refused requests never reach
  // Express, so nothing is attempted against the API on their behalf.
  if (!isSameOriginRequest(request)) {
    return crossOriginLoginResponse();
  }

  // Deliberately text(), never json(): the body is carried across byte for
  // byte. Parsing here would turn a malformed body into this route's verdict,
  // when the API's INVALID_JSON answer is the one the browser should see.
  const rawBody = await request.text();
  const contentType = request.headers.get("content-type") ?? undefined;

  let upstream: Response;

  try {
    upstream = await requestAdminAuth("/login", {
      method: "POST",
      rawBody,
      contentType,
    });
  } catch (error) {
    // Nothing was learned about the credentials, so this must not look like a
    // rejected login. The submitted values are never read, inspected or logged.
    return adminAuthGatewayResponse(error);
  }

  return relayAdminAuthResponse(upstream);
}
