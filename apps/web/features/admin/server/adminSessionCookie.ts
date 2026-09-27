import "server-only";

import { cookies } from "next/headers";

// The one place this app names the admin session cookie.
//
// Everywhere else the cookie is opaque: `getCurrentAdminSession` forwards the
// raw `Cookie` header without parsing it, and the login and logout routes
// relay the API's own `Set-Cookie` header byte for byte so the token keeps the
// attributes Express set — `HttpOnly` included — and never passes through a
// value this app rebuilt. That remains the rule. Reading or minting a session
// is the API's business, and nothing here does either.
//
// There is exactly one thing this app cannot do that way, and it is why this
// module exists. After a successful password change the API has already
// deleted every session for the account, so there is no session left to end —
// but the browser is still holding a cookie for one. A Server Action cannot
// relay an upstream `Set-Cookie`, so the only way to get rid of it is to clear
// it locally, and clearing a cookie requires naming it.
//
// So the name lives here, once, in an auth-focused module, and the account
// feature imports it rather than inventing one. If it ever drifts from the
// API's `ADMIN_SESSION_COOKIE_NAME` the clear silently stops working, which is
// why a test pins the two together against the API's own source.

/**
 * The cookie Express sets the session token in.
 *
 * Must stay identical to `ADMIN_SESSION_COOKIE_NAME` in
 * `apps/api/src/modules/admin-auth/admin-auth.session.ts`. That is asserted,
 * not assumed: `adminSessionCookie.test.ts` reads the API's source and
 * compares them.
 */
export const ADMIN_SESSION_COOKIE_NAME = "tph_admin_session";

/**
 * The path the API scopes the cookie to.
 *
 * Deletion has to match it. A cookie set at `/` is not removed by a clear
 * scoped to a narrower path — the browser would simply keep the original and
 * the sign-out would look like it worked.
 */
const ADMIN_SESSION_COOKIE_PATH = "/";

/**
 * Removes the admin session cookie from the browser.
 *
 * Only ever correct once the API has confirmed the session is gone server-side.
 * Clearing a cookie is not a sign-out: it drops the browser's copy of a token,
 * and if the session behind it were still live the token would remain valid to
 * anyone else holding it. Which is why nothing calls this speculatively — the
 * one caller does so after a 204 that has already revoked every session for
 * the account.
 *
 * Usable only where Next allows a cookie to be written: a Server Action or a
 * Route Handler. It throws during render, which is the right answer — a page
 * that tried to sign somebody out while drawing itself would be a bug.
 */
export async function clearAdminSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.delete({ name: ADMIN_SESSION_COOKIE_NAME, path: ADMIN_SESSION_COOKIE_PATH });
}
