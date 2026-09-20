import "server-only";

import { headers } from "next/headers";
import { ApiConfigurationError } from "@/shared/server/apiBaseUrl";
import { fetchAdminSession, type AdminSessionResult } from "./adminAuthApi";

// One way to ask "who is making this request?" on the server.
//
// Both the protected admin layout and the sign-in page need exactly this: the
// incoming Cookie header, handed straight to Express. Express and PostgreSQL
// decide; nothing here interprets the cookie, and no answer is cached.

/**
 * Reads the browser's own Cookie header and asks the API whose session it is.
 *
 * The raw header is forwarded verbatim rather than rebuilt from a named cookie:
 * this app never needs to know which cookie carries the session, and a value it
 * does not parse is a value it cannot mangle.
 *
 * Returns `unavailable` rather than throwing when the API cannot answer -
 * including when it is misconfigured - so a caller can never mistake a server
 * fault for a signed-out administrator.
 */
export async function getCurrentAdminSession(): Promise<AdminSessionResult> {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie") ?? undefined;

  try {
    return await fetchAdminSession(cookie);
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      // The deployment is wrong, which is nobody's sign-in problem. The
      // configured value is never echoed.
      return { state: "unavailable", reason: "The hotel system is not configured correctly." };
    }

    throw error;
  }
}
