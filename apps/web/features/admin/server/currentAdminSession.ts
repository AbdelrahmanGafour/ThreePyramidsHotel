import "server-only";

import { headers } from "next/headers";
import { cache } from "react";
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
 *
 * Memoised per request, not cached: `cache` de-duplicates the calls made while
 * one request renders, and holds nothing between requests. The layout asks
 * who is signed in, and so does the overview page it wraps; both get the one
 * answer, from the one call to the API.
 */
export const getCurrentAdminSession = cache(async (): Promise<AdminSessionResult> => {
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
});
