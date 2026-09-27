// The administrator's own account: its route, the notices its two forms can
// report, and what follows from each answer the API gives.
//
// Pure and framework-independent: plain values in, a token or a plan out. No
// request context, no network, no `next/*`. A Server Action cannot be imported
// under a plain Node test without Next's request context, so the part that
// *decides* — which notice, where it is shown, what to re-read, whether to
// sign out — lives here and is tested directly. The actions do what the plan
// says and nothing more.
//
// No notice token is ever derived from something the administrator typed. Each
// one is a fixed string from a closed set, and the message it selects is
// written here, so nothing submitted can reach a URL or be rendered as text.

export const ADMIN_ACCOUNT_PATH = "/admin/account";
export const ADMIN_LOGIN_PATH = "/admin/login";

/**
 * What the account page may report.
 *
 * `credentials` is deliberately one notice for two different upstream causes —
 * a wrong current password, and an account that changed underneath the request.
 * The API keeps them apart internally and answers with the same
 * `INVALID_CREDENTIALS`; telling them apart here would be inventing a
 * distinction the API refuses to make.
 *
 * `uncertain` is not a failure. It is what an administrator is told when the
 * API could not be reached around a change: it may have been applied or it may
 * not, and the honest answer is that nobody knows yet.
 */
export const ADMIN_ACCOUNT_NOTICES = {
  "email-changed": {
    tone: "done",
    message:
      "Email updated. This is the address you sign in with from now on. You are still signed in, and no other device was signed out.",
  },
  "email-in-use": {
    tone: "warn",
    // Names no account and no address: the API says only that the address is
    // taken, and echoing the submitted one back would confirm to whoever typed
    // it that some other staff account holds it.
    message:
      "Your email was not changed, because that address is already in use by another staff account. Choose a different address.",
  },
  "email-refused": {
    tone: "warn",
    message:
      "Your email was not changed, because the address could not be accepted. Check it and try again.",
  },
  "email-credentials": {
    tone: "warn",
    message:
      "Your email was not changed, because your current password could not be verified. Enter it again.",
  },
  "email-uncertain": {
    tone: "warn",
    // Worded to hold for every cause of `unavailable` — no answer, a 5xx and
    // an unusable body alike — and it must not promise a refreshed address
    // below, because the read that follows the redirect can fail too.
    message:
      "The result of that change could not be confirmed. Your email may or may not have been updated. Check the address shown before trying again; if it is not shown, reload this page later and check it first.",
  },
  "password-refused": {
    tone: "warn",
    message:
      "Your password was not changed, because the new password could not be accepted. It must be at least 9 characters and include a digit.",
  },
  "password-mismatch": {
    tone: "warn",
    // Refused here, not by the API: the confirmation field is this website's
    // own check and is never sent anywhere.
    message:
      "Your password was not changed, because the two new-password fields did not match. Enter the same new password in both.",
  },
  "password-unchanged": {
    tone: "warn",
    message:
      "Your password was not changed, because the new password is the one you already use. Choose a different one.",
  },
  "password-credentials": {
    tone: "warn",
    message:
      "Your password was not changed, because your current password could not be verified. Enter it again.",
  },
  "password-uncertain": {
    tone: "warn",
    // The one notice that must not tell anyone to simply try again: a PATCH
    // that was never answered may already have committed, in which case the
    // old password no longer works and every session is gone.
    message:
      "The result of that change could not be confirmed. Your password may or may not have been changed, and if it was, you have been signed out everywhere. Try signing in with the new password first; if that fails, sign in with the old one.",
  },
} as const;

export type AdminAccountNotice = keyof typeof ADMIN_ACCOUNT_NOTICES;

/**
 * What the sign-in page may report after an account change.
 *
 * Its own map, because the login page is outside the dashboard and shows one
 * thing only: that the password change succeeded and this is why you are being
 * asked to sign in again.
 */
export const ADMIN_LOGIN_NOTICES = {
  "password-changed": {
    tone: "done",
    message:
      "Your password was changed, so every device has been signed out. Sign in with your new password.",
  },
} as const;

export type AdminLoginNotice = keyof typeof ADMIN_LOGIN_NOTICES;

/**
 * Reads `?notice=` against one allowlist.
 *
 * Only a token the map itself declares is recognised, matched with
 * `Object.hasOwn` so an inherited property name cannot pass for one. Anything
 * else — including a repeated parameter, which arrives as an array — is simply
 * no notice, never text rendered from the URL.
 */
export function parseAdminAccountNoticeToken<T extends string>(
  searchParams: Record<string, string | string[] | undefined>,
  notices: Record<T, unknown>,
): T | null {
  const value = searchParams.notice;

  if (typeof value !== "string" || !Object.hasOwn(notices, value)) {
    return null;
  }

  return value as T;
}

/** The account page's address carrying one fixed notice token. */
export function adminAccountNoticeHref(notice: AdminAccountNotice): string {
  return `${ADMIN_ACCOUNT_PATH}?notice=${notice}`;
}

/** The sign-in page's address carrying one fixed notice token. */
export function adminLoginNoticeHref(notice: AdminLoginNotice): string {
  return `${ADMIN_LOGIN_PATH}?notice=${notice}`;
}

// ---------------------------------------------------------------------------
// The plans
// ---------------------------------------------------------------------------

/**
 * Where the administrator ends up, and with what fixed notice.
 *
 * `signOut` is what makes the password flow different from every other admin
 * mutation: the API has already destroyed every session for the account, so
 * the browser is asked to end its own through the route that owns cookie
 * clearing, and lands on the sign-in page rather than back on a page it can no
 * longer load.
 */
export type AdminAccountOutcome =
  | { kind: "notice"; surface: "account"; token: AdminAccountNotice; revalidateAccount: boolean }
  | { kind: "signOut"; token: AdminLoginNotice }
  | { kind: "login" };

/** The states `changeAdminAccountEmail` can return. */
export type AdminEmailChangeState =
  | "ok"
  | "unauthenticated"
  | "invalid"
  | "credentials"
  | "email-in-use"
  | "unavailable";

/**
 * Changing one's own email.
 *
 * Only a confirmed success re-reads the page: the address shown in the shell
 * and on the page below comes from the API, and it has just changed. Every
 * refusal leaves the stored value exactly as it was, so there is nothing new
 * to read — with one exception, the uncertain case, where the change may in
 * fact have been applied and the page must not keep showing a stale address.
 *
 * Sessions are untouched by this operation, so no plan here signs anyone out.
 */
export function planAdminEmailChange(state: AdminEmailChangeState): AdminAccountOutcome {
  switch (state) {
    case "ok":
      return { kind: "notice", surface: "account", token: "email-changed", revalidateAccount: true };

    case "unauthenticated":
      return { kind: "login" };

    case "invalid":
      return { kind: "notice", surface: "account", token: "email-refused", revalidateAccount: false };

    case "credentials":
      return {
        kind: "notice",
        surface: "account",
        token: "email-credentials",
        revalidateAccount: false,
      };

    case "email-in-use":
      return { kind: "notice", surface: "account", token: "email-in-use", revalidateAccount: false };

    case "unavailable":
      // The PATCH may already have committed, so the page is re-read: the
      // address it then shows is the answer to what actually happened.
      return {
        kind: "notice",
        surface: "account",
        token: "email-uncertain",
        revalidateAccount: true,
      };
  }
}

/** The states `changeAdminAccountPassword` can return. */
export type AdminPasswordChangeState =
  | "ok"
  | "unauthenticated"
  | "invalid"
  | "credentials"
  | "password-unchanged"
  | "unavailable";

/**
 * Changing one's own password.
 *
 * A confirmed success is the one outcome that signs the browser out. By the
 * time the API answers 204 every session for the account is already gone,
 * including the one that made the request, so staying on the account page
 * would mean rendering a page whose next read is a 401. The plan says to end
 * the browser's own session through the existing route and land on sign-in.
 *
 * Nothing is re-read on any refusal: the stored password did not change, and
 * the account page displays no password to refresh.
 */
export function planAdminPasswordChange(state: AdminPasswordChangeState): AdminAccountOutcome {
  switch (state) {
    case "ok":
      return { kind: "signOut", token: "password-changed" };

    case "unauthenticated":
      return { kind: "login" };

    case "invalid":
      return {
        kind: "notice",
        surface: "account",
        token: "password-refused",
        revalidateAccount: false,
      };

    case "credentials":
      return {
        kind: "notice",
        surface: "account",
        token: "password-credentials",
        revalidateAccount: false,
      };

    case "password-unchanged":
      return {
        kind: "notice",
        surface: "account",
        token: "password-unchanged",
        revalidateAccount: false,
      };

    case "unavailable":
      // Deliberately NOT a sign-out. Nobody knows whether the change landed,
      // and ending the session on a guess would strand an administrator whose
      // password may still be the old one.
      return {
        kind: "notice",
        surface: "account",
        token: "password-uncertain",
        revalidateAccount: false,
      };
  }
}

// ---------------------------------------------------------------------------
// Form reading
// ---------------------------------------------------------------------------

/**
 * Reads one field as a string, without trimming.
 *
 * `FormData.get` returns `File` for a file input and `null` for an absent
 * field; neither is a password or an address, and both are simply "not
 * provided". Nothing is trimmed: a password's leading and trailing spaces are
 * part of it, and the email is normalised by the API rather than here.
 */
function formString(form: FormData, name: string): string {
  const value = form.get(name);

  return typeof value === "string" ? value : "";
}

/** The two fields the email form submits. Neither is altered. */
export function readAdminEmailForm(form: FormData): { currentPassword: string; email: string } {
  return {
    currentPassword: formString(form, "currentPassword"),
    email: formString(form, "email"),
  };
}

/**
 * The three fields the password form submits, and whether the two new ones
 * agree.
 *
 * `confirmPassword` is this website's own field. It exists so a typo in a
 * value nobody can read back cannot silently become the new password, and it
 * is checked here and discarded — the API contract has two fields, and a third
 * must never be sent.
 */
export function readAdminPasswordForm(form: FormData): {
  currentPassword: string;
  newPassword: string;
  confirmed: boolean;
} {
  const newPassword = formString(form, "newPassword");

  return {
    currentPassword: formString(form, "currentPassword"),
    newPassword,
    confirmed: newPassword === formString(form, "confirmPassword"),
  };
}
