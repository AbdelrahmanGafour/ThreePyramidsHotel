import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { adminNavigation, sidebarNavigation } from "../data/adminNavigation.js";

// The account screen, inspected rather than rendered.
//
// Both forms bind Server Actions, which import `next/headers` and load only
// under the react-server condition, while the shared submit button inside them
// is a Client Component that cannot. The same pincer every admin write screen
// hits — so what is asserted here is the structure, and the pieces that
// genuinely decide something are tested directly: the planners and notices in
// lib/adminAccount.test.ts and the request shape in
// server/adminAccountApi.test.ts.

const read = (path: string) => readFileSync(path, "utf8");

const emailForm = read("features/admin/components/AdminAccountEmailForm.tsx");
const passwordForm = read("features/admin/components/AdminAccountPasswordForm.tsx");
const page = read("app/(dashboard)/admin/account/page.tsx");
const actions = read("features/admin/server/adminAccountActions.ts");
const loginPage = read("app/(admin-auth)/admin/login/page.tsx");

/** Comments explain what these files deliberately do NOT do, so scans skip them. */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FORMS = [
  ["email form", emailForm],
  ["password form", passwordForm],
] as const;

describe("the My account destination", () => {
  it("is its own navigation entry, labelled My account", () => {
    const entry = adminNavigation.find((item) => item.key === "account");

    assert.ok(entry, "an `account` entry should exist");
    assert.equal(entry.label, "My account");
    assert.equal(entry.href, "/admin/account");
    assert.equal(entry.available, true);
  });

  it("appears in the sidebar", () => {
    assert.ok(sidebarNavigation.some((item) => item.key === "account"));
  });

  it("does not reuse the hotel Settings entry", () => {
    const settings = adminNavigation.find((item) => item.key === "settings");

    assert.ok(settings, "the hotel settings entry should still exist");
    assert.equal(settings.label, "Settings");
    assert.equal(settings.href, "/admin/settings");
    assert.equal(settings.available, false, "still not built, and not repurposed");
    assert.notEqual(settings.href, "/admin/account");
  });

  it("carries the page heading My account", () => {
    assert.match(page, /title: "My account"/, "the document title");
    assert.match(page, /<DetailMasthead\s+title="My account"/, "and the heading on the page");
  });
});

describe("the email form", () => {
  it("collects exactly the current password and the new address", () => {
    const names = [...emailForm.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);

    assert.deepEqual(names, ["currentPassword", "email"]);
  });

  it("uses a password input with the current-password autocomplete", () => {
    const field = emailForm.slice(emailForm.indexOf('name="currentPassword"'));
    const declared = field.slice(0, field.indexOf("/>"));

    assert.match(declared, /type="password"/);
    assert.match(declared, /autoComplete="current-password"/);
  });

  it("uses an email input with the email autocomplete", () => {
    const field = emailForm.slice(emailForm.indexOf('name="email"'));
    const declared = field.slice(0, field.indexOf("/>"));

    assert.match(declared, /type="email"/);
    assert.match(declared, /autoComplete="email"/);
    assert.match(declared, /autoCapitalize="none"/, "an address is data, not prose");
    assert.match(declared, /spellCheck=\{false\}/);
  });

  it("posts to the Server Action, with nothing bound from the browser", () => {
    assert.match(emailForm, /action=\{changeAdminEmailAction\}/);
    // Whose account it is comes from the session, so the form binds no
    // identity and there is nothing to substitute.
    assert.ok(!emailForm.includes(".bind("));
  });
});

describe("the password form", () => {
  it("collects the current password and the new one twice", () => {
    const names = [...passwordForm.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);

    assert.deepEqual(names, ["currentPassword", "newPassword", "confirmPassword"]);
  });

  it("makes every field a password input", () => {
    assert.equal((passwordForm.match(/type="password"/g) ?? []).length, 3);
    assert.ok(!/type="text"/.test(passwordForm), "no field reveals what is typed");
  });

  it("uses current-password for the current one and new-password for both new ones", () => {
    assert.equal((passwordForm.match(/autoComplete="current-password"/g) ?? []).length, 1);
    assert.equal((passwordForm.match(/autoComplete="new-password"/g) ?? []).length, 2);
  });

  it("says before the form is filled in that it signs every device out", () => {
    assert.match(passwordForm, /signs you out on every device/i);
    assert.match(passwordForm, /sign in again/i);
  });

  it("says the confirmation is not sent anywhere", () => {
    assert.match(passwordForm, /not sent to the hotel system/i);
  });

  it("posts to the Server Action", () => {
    assert.match(passwordForm, /action=\{changeAdminPasswordAction\}/);
  });
});

describe("what neither form does", () => {
  it("echoes no submitted value back into an input", () => {
    for (const [label, source] of FORMS) {
      const code = codeOnly(source);

      assert.ok(!code.includes("defaultValue"), `${label} must pre-fill nothing`);
      assert.ok(!/\bvalue=/.test(code), `${label} must set no value`);
    }
  });

  it("carries no hidden field", () => {
    for (const [label, source] of FORMS) {
      assert.ok(!source.includes('type="hidden"'), `${label} must smuggle nothing`);
      assert.ok(!source.includes("<input type=\"hidden\""), label);
    }
  });

  it("stays a server component and calls no API from the browser", () => {
    for (const [label, source] of FORMS) {
      const code = codeOnly(source);

      for (const forbidden of [
        '"use client"',
        "fetch(",
        "useState",
        "useEffect",
        "XMLHttpRequest",
        "/api/v1/",
        "adminAccountApi",
      ]) {
        assert.ok(!code.includes(forbidden), `${forbidden} must not appear in the ${label}`);
      }
    }
  });

  it("uses the shared pending button rather than a bare submit", () => {
    const button = read("features/admin/components/AdminActionButton.tsx");

    for (const [label, source] of FORMS) {
      assert.match(source, /import \{ AdminActionButton \}/, label);
      assert.equal((source.match(/<AdminActionButton/g) ?? []).length, 1, label);
      assert.ok(!/<button/.test(source), `${label} must have no unmanaged submit`);
    }

    assert.match(button, /disabled=\{pending\}/);
    assert.match(button, /aria-busy=\{pending\}/);
  });

  it("offers no display-name editor", () => {
    for (const [label, source] of FORMS) {
      assert.ok(!source.includes('name="displayName"'), `${label} must not edit the display name`);
    }

    assert.ok(!page.includes('name="displayName"'));
    // The name is shown as a fact on the masthead; nothing edits it.
    assert.ok(!page.includes("AdminAccountNameForm"));
  });

  it("offers no reset, delete or other-account control", () => {
    for (const [label, source] of [...FORMS, ["page", page]] as const) {
      for (const forbidden of [/adminUserId/, /accountId/, /reset/i, /forgot/i, /Delete account/i]) {
        assert.ok(!forbidden.test(codeOnly(source)), `${forbidden} has no place in the ${label}`);
      }
    }
  });
});

describe("the page", () => {
  it("reads who is signed in from the session, not from a prop or the URL", () => {
    assert.match(page, /getCurrentAdminSession\(\)/);
    assert.match(page, /const \{ administrator \} = session;/);
    // No route parameter at all: `searchParams` carries only a notice token,
    // and there is no `params`, so the page cannot be pointed at somebody
    // else's account.
    assert.ok(!/params: Promise<\{/.test(page));
    assert.ok(!page.includes("[slug]"));
  });

  it("renders both panels", () => {
    assert.match(page, /<AdminAccountEmailForm email=\{administrator\.email\} \/>/);
    assert.match(page, /<AdminAccountPasswordForm \/>/);
  });

  it("shows its notices through the closed map only", () => {
    assert.match(page, /parseAdminAccountNoticeToken\(await searchParams, ADMIN_ACCOUNT_NOTICES\)/);
    assert.match(page, /ADMIN_ACCOUNT_NOTICES\[token\]/);
    assert.match(page, /\{notice\.message\}/);
    // Nothing from the URL is rendered as text.
    assert.ok(!/\{query\.|\{searchParams\./.test(page));
  });

  it("does not redirect on an unconfirmed session, because the layout owns that", () => {
    assert.ok(!page.includes("redirect("), "the layout already decided");
    assert.match(page, /session\.state !== "authenticated"/);
  });
});

describe("the sign-in page notice", () => {
  it("accepts only the login notice map", () => {
    assert.match(loginPage, /parseAdminAccountNoticeToken\(await searchParams, ADMIN_LOGIN_NOTICES\)/);
    assert.match(loginPage, /ADMIN_LOGIN_NOTICES\[noticeToken\]/);
  });

  it("renders the message above the form, not instead of it", () => {
    const at = loginPage.indexOf("{notice.message}");
    const formAt = loginPage.indexOf("<AdminLoginForm />");

    assert.ok(at > 0 && at < formAt, "the form is still reachable");
  });

  it("leaves the existing authenticated and unavailable branches alone", () => {
    assert.match(loginPage, /if \(session\.state === "authenticated"\) \{/);
    assert.match(loginPage, /redirect\("\/admin"\);/);
    assert.match(loginPage, /Sign in unavailable/);
  });
});

describe("the actions", () => {
  it("run on the server and forward the caller's own cookie", () => {
    assert.match(actions, /^"use server";/);
    assert.match(actions, /\(await headers\(\)\)\.get\("cookie"\)/);
  });

  it("refuse a mismatched confirmation before any request", () => {
    const passwordAction = actions.slice(actions.indexOf("export async function changeAdminPasswordAction"));

    assert.ok(
      passwordAction.indexOf("!input.confirmed") <
        passwordAction.indexOf("changeAdminAccountPassword("),
      "checked before the API is asked",
    );
    assert.match(passwordAction, /token: "password-mismatch"/);
  });

  it("send exactly the two contracted fields, never the confirmation", () => {
    assert.match(
      actions,
      /\{ currentPassword: input\.currentPassword, newPassword: input\.newPassword \}/,
    );
    assert.ok(!/confirmPassword/.test(actions), "the third field never reaches the client");
  });

  it("clear the browser cookie through the shared helper, never by naming it", () => {
    assert.match(actions, /await clearAdminSessionCookie\(\)/);
    assert.match(actions, /from "\.\/adminSessionCookie"/);

    // The name lives in that one auth-focused module. This feature does not
    // know it, and does not reach `cookies()` itself.
    assert.ok(!actions.includes("tph_admin_session"));
    assert.ok(!codeOnly(actions).includes("cookies()"));
  });

  it("clear the cookie exactly once, and only on the sign-out plan", () => {
    assert.equal((actions.match(/clearAdminSessionCookie\(\)/g) ?? []).length, 1);

    const signOut = actions.slice(
      actions.indexOf('outcome.kind === "signOut"'),
      actions.indexOf("if (outcome.revalidateAccount)"),
    );

    assert.match(signOut, /await clearAdminSessionCookie\(\)/);
  });

  it("no longer ask the API to log out, which cleared nothing in the browser", () => {
    // A Server Action cannot relay an upstream Set-Cookie, so that call ended
    // an already-ended session and left the browser holding its copy.
    assert.ok(!actions.includes("requestAdminAuth"));
    assert.ok(!actions.includes("adminAuthApi"));
  });

  it("clear the cookie before redirecting to the sign-in page", () => {
    const signOut = actions.slice(actions.indexOf('outcome.kind === "signOut"'));

    assert.ok(
      signOut.indexOf("clearAdminSessionCookie") < signOut.indexOf("redirect(adminLoginNoticeHref"),
      "the cookie is dealt with first",
    );
  });

  it("never clear the cookie on the email path or on a refusal", () => {
    // Only the sign-out plan clears it, and only `ok` produces that plan —
    // proven for the planner in lib/adminAccount.test.ts. Here: the email
    // action and the mismatch branch reach no clearing call of their own.
    const emailAction = actions.slice(
      actions.indexOf("export async function changeAdminEmailAction"),
      actions.indexOf("export async function changeAdminPasswordAction"),
    );
    const mismatch = actions.slice(
      actions.indexOf("if (!input.confirmed)"),
      actions.indexOf("changeAdminAccountPassword("),
    );

    assert.ok(!emailAction.includes("clearAdminSessionCookie"));
    assert.ok(!mismatch.includes("clearAdminSessionCookie"));
  });

  it("hand every outcome to the shared planner", () => {
    assert.match(actions, /completeOutcome\(planAdminEmailChange\(result\.state\)\)/);
    assert.match(actions, /completeOutcome\(planAdminPasswordChange\(result\.state\)\)/);
  });

  it("revalidate the account page only where the plan says to", () => {
    assert.match(actions, /if \(outcome\.revalidateAccount\) \{\s*revalidatePath\(ADMIN_ACCOUNT_PATH\);/);
  });

  it("redirect only to fixed tokens, never to a submitted value", () => {
    // Every redirect target is a constant or a helper taking a token from a
    // closed union, so no address and no password can reach a URL.
    const redirects = [...codeOnly(actions).matchAll(/redirect\(([^)]*)/g)].map((match) =>
      match[1]!.trim(),
    );

    assert.deepEqual(redirects.sort(), [
      "ADMIN_LOGIN_PATH",
      "adminAccountNoticeHref(outcome.token",
      "adminLoginNoticeHref(outcome.token",
    ]);
  });

  it("never retry and never log", () => {
    const code = codeOnly(actions);

    assert.equal((code.match(/changeAdminAccountEmail\(/g) ?? []).length, 1);
    assert.equal((code.match(/changeAdminAccountPassword\(/g) ?? []).length, 1);
    for (const forbidden of ["console.", "retry", "setTimeout"]) {
      assert.ok(!code.includes(forbidden), `${forbidden} must not appear`);
    }
  });
});
