import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ADMIN_SESSION_COOKIE_NAME } from "./adminSessionCookie.js";

// The one place this app names the admin session cookie, and the two things
// that must stay true about it: that the name matches the one Express actually
// sets, and that nothing else in the admin feature states it.
//
// `clearAdminSessionCookie` itself is not called here. It reaches `cookies()`
// from `next/headers`, which throws without a request context, so its
// behaviour belongs to a browser and its wiring is asserted against source —
// the same split every admin Server Action in this app is tested under.

const helper = readFileSync("features/admin/server/adminSessionCookie.ts", "utf8");
const actions = readFileSync("features/admin/server/adminAccountActions.ts", "utf8");
const proxy = readFileSync("features/admin/server/adminAuthProxy.ts", "utf8");
const logoutRoute = readFileSync("app/api/admin/auth/logout/route.ts", "utf8");

/** Comments explain what these files deliberately do NOT do, so scans skip them. */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the shared session cookie name", () => {
  it("is the name Express actually sets", () => {
    // Read from the API's own source rather than restated here. If either side
    // is renamed, the clear silently stops working — this is the assertion
    // that makes that impossible to miss.
    const apiSession = readFileSync(
      "../api/src/modules/admin-auth/admin-auth.session.ts",
      "utf8",
    );
    const match = /export const ADMIN_SESSION_COOKIE_NAME = '([^']+)'/.exec(apiSession);

    assert.ok(match, "the API should still export ADMIN_SESSION_COOKIE_NAME");
    assert.equal(ADMIN_SESSION_COOKIE_NAME, match[1]);
  });

  it("is scoped to the path the API sets the cookie at", () => {
    // A cookie set at `/` is not removed by a clear scoped to a narrower path;
    // the browser keeps the original and the sign-out only looks like it
    // worked.
    const apiSession = readFileSync(
      "../api/src/modules/admin-auth/admin-auth.session.ts",
      "utf8",
    );
    const clearing = apiSession.slice(apiSession.indexOf("export function clearSessionCookieOptions"));

    assert.match(clearing.slice(0, 260), /path: '\/'/);
    assert.match(helper, /const ADMIN_SESSION_COOKIE_PATH = "\/";/);
    assert.match(helper, /path: ADMIN_SESSION_COOKIE_PATH/);
  });

  it("is stated in this module and nowhere else in the admin feature", () => {
    // Every other reader treats the cookie as opaque. A second copy of the
    // name is a second thing to keep in step.
    const sources = [
      ["the account actions", actions],
      ["the account API client", readFileSync("features/admin/server/adminAccountApi.ts", "utf8")],
      ["the account page", readFileSync("app/(dashboard)/admin/account/page.tsx", "utf8")],
      ["the email form", readFileSync("features/admin/components/AdminAccountEmailForm.tsx", "utf8")],
      ["the password form", readFileSync("features/admin/components/AdminAccountPasswordForm.tsx", "utf8")],
      ["the auth relay", proxy],
      ["the logout route", logoutRoute],
      ["the session reader", readFileSync("features/admin/server/currentAdminSession.ts", "utf8")],
    ] as const;

    for (const [label, source] of sources) {
      assert.ok(
        !source.includes(ADMIN_SESSION_COOKIE_NAME),
        `${label} must not name the cookie`,
      );
    }
  });

  it("is server-only, so the name cannot reach the browser bundle", () => {
    assert.match(helper, /^import "server-only";/);
  });

  it("clears rather than rewrites: it mints no token and sets no value", () => {
    const code = codeOnly(helper);

    assert.match(code, /cookieStore\.delete\(/);
    assert.ok(!code.includes(".set("), "this module never writes a session");
    assert.ok(!code.includes("randomBytes") && !code.includes("createHash"));
    // It does not read the cookie either: what a session means is the API's
    // answer, never this app's.
    assert.ok(!code.includes(".get("));
  });
});

describe("the logout route still owns cookie clearing by relay", () => {
  it("relays the API's own response, unchanged", () => {
    assert.match(logoutRoute, /requestAdminAuth\("\/logout", \{ method: "POST", cookie \}\)/);
    assert.match(logoutRoute, /return relayAdminAuthResponse\(upstream\);/);
  });

  it("copies every Set-Cookie header the API sent, without rebuilding it", () => {
    // This is what keeps HttpOnly and the rest intact on the logout path, and
    // it is why that route needs no cookie name of its own.
    assert.match(proxy, /for \(const cookie of upstream\.headers\.getSetCookie\(\)\) \{/);
    assert.match(proxy, /headers\.append\("set-cookie", cookie\);/);
  });

  it("does not use the local helper, and does not need to", () => {
    // The route has an upstream response to relay; the Server Action does not,
    // which is the whole reason the helper exists.
    assert.ok(!logoutRoute.includes("clearAdminSessionCookie"));
    assert.ok(!proxy.includes("clearAdminSessionCookie"));
  });
});
