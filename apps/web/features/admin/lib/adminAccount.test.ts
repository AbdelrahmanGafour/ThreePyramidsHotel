import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_ACCOUNT_NOTICES,
  ADMIN_ACCOUNT_PATH,
  ADMIN_LOGIN_NOTICES,
  ADMIN_LOGIN_PATH,
  adminAccountNoticeHref,
  adminLoginNoticeHref,
  parseAdminAccountNoticeToken,
  planAdminEmailChange,
  planAdminPasswordChange,
  readAdminEmailForm,
  readAdminPasswordForm,
  type AdminAccountOutcome,
} from "./adminAccount.js";

// Pure: the real planners, the real notice maps and the real form readers the
// shipping Server Actions use. They take a state the API client already
// decided and say what follows from it — which fixed notice, what to re-read,
// and whether the browser is signed out.
//
// The client's own classification is proven in server/adminAccountApi.test.ts
// and is not re-tested here.

/** Every token a plan can name must exist in one of the notice maps. */
const KNOWN_TOKENS = new Set([
  ...Object.keys(ADMIN_ACCOUNT_NOTICES),
  ...Object.keys(ADMIN_LOGIN_NOTICES),
]);

function assertNotice(
  outcome: AdminAccountOutcome,
  token: string,
  revalidateAccount: boolean,
): void {
  assert.equal(outcome.kind, "notice");

  if (outcome.kind !== "notice") {
    return;
  }

  assert.equal(outcome.token, token);
  assert.equal(outcome.surface, "account");
  assert.equal(outcome.revalidateAccount, revalidateAccount);
  assert.ok(KNOWN_TOKENS.has(outcome.token), `${outcome.token} must be a declared notice`);
}

describe("planAdminEmailChange", () => {
  it("re-reads the account page on a confirmed change", () => {
    assertNotice(planAdminEmailChange("ok"), "email-changed", true);
  });

  it("sends an ended session to the sign-in page", () => {
    assert.deepEqual(planAdminEmailChange("unauthenticated"), { kind: "login" });
  });

  it("re-reads nothing for a refusal that changed nothing", () => {
    assertNotice(planAdminEmailChange("invalid"), "email-refused", false);
    assertNotice(planAdminEmailChange("credentials"), "email-credentials", false);
    assertNotice(planAdminEmailChange("email-in-use"), "email-in-use", false);
  });

  it("re-reads the page on an unconfirmed outcome, because it may have applied", () => {
    assertNotice(planAdminEmailChange("unavailable"), "email-uncertain", true);
  });

  it("never signs anyone out", () => {
    // An address change does not touch sessions; the API leaves them alone and
    // so must every plan here.
    for (const state of [
      "ok",
      "invalid",
      "credentials",
      "email-in-use",
      "unavailable",
    ] as const) {
      assert.notEqual(planAdminEmailChange(state).kind, "signOut", state);
    }
  });

  it("never claims success for anything but ok", () => {
    for (const state of ["invalid", "credentials", "email-in-use", "unavailable"] as const) {
      const outcome = planAdminEmailChange(state);

      assert.ok(outcome.kind !== "notice" || outcome.token !== "email-changed", state);
    }
  });
});

describe("planAdminPasswordChange", () => {
  it("signs the browser out on a confirmed change", () => {
    // By the time the API answers 204 every session is already gone, this one
    // included, so staying on the account page would render a page whose next
    // read is a 401.
    assert.deepEqual(planAdminPasswordChange("ok"), {
      kind: "signOut",
      token: "password-changed",
    });
  });

  it("sends an ended session to the sign-in page, without a success notice", () => {
    assert.deepEqual(planAdminPasswordChange("unauthenticated"), { kind: "login" });
  });

  it("keeps a refusal on the account page and re-reads nothing", () => {
    assertNotice(planAdminPasswordChange("invalid"), "password-refused", false);
    assertNotice(planAdminPasswordChange("credentials"), "password-credentials", false);
    assertNotice(planAdminPasswordChange("password-unchanged"), "password-unchanged", false);
  });

  it("does NOT sign anyone out on an unconfirmed outcome", () => {
    // Nobody knows whether the change landed. Ending the session on a guess
    // would strand an administrator whose password may still be the old one.
    assertNotice(planAdminPasswordChange("unavailable"), "password-uncertain", false);
  });

  it("signs out on exactly one state", () => {
    const signOuts = (
      ["ok", "unauthenticated", "invalid", "credentials", "password-unchanged", "unavailable"] as const
    ).filter((state) => planAdminPasswordChange(state).kind === "signOut");

    assert.deepEqual(signOuts, ["ok"]);
  });
});

describe("the notice tokens", () => {
  it("covers every message the two forms can report", () => {
    assert.deepEqual(Object.keys(ADMIN_ACCOUNT_NOTICES).sort(), [
      "email-changed",
      "email-credentials",
      "email-in-use",
      "email-refused",
      "email-uncertain",
      "password-credentials",
      "password-mismatch",
      "password-refused",
      "password-uncertain",
      "password-unchanged",
    ]);
    assert.deepEqual(Object.keys(ADMIN_LOGIN_NOTICES), ["password-changed"]);
  });

  it("marks only the two confirmations as done", () => {
    assert.equal(ADMIN_ACCOUNT_NOTICES["email-changed"].tone, "done");
    assert.equal(ADMIN_LOGIN_NOTICES["password-changed"].tone, "done");

    for (const token of [
      "email-in-use",
      "email-refused",
      "email-credentials",
      "email-uncertain",
      "password-refused",
      "password-mismatch",
      "password-unchanged",
      "password-credentials",
      "password-uncertain",
    ] as const) {
      assert.equal(ADMIN_ACCOUNT_NOTICES[token].tone, "warn", token);
    }
  });

  it("says the email change kept the session", () => {
    const message = ADMIN_ACCOUNT_NOTICES["email-changed"].message;

    assert.match(message, /still signed in/i);
    assert.match(message, /sign in with/i);
  });

  it("names no account when an address is taken", () => {
    const message = ADMIN_ACCOUNT_NOTICES["email-in-use"].message;

    assert.match(message, /already in use/i);
    assert.match(message, /choose a different address/i);
    // Confirming which account holds it would tell whoever typed it something
    // about another member of staff.
    assert.doesNotMatch(message, /@/);
  });

  it("words both credential failures the same way, and generically", () => {
    for (const token of ["email-credentials", "password-credentials"] as const) {
      const message = ADMIN_ACCOUNT_NOTICES[token].message;

      assert.match(message, /current password could not be verified/i);
      // The API refuses to say whether it was a wrong password or an account
      // that changed; this must not invent the distinction.
      assert.doesNotMatch(message, /wrong|incorrect|deactivated|disabled/i);
    }
  });

  it("explains the confirmation mismatch as this site's own check", () => {
    const message = ADMIN_ACCOUNT_NOTICES["password-mismatch"].message;

    assert.match(message, /did not match/i);
    assert.match(message, /was not changed/i);
  });

  it("explains the unchanged password without repeating it", () => {
    const message = ADMIN_ACCOUNT_NOTICES["password-unchanged"].message;

    assert.match(message, /already use/i);
    assert.match(message, /choose a different one/i);
  });

  it("says the password change signed every device out", () => {
    const message = ADMIN_LOGIN_NOTICES["password-changed"].message;

    assert.match(message, /every device has been signed out/i);
    assert.match(message, /new password/i);
  });

  it("reports an unconfirmed password change honestly, and never says try again", () => {
    const message = ADMIN_ACCOUNT_NOTICES["password-uncertain"].message;

    assert.match(message, /could not be confirmed/i);
    assert.match(message, /may or may not/i);
    assert.match(message, /signed out everywhere/i);
    // A PATCH that was never answered may already have committed, so a plain
    // "try again" would invite a second change.
    assert.doesNotMatch(message, /^try again/i);
  });

  it("reports an unconfirmed email change honestly", () => {
    const message = ADMIN_ACCOUNT_NOTICES["email-uncertain"].message;

    assert.match(message, /could not be confirmed/i);
    assert.match(message, /may or may not/i);
  });

  it("puts no address, password or field name in any message", () => {
    for (const { message } of Object.values({
      ...ADMIN_ACCOUNT_NOTICES,
      ...ADMIN_LOGIN_NOTICES,
    })) {
      assert.doesNotMatch(message, /@example|currentPassword|newPassword|confirmPassword/);
    }
  });
});

describe("parseAdminAccountNoticeToken", () => {
  it("accepts every declared account token", () => {
    for (const token of Object.keys(ADMIN_ACCOUNT_NOTICES)) {
      assert.equal(
        parseAdminAccountNoticeToken({ notice: token }, ADMIN_ACCOUNT_NOTICES),
        token,
      );
    }
  });

  it("keeps the login token off the account page and vice versa", () => {
    assert.equal(
      parseAdminAccountNoticeToken({ notice: "password-changed" }, ADMIN_ACCOUNT_NOTICES),
      null,
    );
    assert.equal(
      parseAdminAccountNoticeToken({ notice: "email-changed" }, ADMIN_LOGIN_NOTICES),
      null,
    );
  });

  it("refuses anything that is not a declared token", () => {
    for (const notice of [
      undefined,
      "",
      "anything-at-all",
      "constructor",
      "__proto__",
      "toString",
    ]) {
      assert.equal(
        parseAdminAccountNoticeToken({ notice }, ADMIN_ACCOUNT_NOTICES),
        null,
        String(notice),
      );
    }
  });

  it("refuses a repeated parameter, which arrives as an array", () => {
    assert.equal(
      parseAdminAccountNoticeToken({ notice: ["email-changed"] }, ADMIN_ACCOUNT_NOTICES),
      null,
    );
  });
});

describe("the notice addresses", () => {
  it("carry a fixed token and nothing else", () => {
    assert.equal(adminAccountNoticeHref("email-changed"), "/admin/account?notice=email-changed");
    assert.equal(adminLoginNoticeHref("password-changed"), "/admin/login?notice=password-changed");
  });

  it("point at the two declared paths", () => {
    assert.equal(ADMIN_ACCOUNT_PATH, "/admin/account");
    assert.equal(ADMIN_LOGIN_PATH, "/admin/login");

    for (const token of Object.keys(ADMIN_ACCOUNT_NOTICES)) {
      const href = adminAccountNoticeHref(token as never);

      assert.ok(href.startsWith(`${ADMIN_ACCOUNT_PATH}?notice=`));
      // One parameter, so nothing else can be appended into the URL.
      assert.equal(href.split("?")[1]?.split("&").length, 1);
    }
  });
});

describe("reading the email form", () => {
  it("takes the two fields exactly as submitted", () => {
    const form = new FormData();
    form.set("currentPassword", "  spaced 1  ");
    form.set("email", "  Manager@Example.COM  ");

    assert.deepEqual(readAdminEmailForm(form), {
      currentPassword: "  spaced 1  ",
      email: "  Manager@Example.COM  ",
    });
  });

  it("reads an absent field as empty rather than throwing", () => {
    assert.deepEqual(readAdminEmailForm(new FormData()), { currentPassword: "", email: "" });
  });
});

describe("reading the password form", () => {
  it("compares the two new-password fields and discards the confirmation", () => {
    const form = new FormData();
    form.set("currentPassword", "old value 1");
    form.set("newPassword", "new value 2");
    form.set("confirmPassword", "new value 2");

    const read = readAdminPasswordForm(form);

    assert.deepEqual(read, {
      currentPassword: "old value 1",
      newPassword: "new value 2",
      confirmed: true,
    });
    // A boolean, never the third value itself: nothing downstream can send it.
    assert.deepEqual(Object.keys(read).sort(), ["confirmed", "currentPassword", "newPassword"]);
  });

  it("reports a mismatch", () => {
    const form = new FormData();
    form.set("currentPassword", "old value 1");
    form.set("newPassword", "new value 2");
    form.set("confirmPassword", "new value 3");

    assert.equal(readAdminPasswordForm(form).confirmed, false);
  });

  it("compares byte for byte, so a stray space is a mismatch", () => {
    const form = new FormData();
    form.set("newPassword", "new value 2");
    form.set("confirmPassword", "new value 2 ");

    assert.equal(readAdminPasswordForm(form).confirmed, false);
  });

  it("treats a missing confirmation as a mismatch", () => {
    const form = new FormData();
    form.set("currentPassword", "old value 1");
    form.set("newPassword", "new value 2");

    assert.equal(readAdminPasswordForm(form).confirmed, false);
  });

  it("calls two absent new-password fields confirmed, leaving the API to refuse the empty value", () => {
    // Both empty strings do match. The API applies the policy, so an empty new
    // password is refused there rather than being reported as a typo here.
    assert.equal(readAdminPasswordForm(new FormData()).confirmed, true);
  });
});
